---
weight: 6202
title: "19.2 图形绑定与线程亲和"
---

# 19.2 图形绑定与线程亲和

[19.1](./pipeline.md) 说 Go 坐在管线的应用阶段，负责发起绘制调用。可在真正发出第一条绘制调用
之前，有一道坎横在所有 Go 图形程序面前，它不来自图形本身，而来自 Go 的并发模型与图形 API 的
一个根本矛盾:**图形上下文绑定线程，而 goroutine 会迁移线程**。这道坎是本节的主角，
而 [18.2.5](../ch18gpu/sched.md) 那把钥匙 `LockOSThread`,在这里从一个可选的技巧变成了必需。

## 19.2.1 上下文：一个绑定线程的隐式状态机

OpenGL 这类图形 API 是围绕**上下文**(context)组织的。上下文是一个庞大的隐式状态机:当前绑定
的着色器、纹理、缓冲、混合模式、视口……几乎所有 API 调用都不显式地接收上下文参数，而是隐式地
作用在「当前上下文」上。`glBindTexture` 绑的是当前上下文里的纹理槽，`glDrawElements` 用的是当前
上下文里的一整套状态。

关键在于「当前」二字是**按线程**定义的:一个 OpenGL 上下文在某个时刻「当前于」某一条特定的 OS
线程。你在线程 A 上把上下文设为当前、配置好状态、发出绘制调用，这一切都依附在线程 A 上。
如果同一串 OpenGL 调用里，有一部分跑到了线程 B 上,而线程 B 上并没有这个当前上下文,那些调用
要么直接失败，要么作用在一个空的上下文上，画面一片漆黑。

## 19.2.2 goroutine 会迁移，于是必须钉住

这正是 Go 的并发模型撞上图形 API 的地方。回忆第 9 章:goroutine 不绑定固定的线程，调度器会
把它在不同的 M 之间**迁移**,这次在线程 A 上跑，一次抢占、一次系统调用、一次通道阻塞之后，
下次很可能就被调度到线程 B 上继续。对纯 Go 代码，这种迁移是透明的、无害的，正是 M:N 调度的
红利。可对 OpenGL,它是灾难:

> 一个发着 OpenGL 调用的 goroutine，一旦在调用之间被迁移到别的线程，当前上下文就不在了。

解药是 `runtime.LockOSThread`:把这个 goroutine **钉死**在它当前的 M 上，从此不再迁移,
于是它发出的每一条 OpenGL 调用都落在同一条线程、同一个当前上下文上。把这一手与
18.2.5 的「设备 goroutine」合起来，图形渲染的标准骨架就出来了，它与上一章操作 GPU 的骨架
**一模一样**:

```go
// 渲染 goroutine：钉住线程，独占图形上下文，对外只暴露一个 channel
func renderLoop(frames <-chan Scene) {
    runtime.LockOSThread()          // 钉住：上下文从此只在这条线程上当前
    defer runtime.UnlockOSThread()
    ctx := makeContextCurrent(win)  // 上下文绑定到这条线程
    for scene := range frames {
        draw(ctx, scene)            // 所有 GL 调用都在同一条线程上
        win.SwapBuffers()
    }
}
```

这绝非巧合。无论对岸是做通用计算的 CUDA 上下文，还是做渲染的 OpenGL 上下文，**「绑定线程的
外部状态」遇上「会迁移的 goroutine」,答案永远是把一个 goroutine 钉在一条线程上独占它**。
第 18 章在最贴近硬件处推出的这个形态，在图形里又一次成立。

## 19.2.3 主线程的暴政

钉住一条线程还不够，有些平台更苛刻:它要求图形与窗口必须跑在**那条特定的主线程**上，
也就是进程启动时运行 `main` 的第 0 号线程。

最典型的是 macOS。它的窗口系统 Cocoa/AppKit 规定:所有窗口管理、事件处理必须在主线程上进行。
GLFW 这类跨平台窗口库于是也把约束传导上来,它的文档白纸黑字:窗口的创建、事件的轮询
（`glfwPollEvents`)必须从主线程调用。这对 Go 是个尴尬:Go 程序里 `main` 函数固然一开始跑在
主线程上，但 `main` 也只是一个普通 goroutine，调度器随时可能把它迁走，或在它让出时把别的
goroutine 调度到主线程上。

标准解法是在程序最早期就把主 goroutine 钉死在主线程,然后反过来组织代码:

```go
// 让 main goroutine 在程序一启动就锁死在主线程
func init() {
    runtime.LockOSThread()
}

func main() {
    // main goroutine 现在稳稳待在主线程上：窗口与事件循环跑在这里
    initWindow()
    go appLogic()          // 真正的业务逻辑挪到别的 goroutine
    for !window.ShouldClose() {
        glfw.PollEvents()  // 必须在主线程
        // ……交换缓冲、驱动渲染
    }
}
```

注意这里发生了一次「主从颠倒」:在别的语言里，主线程跑业务逻辑、另开线程伺候 UI;在 Go 这套约束下
反过来，**主线程被让给窗口与事件循环，业务逻辑被赶到普通 goroutine 里**。所有 Go 的 GUI 与游戏
框架,Ebitengine、Fyne、Gio,内部都藏着这套「锁定主线程 + 主从颠倒」的安排，只是替用户封装好了，
用户未必察觉。理解它，才明白为什么这些框架总有一个必须在 `main` 里调用、且不能放进 goroutine 的
启动函数。

## 19.2.4 绑定本身是薄的，难的是线程

最后说说「绑定」这个词本身，因为它最容易被误解为难点所在。

把 OpenGL、Vulkan 这些 C API 暴露给 Go,技术上是直白的 cgo 工作:`go-gl` 系列项目就是把
GL 的函数原型逐个用 cgo 包装出来。[18.1.4](../ch18gpu/boundary.md) 提过的 `purego` 也能做这件事，
Ebitengine 后来正是改用 purego,从而摆脱了对 C 编译器的依赖，把图形栈做成了纯 Go 可构建。
无论走哪条，绑定层的机制都不新鲜,它就是第 15 章和 18.1 讲过的那道 FFI 边界，函数一一对应地接过来
而已。

真正难的、也真正区分「能用」与「能用对」的，是这一节讲的**线程纪律**:上下文绑定哪条线程、
goroutine 会不会迁移、哪些调用必须在主线程。这些约束不写在绑定的函数签名里，却决定了程序是
正常出图还是黑屏崩溃。所以评价一个 Go 图形库，不该只看它绑了多少 GL 函数，更要看它有没有把
`LockOSThread` 与主线程的约束安排妥当。绑定是体力活，线程亲和才是这道边界在图形里真正的智力
成本。

## 小结

图形上下文是一个绑定线程的隐式状态机，而 goroutine 会在线程间迁移,这对矛盾逼出了图形编程的第一
条铁律:用 `runtime.LockOSThread` 把渲染 goroutine 钉死在一条线程上独占上下文,这与第 18 章操作
设备的「钉住线程的单一拥有者」形态完全同构。更苛刻的平台（macOS)还要求窗口与事件必须在主线程，
于是 Go 程序被迫「主从颠倒」:主线程让给事件循环，业务逻辑挪进普通 goroutine。至于把 GL/Vulkan
绑进 Go,无论用 cgo 还是 purego,机制都只是 18.1 那道边界的重复,绑定是体力活，线程纪律才是真正的
难点。

把渲染推给 GPU 始终要付这道边界的代价。下一节走另一条路:[19.3](./software.md) 看不依赖 GPU 的
**软件渲染**,计算就地在 CPU 上完成，于是 goroutine 与 Go 1.27 的 `simd` 成了主角，
那条边界第一次彻底消失。

## 延伸阅读的文献

1. The Khronos Group. *OpenGL Wiki: OpenGL Context.*
   https://www.khronos.org/opengl/wiki/OpenGL_Context
   （上下文作为按线程「当前」的状态机，及多线程下的当前性规则）
2. go-gl. *github.com/go-gl/glfw: Tip about thread safety.*
   https://github.com/go-gl/glfw
   （GLFW 的窗口与事件调用必须在主线程，及 `runtime.LockOSThread` 的用法）
3. The Go Authors. *runtime.LockOSThread.* https://pkg.go.dev/runtime#LockOSThread
   （把 goroutine 钉在一条 OS 线程上的语义，及 `main` 锁定主线程的典型用法）
4. Apple. *Thread Safety Summary / Main Thread Only.*
   https://developer.apple.com/documentation/appkit
   （Cocoa/AppKit 要求 UI 操作在主线程的约束来源）
5. Ebitengine. *Migrating to purego.* https://ebitengine.org/
   （把图形栈从 cgo 迁到 purego，绑定层的机制选择）
6. 本书 [9.5 线程管理](../../part3concurrency/ch09sched/thread.md)、
   [18.2 调度器与阻塞的外部调用](../ch18gpu/sched.md)、
   [19.1 渲染管线与 Go 的位置](./pipeline.md)、[19.3 软件渲染与并行](./software.md)。
