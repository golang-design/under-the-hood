---
weight: 6202
title: "19.2 Graphics Bindings and Thread Affinity"
---

# 19.2 Graphics Bindings and Thread Affinity

[19.1](./pipeline.md) placed Go in the application stage of the pipeline, where it issues draw
calls. Before the first draw call, a Go program must satisfy a constraint unrelated to graphics
itself: some graphics APIs and window systems tie state to operating-system threads, while
goroutines migrate between threads. The constraint has two layers. The first comes from OpenGL: a
context is "current" per thread. The second comes from the platform: windows and events must be
handled on the process's main thread. This section discusses the two layers in turn and how
`runtime.LockOSThread` satisfies them (the mechanism and cost of locking a thread are covered in
[9.5](../../part3concurrency/ch09sched/thread.md), and its use in device programming in
[18.2](../ch18gpu/sched.md)).

## 19.2.1 The OpenGL Context: A State Machine That Is Current per Thread

OpenGL is organized around the **context**. A context is a large implicit state machine holding the
currently bound shaders, textures, buffers, blend mode, viewport and other state. Most OpenGL
functions take no context parameter and act on the "current context": `glBindTexture` modifies the
texture binding in the current context, and `glDrawElements` uses all the state of the current
context.

"Current" is defined per thread. The OpenGL Wiki puts it this way: OpenGL commands need a current
context to take effect, and all commands affect the current context; the current context is a
thread-local variable, so multiple threads in one process may each have their own current context,
but a single context cannot be current in more than one thread at a time
[[Khronos, n.d.a](#ref-khronos-nda)]. The context interfaces on every platform follow this rule:
EGL's `eglMakeCurrent` binds a context to the calling thread [[Khronos, n.d.b](#ref-khronos-ndb)];
GLFW's `glfwMakeContextCurrent` makes a context current on the calling thread and requires that,
before the context is moved to another thread, it first be made non-current on the original thread
[[GLFW, n.d.](#ref-glfw-nd)].

A sequence of OpenGL calls must therefore be issued on the thread that holds the current context. If
some of them land on another thread with no current context, those calls lose the state they depend
on, and OpenGL does not guarantee the result.

Thread affinity is not common to all graphics APIs. Vulkan, discussed in 19.1.3, has no "current
context": objects are passed explicitly to each command as handles, and the specification only
requires external synchronization for some parameters, without confining calls to one thread. The
first constraint of this section applies to APIs such as OpenGL that organize state in thread-local
variables; the second constraint holds for every graphics API, because it comes from the window
system.

## 19.2.2 Goroutines Migrate, So Lock the Thread

The Go scheduler does not bind a goroutine to a thread. After a goroutine yields because of a system
call, a channel operation or preemption, it will likely continue on a different M (Chapter 9). For
pure Go code this migration is invisible. For OpenGL it means that between two calls the goroutine
may have moved to a thread with no current context.

`runtime.LockOSThread` is designed for such cases. Its documentation says that the calling goroutine
is wired to its current thread and that no other goroutine will run on that thread; a goroutine
should call it before calling operating-system services or non-Go library functions that depend on
per-thread state [[Go Authors, 2026](#ref-go-authors-2026)]. Rendering code is therefore usually
organized as a dedicated goroutine that first locks the thread, then makes the context current on
that thread, and thereafter issues all OpenGL calls. The following sketch uses the go-gl/glfw API
(`Scene` and `draw` stand for the application's own type and drawing function):

```go
// renderLoop exclusively owns the OpenGL context of win.
func renderLoop(win *glfw.Window, frames <-chan Scene) {
	runtime.LockOSThread() // from now on this goroutine runs only on the current thread
	defer runtime.UnlockOSThread()

	win.MakeContextCurrent() // the context becomes current on this thread
	defer glfw.DetachCurrentContext()

	for scene := range frames {
		draw(scene)       // all OpenGL calls are issued on the same thread
		win.SwapBuffers() // GLFW allows this to be called from any thread
	}
}
```

Other goroutines do not call OpenGL directly; they hand each frame's scene to this goroutine over a
channel. This is the same structure as the arrangement in 18.2, where one thread-locked goroutine
exclusively owns the device: whenever external state is bound to a thread, a thread-locked goroutine
is its sole owner and the other goroutines use it by communicating.

Locking has a cost. [9.5](../../part3concurrency/ch09sched/thread.md) points out that a locked M is
dedicated to one goroutine, and every time that goroutine blocks and wakes, the P must be handed off
between threads. The rendering goroutine should therefore receive work in units of whole frames and
avoid blocking frequently on small operations.

## 19.2.3 The Main Thread

Some platforms are stricter: windows and events must be handled by the process's **main thread**,
the thread that executes `main` when the process starts. The GLFW documentation states the scope of
this restriction:

```text
Initialization, termination, event processing and the creation and
destruction of windows, cursors and OpenGL and OpenGL ES contexts are all
restricted to the main thread due to limitations of one or several platforms.
```

macOS is the representative platform. Apple's Threading Programming Guide states that the
application's main thread handles events, that it is the thread blocked in the `run` method of
`NSApplication`, and that operations such as creating, destroying, resizing and moving an `NSView`
should be performed only on the main thread [[Apple, n.d.](#ref-apple-nd)].

A Go program's `main` function does not satisfy this requirement by default. The runtime's
`runtime.main` starts on the main thread (`m0`), locks the main goroutine to that thread during
initialization, and unlocks it when initialization finishes:

```go
func main() {
	mp := getg().m
	// ...
	// Lock the main goroutine onto this, the main OS thread,
	// during initialization. Most programs won't care, but a few
	// do require certain calls to be made by the main thread.
	// Those can arrange for main.main to run in the main thread
	// by calling runtime.LockOSThread during initialization
	// to preserve the lock.
	lockOSThread()

	if mp != &m0 {
		throw("runtime.main not on m0")
	}
	// ...
	for m := &firstmoduledata; true; m = m.next {
		doInit(m.inittasks)
		if m == last {
			break
		}
	}
	// ...
	close(main_init_done)

	needUnlock = false
	unlockOSThread()
	// ...
}
```

All `init` functions run inside `doInit` and therefore on the main thread. The runtime's internal
`lockOSThread` and the user's `LockOSThread` are counted separately, and the lock is released only
when both reach zero (9.5). If an `init` function calls `runtime.LockOSThread`, the runtime releases
only its own layer at the end of initialization, the user's lock stays in effect, and `main.main`
also runs on the main thread. The documentation of `LockOSThread` spells out this usage
[[Go Authors, 2026](#ref-go-authors-2026)], and the example program of go-gl/glfw begins with it
[[go-gl, n.d.](#ref-go-gl-nd)]. Combined with the rendering goroutine of the previous subsection,
the skeleton of a program looks like this:

```go
func init() {
	// init runs on the main thread; locking here makes main.main run on it too
	runtime.LockOSThread()
}

func main() {
	if err := glfw.Init(); err != nil { // initialization: main thread only
		log.Fatal(err)
	}
	defer glfw.Terminate()

	win, err := glfw.CreateWindow(640, 480, "demo", nil, nil) // create window and context: main thread only
	if err != nil {
		log.Fatal(err)
	}

	frames := make(chan Scene)
	go renderLoop(win, frames) // rendering: locked to another thread
	go simulate(frames)        // application logic: an ordinary goroutine

	for !win.ShouldClose() {
		glfw.WaitEvents() // event processing: main thread only
	}
}
```

The division of labor here is the opposite of the habit in many other languages. The main thread
does not run application logic; it is given to the window system's event loop. Application logic
runs in ordinary goroutines and sends an operation over when it needs the main thread. Go GUI and
game frameworks make this arrangement on the user's behalf, at the price of requiring the user to
call a blocking entry function from `main`. Ebitengine's `RunGame` must be called on the main
thread; Ebitengine uses `runtime.LockOSThread` to bind the main goroutine to the main thread and
provides `RunOnMainThread` so that other goroutines can run functions there
[[Ebitengine, n.d.](#ref-ebitengine-nd)]. Gio's `app.Main` must be called at the very end of `main`,
because some operating systems require it to take control of the main thread to run the window
[[Gio, n.d.](#ref-gio-nd)]. Fyne's `App.Run` should be called at the end of `main` and blocks; since
Fyne 2.6 it also provides `fyne.Do` and `fyne.DoAndWait`, which let background goroutines modify the
UI in Fyne's main run context [[Fyne, n.d.](#ref-fyne-nd)].

Programs that do not use these frameworks can use golang.design/x/mainthread
[[Ou, 2020](#ref-ou-2020)]. It distills the arrangement above into a small package: the package's
`init` calls `runtime.LockOSThread`, and `Init` puts the user's main function into a new goroutine
while looping on the main thread itself, executing the functions that other goroutines send through
`Call` (which waits for completion) or `Go` (which does not):

```go
func init() {
	runtime.LockOSThread()
}
// ...
func Init(main func()) {
	done := donePool.Get().(chan any)
	defer donePool.Put(done)

	go func() {
		defer func() {
			done <- nil
		}()
		main()
	}()

	for {
		select {
		case f := <-funcQ:
			dispatch(f)
		case <-done:
			return
		}
	}
}
```

`Call` sends the function and a completion channel into `funcQ` and then waits on the completion
channel; if the function panics on the main thread, the panic value is sent back and re-raised in
the caller's goroutine. The package has since been merged into golang.design/x/runtime and is
maintained there as the `mainthread` subpackage.

macOS adds a further restriction: if a program needs the Cocoa event loop, the main thread must
enter `[NSApp run]` and cannot at the same time sit in a Go `select` loop. For this reason
golang.design/x/hotkey carries a darwin-specific variant of `mainthread` [[Ou, 2021](#ref-ou-2021)].
Its `Init` likewise puts the user function into a new goroutine, while the main thread calls
`[NSApp run]` through cgo and hands itself to Cocoa. When another goroutine calls `Call`, the
function is first placed in a Go channel, a dispatch is then scheduled on the main queue with GCD's
`dispatch_async`, and Cocoa's event loop calls back into Go, which takes the function out and runs
it on the main thread. In this layout the main thread belongs to the platform's event loop and Go
code can enter it only as a callback. The hotkey documentation also notes that applications based on
Fyne, Ebitengine or Gio do not need this package, because those frameworks already run the event
loop on the main thread.

## 19.2.4 Bindings and Thread Discipline

Exposing C APIs such as OpenGL and Vulkan to Go is routine FFI work technically. The go-gl family of
projects wraps GL functions one by one with cgo ([15.6](../../part5toolchain/ch15compile/cgo.md)).
purego calls C functions without cgo; it originated in Ebitengine, which first achieved Go-only
builds on Windows, so that `GOOS=windows` could be set to cross-compile from any system, and the
purego project aims to bring this to other platforms [[purego, n.d.](#ref-purego-nd)]. Ebitengine
v2.4 (August 2022) announced "truly pure Go" on Windows [[Hoshi, 2022](#ref-hoshi-2022)]; since
v2.10 (September 2026), builds on macOS, Linux and BSD no longer need cgo either, so every desktop
platform can be built with Go alone [[Hoshi, 2026](#ref-hoshi-2026)]. The GPU layer of polyred
likewise reaches Metal, EGL/GLES and Vulkan through purego and can therefore be built with
`CGO_ENABLED=0` [[Ou, n.d.](#ref-ou-nd)].

Whichever approach is chosen, the mechanism of the binding layer is the FFI boundary discussed in
Chapter 15 and 18.1, and functions can be taken over one to one. What decides whether the program
runs correctly is the thread discipline discussed in this section: on which thread the context is
current, whether the goroutine may migrate, and which calls must happen on the main thread. These
constraints do not appear in function signatures, yet violating them can produce a black screen or a
crash. To evaluate a Go graphics library, then, look not only at how many APIs it covers but at how
it arranges `LockOSThread` and the main thread.

## Summary

An OpenGL context is an implicit state machine that is effective per thread, while goroutines
migrate between threads. The remedy is to lock the rendering goroutine to one thread with
`runtime.LockOSThread`, so that it owns the context exclusively and other goroutines communicate
with it over channels, the same structure as the thread-locked goroutine that owns the device in
Chapter 18. Explicit APIs such as Vulkan have no thread-local current context and require only
external synchronization. The window-system constraint is more general: GLFW confines
initialization, event processing and window creation to the main thread, and macOS requires the main
thread to handle events and views. A Go program uses `LockOSThread` in `init` to keep `main.main` on
the main thread, gives the main thread to the event loop, and moves application logic into ordinary
goroutines; Ebitengine, Gio, Fyne and the mainthread package each encapsulate this arrangement in
their own way. Whether the graphics API is bound through cgo or purego, the mechanism is the same
FFI boundary, and the part that needs real care is the threads.

Handing rendering to the GPU means accepting the constraints of this boundary. The next section
discusses another route: the software rendering of [19.3](./software.md) computes pixels entirely on
the CPU, gets its parallelism from goroutines and SIMD, and no longer goes through a graphics
driver.

## Further Reading

- <a id="ref-apple-nd"></a>[Apple, n.d.] Apple. *Threading Programming Guide: Thread Safety
  Summary.*
  https://developer.apple.com/library/archive/documentation/Cocoa/Conceptual/Multithreading/ThreadSafetySummary/ThreadSafetySummary.html
  AppKit: https://developer.apple.com/documentation/appkit The source of the Cocoa/AppKit
  constraints that the main thread handles events and that `NSView` is manipulated only on the main
  thread.
- <a id="ref-ebitengine-nd"></a>[Ebitengine, n.d.] Ebitengine. *Package ebiten: RunGame,
  RunOnMainThread.* https://pkg.go.dev/github.com/hajimehoshi/ebiten/v2#RunGame `RunGame` must be
  called on the main thread; the main goroutine is bound to the main thread with
  `runtime.LockOSThread`.
- <a id="ref-fyne-nd"></a>[Fyne, n.d.] Fyne. *Package fyne: App.Run, Do, DoAndWait.*
  https://pkg.go.dev/fyne.io/fyne/v2#Do `App.Run` blocks and runs the event loop; background
  goroutines modify the UI through `fyne.Do` (since 2.6).
- <a id="ref-gio-nd"></a>[Gio, n.d.] Gio. *Package app: Main.* https://pkg.go.dev/gioui.org/app#Main
  `app.Main` must be called at the end of `main` so that it can take the main thread to run the
  window.
- <a id="ref-glfw-nd"></a>[GLFW, n.d.] GLFW. *Introduction to the API: Thread safety.*
  https://www.glfw.org/docs/latest/intro_guide.html#thread_safety Context interface:
  https://www.glfw.org/docs/latest/group__context.html Which calls may be made only on the main
  thread, and the rules for moving a context between threads.
- <a id="ref-go-authors-2026"></a>[Go Authors, 2026] The Go Authors. *runtime.LockOSThread.*
  https://pkg.go.dev/runtime#LockOSThread The semantics of locking a goroutine to an
  operating-system thread, and the use of locking in `init` to make `main` run on the main thread.
  For the implementation see `src/runtime/proc.go` in Go 1.26.
- <a id="ref-go-gl-nd"></a>[go-gl, n.d.] go-gl. *github.com/go-gl/glfw: Usage.*
  https://github.com/go-gl/glfw Go bindings for GLFW; the example calls `runtime.LockOSThread` in
  `init` so that `main` runs on the main thread.
- <a id="ref-hoshi-2022"></a>[Hoshi, 2022] Hajime Hoshi. *v2.4.0 is released.* 2022-08-31.
  https://ebitengine.org/en/blog/v2.4.0.html
  Ebitengine no longer needs cgo on Windows.
- <a id="ref-hoshi-2026"></a>[Hoshi, 2026] Hajime Hoshi. *Ebitengine v2.10.0 Released.* 2026-09-08.
  https://ebitengine.org/en/blog/v2.10.0.html Original entry: Ebitengine. *Migrating to purego.*
  https://ebitengine.org/ Builds on macOS, Linux and BSD no longer need cgo; every desktop platform
  can be built with Go alone.
- <a id="ref-khronos-nda"></a>[Khronos, n.d.a] The Khronos Group. *OpenGL Wiki: OpenGL Context.*
  https://www.khronos.org/opengl/wiki/OpenGL_Context Archived:
  https://web.archive.org/web/20250917014911/https://www.khronos.org/opengl/wiki/OpenGL_Context The
  context as a state machine that is "current" per thread, and the currency rules under
  multithreading.
- <a id="ref-khronos-ndb"></a>[Khronos, n.d.b] The Khronos Group. *EGL Reference Pages:
  eglMakeCurrent.* https://registry.khronos.org/EGL/sdk/docs/man/html/eglMakeCurrent.xhtml Binds a
  context to the calling thread and a drawing surface.
- <a id="ref-ou-2020"></a>[Ou, 2020] Changkun Ou. *mainthread: schedule functions on the main
  thread.* https://github.com/golang-design/mainthread, 2020. Now
  golang.design/x/runtime/mainthread: https://github.com/golang-design/runtime Scheduling functions
  on the main thread; `Call`, `Go` and panic propagation.
- <a id="ref-ou-2021"></a>[Ou, 2021] Changkun Ou. *hotkey: cross platform hotkey package in Go.*
  https://github.com/golang-design/hotkey, 2021. The darwin implementation of the `mainthread`
  subpackage gives the main thread to `[NSApp run]` and runs Go functions through the GCD main
  queue.
- <a id="ref-ou-nd"></a>[Ou, n.d.] Changkun Ou. *polyred: 3D graphics in Go.*
  https://github.com/changkun/polyred
  The GPU layer reaches Metal, EGL/GLES and Vulkan through purego and builds with `CGO_ENABLED=0`.
- <a id="ref-purego-nd"></a>[purego, n.d.] The Ebitengine Authors. *purego: A library for calling C
  functions from Go without Cgo.* https://github.com/ebitengine/purego
  Calls C functions without cgo; the project originated in Ebitengine's pure-Go builds.
- This book: [9.5 Thread Management](../../part3concurrency/ch09sched/thread.md),
  [15.6 cgo](../../part5toolchain/ch15compile/cgo.md),
  [18.2 The Scheduler and Blocking Foreign Calls](../ch18gpu/sched.md),
  [19.1 The Rendering Pipeline and Where Go Sits](./pipeline.md),
  [19.3 Software Rendering and Parallelism](./software.md).
