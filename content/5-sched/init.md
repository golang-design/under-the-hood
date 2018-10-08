# 5 调度器: 初始化

我们已经在 [2 初始化概览](2-init.md) 中粗略看过了 `schedinit` 函数，现在我们来仔细看看里面真正关于调度器的初始化步骤。
M/P/G 彼此的初始化顺序遵循：`mcommoninit` --> `procresize` --> `newproc`。

## M 初始化

TODO:

```go
func mcommoninit(mp *m) {
	_g_ := getg()

	// 检查当前 g 是否是 g0
	// g0 栈对用户而言是没有意义的（且不是不可避免的）
	if _g_ != _g_.m.g0 {
		callers(1, mp.createstack[:])
	}

	// 锁住调度器
	lock(&sched.lock)
	// 确保线程数量不会太多而溢出
	if sched.mnext+1 < sched.mnext {
		throw("runtime: thread ID overflow")
	}
	// mnext 表示当前 m 的数量，还表示下一个 m 的 id
	mp.id = sched.mnext
	// 增加 m 的数量
	sched.mnext++
	// 检查 m 的数量不会太多
	checkmcount()

	// 用于 fastrand 快速取随机数
	mp.fastrand[0] = 1597334677 * uint32(mp.id)
	mp.fastrand[1] = uint32(cputicks())
	if mp.fastrand[0]|mp.fastrand[1] == 0 {
		mp.fastrand[1] = 1
	}

	// 初始化 gsignal
	mpreinit(mp)
	if mp.gsignal != nil {
		mp.gsignal.stackguard1 = mp.gsignal.stack.lo + _StackGuard
	}

	// 添加到 allm 中，从而当它刚保存到寄存器或本地线程存储时候 GC 不会释放 g->m
	mp.alllink = allm

	// NumCgoCall() 会在没有使用 schedlock 时遍历 allm，等价于 allm = mp
	atomicstorep(unsafe.Pointer(&allm), unsafe.Pointer(mp))
	unlock(&sched.lock)

	// 分配内存来保存当 cgo 调用崩溃时候的回溯
	if iscgo || GOOS == "solaris" || GOOS == "windows" {
		mp.cgoCallers = new(cgoCallers)
	}
}
```

## P 初始化

在看 `runtime.procresize` 函数之前，我们先概览一遍 P 的状态机。

```
所有的 P 状态：
_Pidle
_Prunning
_Psyscall
_Pgcstop
_Pdead


   普通情况下，P 仅在这四种状态下切换
+------------------------------------------------------------------------------------------+
|                         sysmon retake                                                    |
|          +-------------------+---------------------+-------------------------+           |
|          +-------------------+-----------------+   |                         |           |
| New P    |   startTheWorld   v                 v   |                         |           |
|  +----------+            +--------+ acquirep +-----------+  entersyscall +-----------+   |
|  |          | ---------> |        | -------> |           | ------------> |           |   |
|  | _Pgcstop | procresize | _Pidle |          | _Prunning |               | _Psyscall |   |
|  |          |            |        | <------- |           | <-----------  |           |   |
|  +----------+            +--------+ releasep +-----------+  exitsyscall  +-----------+   |
|       ^                       |                    |                        |            |
|       |                       |                    |                        |            |
|       +-----------------------+--------------------+------------------------+            |
|          if GC                                                                           |
+------------------------------------------------------------------------------------------+
       |                               ^
       |            +--------+         | _Prunning 或 _Pidle
       |            |        |         | 
       +----------> | _Pdead | --------+
                    |        |
                    +--------+
               GOMAXPROCS -> startTheWorld -> procresize
               当要求动态调整 P 时，会调整为 _Pdead 作为中间态
               要么被调整为 _Prunning 或 _Pidle，要么被释放掉
```

通常情况下（在程序运行时不调整 P 的个数），P 只会在四种状态下进行切换。
当程序刚开始运行进行初始化时，所有的 P 都处于 `_Pgcstop` 状态，
随着 P 的初始化（`runtime.procresize`），会被置于 `_Pidle`（马上讨论）。

当 M 需要运行时，会 `runtime.acquirep`，并通过 `runtime.releasep` 来释放。
当 G 执行时需要进入系统调用时，P 会被设置为 `_Psyscall`，如果这个时候被系统监控抢夺（`runtime.retake`），则 P 会被重新修改为 `_Pidle`。
如果在程序运行中发生 GC，则 P 会被设置为 `_Pgcstop`，并在 `runtime.startTheWorld` 时重新调整为 `_Pidle` 或者 `_Prunning`。

这里我们还在讨论初始化过程，我们先只关注 `runtime.procresize` 这个函数：


```go
// 修改 P 的数量，此时所有工作均被停止 STW，sched 被锁定
// gcworkbufs 既不会被 GC 修改，也不会被 write barrier 修改
// 返回带有 local work 的 P 列表，他们需要被调用方调度
func procresize(nprocs int32) *p {
	// 获取先前的 P 个数
	old := gomaxprocs
	// 边界检查
	if old < 0 || nprocs <= 0 {
		throw("procresize: invalid arg")
	}
	// trace 相关
	if trace.enabled {
		traceGomaxprocs(nprocs)
	}

	// 更新统计信息，记录此次修改 gomaxprocs 的时间
	now := nanotime()
	if sched.procresizetime != 0 {
		sched.totaltime += int64(old) * (now - sched.procresizetime)
	}
	sched.procresizetime = now

	// 必要时增加 allp
	// 这个时候本质上是在检查用户代码是否有调用过 runtime.MAXGOPROCS 调整 p 的数量
	// 此处多一步检查是为了避免内部的锁，如果 nprocs 明显小于 allp 的可见数量（因为 len）
	// 则不需要进行加锁
	if nprocs > int32(len(allp)) {
		// 此处与 retake 同步，它可以同时运行，因为它不会在 P 上运行。
		lock(&allpLock)
		// 如果 nprocs 被调小了
		if nprocs <= int32(cap(allp)) {
			// 扔掉多余的 p
			allp = allp[:nprocs]
		} else {
			// 否则（调大了）创建更多的 p
			nallp := make([]*p, nprocs)
			// 将原有的 p 复制到新创建的 new all p 中，不浪费旧的 p
			copy(nallp, allp[:cap(allp)])
			allp = nallp
		}
		unlock(&allpLock)
	}

	// 初始化新的 P
	for i := int32(0); i < nprocs; i++ {
		pp := allp[i]

		// 如果 p 是新创建的(新创建的 p 在数组中为 nil)，则申请新的 P 对象
		if pp == nil {
			pp = new(p)
			// p 的 id 就是它在 allp 中的索引
			pp.id = i
			// 新创建的 p 处于 _Pgcstop 状态
			pp.status = _Pgcstop
			pp.sudogcache = pp.sudogbuf[:0]
			for i := range pp.deferpool {
				pp.deferpool[i] = pp.deferpoolbuf[i][:0]
			}
			pp.wbBuf.reset()

			// 保存至 allp, allp[i] = pp
			atomicstorep(unsafe.Pointer(&allp[i]), unsafe.Pointer(pp))
		}

		// 为 P 分配 cache 对象
		if pp.mcache == nil {
			// 如果 old == 0 且 i == 0 说明这是引导阶段初始化第一个 p
			if old == 0 && i == 0 {
				// 确认当前 g 的 m 的 mcache 分空
				if getg().m.mcache == nil {
					throw("missing mcache?")
				}
				pp.mcache = getg().m.mcache
			} else {
				// 创建 cache
				pp.mcache = allocmcache()
			}
		}

		// race 检测相关
		if raceenabled && pp.racectx == 0 {
			if old == 0 && i == 0 {
				pp.racectx = raceprocctx0
				raceprocctx0 = 0
			} else {
				pp.racectx = raceproccreate()
			}
		}
	}

	// 释放未使用的 P，一般情况下不会执行这段代码
	for i := nprocs; i < old; i++ {
		p := allp[i]

		// trace 相关
		if trace.enabled && p == getg().m.p.ptr() {
			// moving to p[0], pretend that we were descheduled
			// and then scheduled again to keep the trace sane.
			traceGoSched()
			traceProcStop(p)
		}

		// 将所有 runnable goroutine 移动至全局队列
		for p.runqhead != p.runqtail {
			// 从本地队列中 pop
			p.runqtail--
			gp := p.runq[p.runqtail%uint32(len(p.runq))].ptr()
			// push 到全局队列中
			globrunqputhead(gp)
		}
		if p.runnext != 0 {
			globrunqputhead(p.runnext.ptr())
			p.runnext = 0
		}
		// if there's a background worker, make it runnable and put
		// it on the global queue so it can clean itself up
		if gp := p.gcBgMarkWorker.ptr(); gp != nil {
			casgstatus(gp, _Gwaiting, _Grunnable)
			if trace.enabled {
				traceGoUnpark(gp, 0)
			}
			globrunqput(gp)
			// This assignment doesn't race because the
			// world is stopped.
			p.gcBgMarkWorker.set(nil)
		}
		// Flush p's write barrier buffer.
		if gcphase != _GCoff {
			wbBufFlush1(p)
			p.gcw.dispose()
		}
		for i := range p.sudogbuf {
			p.sudogbuf[i] = nil
		}
		p.sudogcache = p.sudogbuf[:0]
		for i := range p.deferpool {
			for j := range p.deferpoolbuf[i] {
				p.deferpoolbuf[i][j] = nil
			}
			p.deferpool[i] = p.deferpoolbuf[i][:0]
		}
		// 释放当前 P 绑定的 cache
		freemcache(p.mcache)
		p.mcache = nil

		// 将当前 P 的 G 复链转移到全局
		gfpurge(p)
		traceProcFree(p)
		if raceenabled {
			raceprocdestroy(p.racectx)
			p.racectx = 0
		}
		p.gcAssistTime = 0
		p.status = _Pdead
		// 这里不能释放 P，因为它可能被一个正在系统调用中的 M 引用
	}

	// 清理完毕后，修剪 allp, nprocs 个数之外的所有 P
	if int32(len(allp)) != nprocs {
		lock(&allpLock)
		allp = allp[:nprocs]
		unlock(&allpLock)
	}

	_g_ := getg()
	// 如果当前正在使用的 P 应该被释放，则更换为 allp[0]
	// 否则是初始化阶段，没有 P 绑定当前 P allp[0]
	if _g_.m.p != 0 && _g_.m.p.ptr().id < nprocs {
		// 继续使用当前 P
		_g_.m.p.ptr().status = _Prunning
	} else {
		// 释放当前 P，因为已失效
		if _g_.m.p != 0 {
			_g_.m.p.ptr().m = 0
		}
		_g_.m.p = 0
		_g_.m.mcache = nil

		// 更换到 allp[0]
		p := allp[0]
		p.m = 0
		p.status = _Pidle
		acquirep(p) // 直接将 allp[0] 绑定到当前的 M

		// trace 相关
		if trace.enabled {
			traceGoStart()
		}
	}

	// 将没有本地任务的 P 放到空闲链表中
	var runnablePs *p
	for i := nprocs - 1; i >= 0; i-- {
		// 挨个检查 p
		p := allp[i]

		// 确保不是当前正在使用的 P
		if _g_.m.p.ptr() == p {
			continue
		}

		// 将 p 设为 idel
		p.status = _Pidle
		if runqempty(p) {
			// 放入 idle 链表
			pidleput(p)
		} else {
			// 如果有本地任务，则为其绑定一个 M
			p.m.set(mget())
			// 第一个循环为 nil，后续则为上一个 p
			// 此处即为构建可运行的 p 链表
			p.link.set(runnablePs)
			runnablePs = p
		}
	}
	stealOrder.reset(uint32(nprocs))
	var int32p *int32 = &gomaxprocs                                 // 让编译器检查 gomaxprocs 是 int32 类型
	atomic.Store((*uint32)(unsafe.Pointer(int32p)), uint32(nprocs)) // *int32p = nprocs
	// 返回所有包含本地任务的 P 链表
	return runnablePs
}
```

`procresize` 这个函数相对较长，我们来总结一下它主要干了什么事情：

1. 调用时已经 STW；
2. 记录调整 P 的时间；
3. 按需调整 `allp` 的大小；
4. 按需初始化 `allp` 中的 P；
5. 从 `allp` 移除不需要的 P，将释放的 P 队列中的任务扔进全局队列；
6. 如果当前的 P 还可以继续使用（没有被移除），则将 P 设置为 _Prunning；
7. 否则将第一个 P 抢过来给当前 G 的 M 进行绑定
8. 最后挨个检查 P，将没有任务的 P 放入 idle 队列
9. 出去当前 P 之外，将有任务的 P 彼此串联成链表，将没有任务的 P 放回到 idle 链表中

显然，在运行 P 初始化之前，我们刚刚初始化完 M，因此第 7 步中的绑定 M 会将当前的 P 绑定到初始 M 上。
而后由于程序刚刚开始，P 队列是空的，所以他们都会被链接到可运行的 P 链表上处于 `_Pidle` 状态。

## G 初始化

运行完 `runtime.procresize` 之后，我们已经在 [1 引导](1-boot.md) 和 [3 主 goroutine 生命周期](3-main.md) 中已经看到，
主 goroutine 会以被调度器调度的方式进行运行，这将有 `runtime.newproc` 来完成主 goroutine 的初始化工作。
我们接下来就来看看 `runtime.newproc` 的过程。

```
_Gidle
_Grunnable
_Grunning
_Gsyscall
_Gwaiting
_Gdead
_Gcopystack
_Gscan
_Gscanrunnable
_Gscanrunning
_Gscansyscall
_Gscanwaiting
                                                           +---------------+
                                                           | _Gscanwaiting |
                                                           +---------------+
                                                                 ^  |
                                              runtime.newstack   |  | runtime.newstack
                                                                 |  v                               +-------------+
               runtime.gcMarkTermination / runtime.ready      +-----------+  runtime.casgcopystack  |             |
                                      +---------------------- | _Gwaiting | ----------------------> | _Gcopystack |
                                      |   runtime.schedule    +-----------+  +--------------------> |             |
                                      |                             ^        |   runtime.morestack  +-------------+
                                      |      runtime.gcBgMarkWorker |        |   runtime.casgcopystack
                                      |   runtime.gcMarkTermination |        |
     New G                            v               runtime.dropg |        v
  +--------+                    +------------+   runtime.execute  +-----------+                     +--------+
  |        |                    |            | -----------------> |           |  runtime.Goexit     |        |
  | _Gidle |                    | _Grunnable |                    | _Grunning | ------------------> | _Gdead | 
  |        |                    |            | <----------------- |           |                     |        |
  +--------+                    +------------+    runtime.Gosched +-----------+                     +--------+
       |                          ^   ^                              ^     | runtime.entersyscallblock ^ | ^
       |                          |   |                              |     | runtime.entersyscall      | | |
       |                          |   |         runtime.exitsyscall  |     v                           | | |
       |                          |   |                           +-----------+          runtime.dropm | | |
       |                          |   +-------------------------- | _Gsyscall | -----------------------+ | |
       |                          |                               +-----------+                          | |
       |                          +----------------------------------------------------------------------+ |
       |                                runtime.newproc / runtime.oneNewExtraM                             |
       +---------------------------------------------------------------------------------------------------+
```

TODO:

## 许可

[Go under the hood](https://github.com/changkun/go-under-the-hood) | CC-BY-NC-ND 4.0 & MIT &copy; [changkun](https://changkun.de)