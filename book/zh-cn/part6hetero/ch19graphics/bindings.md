---
weight: 6202
title: "19.2 图形绑定与线程亲和"
---

# 19.2 图形绑定与线程亲和

[19.1](./pipeline.md) 把 Go 定位在管线的应用阶段，由它发出绘制调用。在发出第一条绘制调用之前，Go 程序还要
满足一项与图形本身无关的约束：部分图形 API 与窗口系统把状态绑定在操作系统线程上，而 goroutine 会在线程之间
迁移。这项约束有两层。第一层来自 OpenGL：上下文按线程成为「当前」上下文。第二层来自平台：窗口与事件必须在
进程的主线程上处理。本节依次讨论这两层，以及 `runtime.LockOSThread` 如何满足它们（锁定线程的机制与代价见
[9.5](../../part3concurrency/ch09sched/thread.md)，在设备编程中的用法见 [18.2](../ch18gpu/sched.md)）。

## 19.2.1 OpenGL 上下文：按线程生效的状态机

OpenGL 围绕**上下文**（context）组织。上下文是一个庞大的隐式状态机，保存着当前绑定的着色器、纹理、缓冲、
混合模式与视口等状态。大多数 OpenGL 函数并不接收上下文参数，而是作用于「当前上下文」：`glBindTexture`
修改当前上下文中的纹理绑定，`glDrawElements` 使用当前上下文中的全部状态。

「当前」是按线程定义的。OpenGL Wiki 的说明是：OpenGL 命令要生效，必须有一个当前上下文，
所有命令都作用于当前上下文；当前上下文是一个线程局部变量，因此同一进程中的多个线程可以各有自己的当前上下
文，但同一个上下文不能同时在多个线程中成为当前上下文 [[Khronos, n.d.a](#ref-khronos-nda)]。
各平台的上下文接口都遵循这一规则：EGL 的 `eglMakeCurrent` 把上下文绑定到调用它的线程
[[Khronos, n.d.b](#ref-khronos-ndb)]；GLFW 的 `glfwMakeContextCurrent`
让上下文在调用线程上成为当前上下文，并要求把上下文移到另一条线程之前，先在原线程上解除它的当前状态
[[GLFW, n.d.](#ref-glfw-nd)]。

于是，一串 OpenGL 调用必须在持有当前上下文的那条线程上发出。若其中一部分落到另一条没有当前上下文的线程上，
这些调用就失去了它们所依赖的状态，结果不受 OpenGL 保证。

线程亲和并不是所有图形 API 的共性。19.1.3 讨论的 Vulkan 没有「当前上下文」，对象以句柄的形式显式传入每个
命令，规范只要求部分参数由调用者做外部同步，并不要求调用限定在某一条线程上。本节第一层约束针对的是 OpenGL
这类以线程局部状态组织的 API；第二层约束则对所有图形 API 都成立，因为它来自窗口系统。

## 19.2.2 goroutine 会迁移，因此要锁定线程

Go 的调度器不把 goroutine 绑定在某个线程上。一个 goroutine 因系统调用、通道操作或抢占而让出之后，
下一次很可能在另一个 M 上继续执行（第 9 章）。对纯 Go 代码，这种迁移不可见；对 OpenGL，
它意味着两次调用之间，goroutine 可能已经换到一条没有当前上下文的线程上。

`runtime.LockOSThread` 正是为这类场合设计的。它的文档写道，调用它的 goroutine 此后始终在当前线程上执行，
其他 goroutine 也不会在这条线程上执行；goroutine 在调用依赖线程状态的操作系统服务或非 Go 库函数之前，
应当先调用它 [[Go Authors, 2026](#ref-go-authors-2026)]。渲染代码因此通常组织为一个专门的 goroutine：
先锁定线程，再让上下文在这条线程上成为当前上下文，此后所有 OpenGL 调用都由它发出。下面以 go-gl/glfw 的
API 示意（`Scene` 与 `draw` 代表应用自己的类型与绘制函数）：

```go
// renderLoop 独占 win 的 OpenGL 上下文
func renderLoop(win *glfw.Window, frames <-chan Scene) {
	runtime.LockOSThread() // 此后本 goroutine 只在当前线程上执行
	defer runtime.UnlockOSThread()

	win.MakeContextCurrent() // 上下文在这条线程上成为当前上下文
	defer glfw.DetachCurrentContext()

	for scene := range frames {
		draw(scene)       // 所有 OpenGL 调用都在同一条线程上发出
		win.SwapBuffers() // GLFW 允许在任意线程上调用
	}
}
```

其他 goroutine 不直接调用 OpenGL，而是通过通道把每帧的场景交给它。这与 18.2 中用一个锁定线程的 goroutine
独占设备的安排是同一种结构：凡是外部状态绑定在线程上，就由一个锁定线程的 goroutine 作为它唯一的拥有者，
其余 goroutine 通过通信使用它。

锁定有代价。[9.5](../../part3concurrency/ch09sched/thread.md) 指出，被锁定的 M 由一个 goroutine 独占，这个
goroutine 每次阻塞与唤醒，P 都要在线程之间移交。因此渲染 goroutine 宜以帧为单位接收工作，避免为细小的操作
频繁阻塞。

## 19.2.3 主线程

有些平台的要求更严格：窗口与事件必须由进程的**主线程**处理，即进程启动时执行 `main` 的那条线程。GLFW
文档说明了这一约束的范围：

```text
Initialization, termination, event processing and the creation and
destruction of windows, cursors and OpenGL and OpenGL ES contexts are all
restricted to the main thread due to limitations of one or several platforms.
```

即由于一个或多个平台的限制，初始化与终止、事件处理，以及窗口、光标与 OpenGL 上下文的创建和销毁，都只能在
主线程上进行 [[GLFW, n.d.](#ref-glfw-nd)]。macOS 是这类平台的代表。Apple 的线程编程指南写明，应用的主线程
负责处理事件，它是阻塞在 `NSApplication` 的 `run` 方法中的那条线程；`NSView` 的创建、销毁、缩放与移动等
操作只应在主线程上进行 [[Apple, n.d.](#ref-apple-nd)]。

Go 程序的 `main` 函数并不天然满足这一要求。运行时的 `runtime.main` 在主线程（`m0`）上启动，初始化期间把
main goroutine 锁定在这条线程上，初始化结束后再解除锁定：

```go
func main() {
	mp := getg().m
	// ……
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
	// ……
	for m := &firstmoduledata; true; m = m.next {
		doInit(m.inittasks)
		if m == last {
			break
		}
	}
	// ……
	close(main_init_done)

	needUnlock = false
	unlockOSThread()
	// ……
}
```

所有 `init` 函数都在 `doInit` 中执行，因此都运行在主线程上。运行时内部的 `lockOSThread` 与用户调用的
`LockOSThread` 分别计数，只有两者都归零时锁定才解除（9.5）。若某个 `init` 函数调用了
`runtime.LockOSThread`，运行时在初始化结束时解除的只是自己那一层，用户的锁定仍然有效，`main.main`
于是也在主线程上运行。`LockOSThread` 的文档明确写出了这一用法 [[Go Authors, 2026](#ref-go-authors-2026)]，go-gl/glfw
的示例程序也以此开头 [[go-gl, n.d.](#ref-go-gl-nd)]。把它与上一小节的渲染 goroutine 结合起来，
程序的骨架如下：

```go
func init() {
	// init 在主线程上执行；在这里锁定，main.main 也将运行在主线程上
	runtime.LockOSThread()
}

func main() {
	if err := glfw.Init(); err != nil { // 初始化：只能在主线程
		log.Fatal(err)
	}
	defer glfw.Terminate()

	win, err := glfw.CreateWindow(640, 480, "demo", nil, nil) // 创建窗口与上下文：只能在主线程
	if err != nil {
		log.Fatal(err)
	}

	frames := make(chan Scene)
	go renderLoop(win, frames) // 渲染：锁定在另一条线程上
	go simulate(frames)        // 应用逻辑：普通的 goroutine

	for !win.ShouldClose() {
		glfw.WaitEvents() // 事件处理：只能在主线程
	}
}
```

这里的分工与许多其他语言中的习惯相反。主线程不运行应用逻辑，而是交给窗口系统的事件循环；
应用逻辑运行在普通的 goroutine 中，需要访问主线程时再把操作送过去。Go 的 GUI
与游戏框架都替用户做了这项安排，代价是要求用户从 `main` 中调用某个阻塞的入口函数：Ebitengine 的 `RunGame`
必须在主线程上调用，Ebitengine 用 `runtime.LockOSThread` 把 main goroutine 绑定在主线程上，并提供
`RunOnMainThread` 供其他 goroutine 在主线程上执行函数 [[Ebitengine, n.d.](#ref-ebitengine-nd)]；Gio 的
`app.Main` 必须在 `main` 函数的最后调用，理由是某些操作系统要求由它掌握主线程来运行窗口
[[Gio, n.d.](#ref-gio-nd)]；Fyne 的 `App.Run` 应在 `main` 函数末尾调用并一直阻塞，Fyne 2.6 起又提供
`fyne.Do` 与 `fyne.DoAndWait`，供后台 goroutine 在 Fyne 的主运行上下文中修改界面
[[Fyne, n.d.](#ref-fyne-nd)]。

不依赖这些框架的程序可以使用 golang.design/x/mainthread [[Ou, 2020](#ref-ou-2020)]。
它把上述安排抽成一个小包：包的 `init` 调用 `runtime.LockOSThread`，`Init` 把用户的主函数放进一个新的
goroutine，自己则在主线程上循环，执行其他 goroutine 经 `Call`（等待执行完毕）或 `Go`（不等待）送来的函数：

```go
func init() {
	runtime.LockOSThread()
}
// ……
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

`Call` 把函数和一个完成通道送入 `funcQ`，再等待完成通道；若函数在主线程上 panic，panic
的值会被送回并在调用者的 goroutine 中重新抛出。这个包现已并入 golang.design/x/runtime，以 `mainthread`
子包的形式继续维护。

在 macOS 上还有一层限制：若程序需要 Cocoa 的事件循环，主线程必须进入 `[NSApp run]`，无法同时停在 Go 的
`select` 循环里。golang.design/x/hotkey 为此带有一个 darwin 专用的 `mainthread` 变体
[[Ou, 2021](#ref-ou-2021)]：`Init` 同样把用户函数放进新的 goroutine，主线程则经 cgo 调用 `[NSApp run]`，
把自己交给 Cocoa；其他 goroutine 调用 `Call` 时，函数先被放入一个 Go 通道，再经 GCD 的 `dispatch_async`
在主队列上安排一次分发，由 Cocoa 的事件循环回调到 Go，在主线程上取出并执行。在这种布局下，
主线程归平台的事件循环所有，Go 代码只能以回调的方式进入主线程。hotkey 的文档也指出，基于 Fyne、Ebitengine
或 Gio 的应用不需要这个包，因为这些框架已经在主线程上运行了事件循环。

## 19.2.4 绑定与线程纪律

把 OpenGL、Vulkan 这些 C API 暴露给 Go，在技术上是常规的 FFI 工作。go-gl 系列项目用
cgo（[15.6](../../part5toolchain/ch15compile/cgo.md)）逐个包装 GL 函数。purego 则不经 cgo 调用 C 函数，
它起源于 Ebitengine：Ebitengine 先在 Windows 上做到只用 Go 构建，从而可以在任何系统上设置 `GOOS=windows`
交叉编译，purego 项目的目标是把这一点带到其他平台 [[purego, n.d.](#ref-purego-nd)]。Ebitengine
v2.4（2022 年 8 月）宣布在 Windows 上「真正纯 Go」[[Hoshi, 2022](#ref-hoshi-2022)]；v2.10（2026 年 9 月）
起，macOS、Linux 与 BSD 上的构建也不再需要 cgo，所有桌面平台都可以只用 Go 构建
[[Hoshi, 2026](#ref-hoshi-2026)]。polyred 的 GPU 层同样经 purego 访问 Metal、EGL/GLES 与 Vulkan，
因此可以在 `CGO_ENABLED=0` 下构建 [[Ou, n.d.](#ref-ou-nd)]。

无论选择哪种方式，绑定层的机制都是第 15 章与 18.1 讨论过的 FFI 边界，函数逐个对应地接过来即可。
决定程序能否正确运行的，是本节讨论的线程纪律：上下文在哪条线程上是当前的，goroutine 是否可能迁移，
哪些调用必须在主线程上进行。这些约束不出现在函数签名里，违反它们的后果却可能是黑屏或崩溃。因此评价一个 Go
图形库，除了看它覆盖了多少 API，更要看它如何安排 `LockOSThread` 与主线程。

## 小结

OpenGL 上下文是按线程生效的隐式状态机，而 goroutine 会在线程之间迁移。解决办法是用 `runtime.LockOSThread`
把渲染 goroutine 锁定在一条线程上，由它独占上下文，其余 goroutine 经通道与它通信，
这与第 18 章中由一个锁定线程的 goroutine 独占设备的结构相同。Vulkan 这类显式 API
没有线程局部的当前上下文，只要求外部同步。窗口系统的约束则更普遍：GLFW 把初始化、
事件处理与窗口创建限定在主线程，macOS 要求主线程处理事件与视图。Go 程序借助 `init` 中的 `LockOSThread` 让
`main.main` 留在主线程，把主线程交给事件循环，应用逻辑移入普通 goroutine；Ebitengine、Gio、Fyne 与
mainthread 包都以各自的方式封装了这一安排。至于用 cgo 还是 purego 绑定图形 API，机制上都是同一道 FFI
边界，真正需要用心安排的是线程。

把渲染交给 GPU，就要承担这道边界的种种约束。下一节讨论另一条路线：[19.3](./software.md) 的软件渲染完全在
CPU 上计算像素，并行由 goroutine 与 SIMD 提供，不再经过图形驱动。

## 延伸阅读

- <a id="ref-apple-nd"></a>[Apple, n.d.] Apple. *Threading Programming Guide: Thread Safety Summary.*
  https://developer.apple.com/library/archive/documentation/Cocoa/Conceptual/Multithreading/ThreadSafetySummary/ThreadSafetySummary.html
  AppKit：https://developer.apple.com/documentation/appkit
  Cocoa/AppKit 要求主线程处理事件、只在主线程操作 `NSView` 的约束来源。
- <a id="ref-ebitengine-nd"></a>[Ebitengine, n.d.] Ebitengine. *Package ebiten: RunGame, RunOnMainThread.*
  https://pkg.go.dev/github.com/hajimehoshi/ebiten/v2#RunGame
  `RunGame` 须在主线程调用，main goroutine 经 `runtime.LockOSThread` 绑定到主线程。
- <a id="ref-fyne-nd"></a>[Fyne, n.d.] Fyne. *Package fyne: App.Run, Do, DoAndWait.*
  https://pkg.go.dev/fyne.io/fyne/v2#Do
  `App.Run` 阻塞并运行事件循环；后台 goroutine 经 `fyne.Do` 修改界面（自 2.6）。
- <a id="ref-gio-nd"></a>[Gio, n.d.] Gio. *Package app: Main.* https://pkg.go.dev/gioui.org/app#Main
  `app.Main` 须在 `main` 函数最后调用，以便掌握主线程运行窗口。
- <a id="ref-glfw-nd"></a>[GLFW, n.d.] GLFW. *Introduction to the API: Thread safety.*
  https://www.glfw.org/docs/latest/intro_guide.html#thread_safety
  上下文接口：https://www.glfw.org/docs/latest/group__context.html
  哪些调用只能在主线程进行，上下文在线程之间移动的规则。
- <a id="ref-go-authors-2026"></a>[Go Authors, 2026] The Go Authors. *runtime.LockOSThread.*
  https://pkg.go.dev/runtime#LockOSThread
  把 goroutine 锁定在一条操作系统线程上的语义，以及在 `init` 中锁定使 `main` 运行在主线程上的用法。
  实现见 Go 1.26 的 `src/runtime/proc.go`。
- <a id="ref-go-gl-nd"></a>[go-gl, n.d.] go-gl. *github.com/go-gl/glfw: Usage.*
  https://github.com/go-gl/glfw
  GLFW 的 Go 绑定；示例在 `init` 中调用 `runtime.LockOSThread`，使 `main` 运行在主线程上。
- <a id="ref-hoshi-2022"></a>[Hoshi, 2022] Hajime Hoshi. *v2.4.0 is released.* 2022-08-31.
  https://ebitengine.org/en/blog/v2.4.0.html
  Ebitengine 在 Windows 上不再需要 cgo。
- <a id="ref-hoshi-2026"></a>[Hoshi, 2026] Hajime Hoshi. *Ebitengine v2.10.0 Released.* 2026-09-08.
  https://ebitengine.org/en/blog/v2.10.0.html
  原条目：Ebitengine. *Migrating to purego.* https://ebitengine.org/
  macOS、Linux 与 BSD 构建不再需要 cgo，所有桌面平台都可只用 Go 构建。
- <a id="ref-khronos-nda"></a>[Khronos, n.d.a] The Khronos Group. *OpenGL Wiki: OpenGL Context.*
  https://www.khronos.org/opengl/wiki/OpenGL_Context
  存档：https://web.archive.org/web/20250917014911/https://www.khronos.org/opengl/wiki/OpenGL_Context
  上下文作为按线程「当前」的状态机，以及多线程下的当前性规则。
- <a id="ref-khronos-ndb"></a>[Khronos, n.d.b] The Khronos Group. *EGL Reference Pages: eglMakeCurrent.*
  https://registry.khronos.org/EGL/sdk/docs/man/html/eglMakeCurrent.xhtml
  把上下文绑定到调用线程与绘制表面。
- <a id="ref-ou-2020"></a>[Ou, 2020] Changkun Ou. *mainthread: schedule functions on the main thread.*
  https://github.com/golang-design/mainthread, 2020.
  现为 golang.design/x/runtime/mainthread：https://github.com/golang-design/runtime
  在主线程上调度函数执行；`Call`、`Go` 与 panic 的传递。
- <a id="ref-ou-2021"></a>[Ou, 2021] Changkun Ou. *hotkey: cross platform hotkey package in Go.*
  https://github.com/golang-design/hotkey, 2021.
  `mainthread` 子包的 darwin 实现把主线程交给 `[NSApp run]`，经 GCD 主队列执行 Go 函数。
- <a id="ref-ou-nd"></a>[Ou, n.d.] Changkun Ou. *polyred: 3D graphics in Go.*
  https://github.com/changkun/polyred
  GPU 层经 purego 访问 Metal、EGL/GLES 与 Vulkan，可在 `CGO_ENABLED=0` 下构建。
- <a id="ref-purego-nd"></a>[purego, n.d.] The Ebitengine Authors. *purego: A library for calling C
  functions from Go without Cgo.* https://github.com/ebitengine/purego
  不经 cgo 调用 C 函数；项目缘起于 Ebitengine 的纯 Go 构建。
- 本书 [9.5 线程管理](../../part3concurrency/ch09sched/thread.md)、[15.6
  cgo](../../part5toolchain/ch15compile/cgo.md)、[18.2
  调度器与阻塞的外部调用](../ch18gpu/sched.md)、[19.1 渲染管线与 Go 的位置](./pipeline.md)、[19.3
  软件渲染与并行](./software.md)。
