---
weight: 6202
title: "19.2 Graphics Bindings and Thread Affinity"
---

# 19.2 Graphics Bindings and Thread Affinity

[19.1](./pipeline.md) said that Go sits at the application stage of the pipeline and is responsible for issuing draw calls. But before the first draw call can actually go out, there is a threshold in front of every Go graphics program. It does not come from graphics itself, but from a fundamental conflict between Go's concurrency model and a property of graphics APIs: **a graphics context is bound to a thread, while a goroutine migrates across threads**. This threshold is the subject of this section, and the key that [18.2.5](../ch18gpu/sched.md) handed us, `LockOSThread`, turns here from an optional trick into a necessity.

## 19.2.1 The Context: An Implicit State Machine Bound to a Thread

Graphics APIs like OpenGL are organized around a **context**. The context is a large implicit state machine: the currently bound shader, texture, buffer, blend mode, viewport, and so on. Almost every API call does not take the context as an explicit parameter but acts implicitly on the "current context." `glBindTexture` binds the texture slot in the current context, and `glDrawElements` uses the whole set of state in the current context.

The crucial point is that "current" is defined **per thread**: an OpenGL context is, at a given moment, "current on" one specific OS thread. You set the context current on thread A, configure the state, and issue the draw call, and all of that is attached to thread A. If part of a string of OpenGL calls runs on thread B, where this context is not current, those calls either fail outright or act on an empty context, and the screen goes black.

## 19.2.2 Goroutines Migrate, So We Must Pin

This is exactly where Go's concurrency model collides with the graphics API. Recall from Chapter 9: a goroutine is not bound to a fixed thread, and the scheduler **migrates** it across different Ms. It runs on thread A this time, and after a preemption, a syscall, or a channel block, it may well be scheduled onto thread B next time. For pure Go code this migration is transparent and harmless, exactly the dividend of M:N scheduling. But for OpenGL it is a disaster:

> Once a goroutine issuing OpenGL calls is migrated to another thread between calls, the current context is gone.

The antidote is `runtime.LockOSThread`: **pin** this goroutine to its current M, so it never migrates again, and thus every OpenGL call it issues lands on the same thread and the same current context. Combine this with the "device goroutine" of 18.2.5, and the standard skeleton of graphics rendering emerges, **identical** to the skeleton for operating the GPU in the previous chapter:

```go
// Render goroutine: pin the thread, own the graphics context exclusively,
// expose only a channel to the outside
func renderLoop(frames <-chan Scene) {
    runtime.LockOSThread()          // pin: the context is now current only on this thread
    defer runtime.UnlockOSThread()
    ctx := makeContextCurrent(win)  // the context binds to this thread
    for scene := range frames {
        draw(ctx, scene)            // all GL calls happen on the same thread
        win.SwapBuffers()
    }
}
```

This is no coincidence. Whether the far side is a CUDA context doing general computation or an OpenGL context doing rendering, **when "thread-bound external state" meets "a goroutine that migrates," the answer is always to pin one goroutine to one thread and let it own the state exclusively**. The shape that Chapter 18 derived at the place closest to the hardware holds once again in graphics.

## 19.2.3 The Tyranny of the Main Thread

Pinning a thread is still not enough. Some platforms are stricter: they require graphics and windowing to run on **that one specific main thread**, the thread number 0 that runs `main` when the process starts.

The most typical case is macOS. Its windowing system, Cocoa/AppKit, mandates that all window management and event handling happen on the main thread. Cross-platform windowing libraries like GLFW therefore propagate the constraint upward, and its documentation says in black and white: window creation and event polling (`glfwPollEvents`) must be called from the main thread. This is awkward for Go: although a Go program's `main` function does start out running on the main thread, `main` is itself just an ordinary goroutine, and the scheduler may migrate it away at any time, or schedule another goroutine onto the main thread when it yields.

The standard remedy is to pin the main goroutine to the main thread at the very earliest moment of the program, and then organize the code the other way around:

```go
// Lock the main goroutine to the main thread as soon as the program starts
func init() {
    runtime.LockOSThread()
}

func main() {
    // The main goroutine now sits firmly on the main thread: window and event loop run here
    initWindow()
    go appLogic()          // the real business logic moves to another goroutine
    for !window.ShouldClose() {
        glfw.PollEvents()  // must be on the main thread
        // ... swap buffers, drive rendering
    }
}
```

Note the inversion that happens here: in other languages the main thread runs the business logic and a separate thread waits on the UI; under this set of Go constraints it is the reverse. **The main thread is given over to the window and event loop, and the business logic is pushed into an ordinary goroutine.** All of Go's GUI and game frameworks, Ebitengine, Fyne, and Gio, hide this "lock the main thread plus invert" arrangement inside, simply packaged away for the user, who may never notice. Understanding it is what makes clear why these frameworks always have a startup function that must be called in `main` and cannot be placed in a goroutine.

## 19.2.4 The Binding Itself Is Thin; the Hard Part Is Threading

Finally a word about the term "binding" itself, because it is most easily mistaken for where the difficulty lies.

Exposing C APIs like OpenGL and Vulkan to Go is, technically, straightforward cgo work: the `go-gl` family of projects simply wraps the GL function prototypes one by one with cgo. The `purego` mentioned in [18.1.4](../ch18gpu/boundary.md) can do the same thing, and Ebitengine later switched to purego precisely to shed its dependency on a C compiler and make the graphics stack buildable in pure Go. Whichever route is taken, the mechanism of the binding layer is nothing new: it is the FFI boundary covered in Chapter 15 and 18.1, with functions passed across one to one.

What is genuinely hard, and what genuinely separates "works" from "works correctly," is the **thread discipline** this section is about: which thread the context binds to, whether goroutines migrate, which calls must be on the main thread. These constraints are not written in the binding's function signatures, yet they decide whether the program renders correctly or goes black and crashes. So in judging a Go graphics library, one should not look only at how many GL functions it binds, but at whether it has arranged `LockOSThread` and the main-thread constraint properly. Binding is manual labor; thread affinity is the real intellectual cost of this boundary in graphics.

## Summary

A graphics context is an implicit state machine bound to a thread, while a goroutine migrates across threads, and this conflict forces out the first iron rule of graphics programming: use `runtime.LockOSThread` to pin the render goroutine to one thread and let it own the context exclusively, a shape entirely isomorphic to Chapter 18's "thread-pinned single owner" for operating the device. Stricter platforms (macOS) additionally require window and event handling on the main thread, so a Go program is forced to "invert": the main thread is given over to the event loop, and the business logic moves into an ordinary goroutine. As for binding GL/Vulkan into Go, whether with cgo or purego, the mechanism is just a repeat of the boundary in 18.1; binding is manual labor, and thread discipline is the real difficulty.

Pushing rendering to the GPU always pays the cost of this boundary. The next section takes another road: [19.3](./software.md) looks at **software rendering** that does not depend on the GPU, where the computation happens right on the CPU, so goroutines and Go 1.27's `simd` take center stage, and that boundary vanishes completely for the first time.

## Further Reading

1. The Khronos Group. *OpenGL Wiki: OpenGL Context.*
   https://www.khronos.org/opengl/wiki/OpenGL_Context
   (The context as a per-thread "current" state machine, and the rules of currency under multithreading.)
2. go-gl. *github.com/go-gl/glfw: Tip about thread safety.*
   https://github.com/go-gl/glfw
   (GLFW's window and event calls must be on the main thread, and the use of `runtime.LockOSThread`.)
3. The Go Authors. *runtime.LockOSThread.* https://pkg.go.dev/runtime#LockOSThread
   (The semantics of pinning a goroutine to one OS thread, and the typical use of locking `main` to the main thread.)
4. Apple. *Thread Safety Summary / Main Thread Only.*
   https://developer.apple.com/documentation/appkit
   (The source of Cocoa/AppKit's requirement that UI operations be on the main thread.)
5. Ebitengine. *Migrating to purego.* https://ebitengine.org/
   (Moving the graphics stack from cgo to purego, the mechanism choice of the binding layer.)
6. This book: [9.5 Thread Management](../../part3concurrency/ch09sched/thread.md),
   [18.2 The Scheduler and Blocking External Calls](../ch18gpu/sched.md),
   [19.1 The Rendering Pipeline and Where Go Sits](./pipeline.md), [19.3 Software Rendering and Parallelism](./software.md).
