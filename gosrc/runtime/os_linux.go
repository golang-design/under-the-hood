// Copyright 2009 The Go Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

package runtime

import (
	"runtime/internal/sys"
	"unsafe"
)

type mOS struct{}

//go:noescape
func futex(addr unsafe.Pointer, op int32, val uint32, ts, addr2 unsafe.Pointer, val3 uint32) int32

// Linux futex.
//
//	futexsleep(uint32 *addr, uint32 val)
//	futexwakeup(uint32 *addr)
//
// Futexsleep atomically checks if *addr == val and if so, sleeps on addr.
// Futexwakeup wakes up threads sleeping on addr.
// Futexsleep is allowed to wake up spuriously.

const (
	_FUTEX_PRIVATE_FLAG = 128
	_FUTEX_WAIT_PRIVATE = 0 | _FUTEX_PRIVATE_FLAG
	_FUTEX_WAKE_PRIVATE = 1 | _FUTEX_PRIVATE_FLAG
)

// Atomically,
//	if(*addr == val) sleep
// Might be woken up spuriously; that's allowed.
// Don't sleep longer than ns; ns < 0 means forever.
//go:nosplit
func futexsleep(addr *uint32, val uint32, ns int64) {
	// Some Linux kernels have a bug where futex of
	// FUTEX_WAIT returns an internal error code
	// as an errno. Libpthread ignores the return value
	// here, and so can we: as it says a few lines up,
	// spurious wakeups are allowed.
	if ns < 0 {
		futex(unsafe.Pointer(addr), _FUTEX_WAIT_PRIVATE, val, nil, nil, 0)
		return
	}

	var ts timespec
	ts.setNsec(ns)
	futex(unsafe.Pointer(addr), _FUTEX_WAIT_PRIVATE, val, unsafe.Pointer(&ts), nil, 0)
}

// 如果任何 procs 在 addr 休眠，唤醒最多 cnt 次
//go:nosplit
func futexwakeup(addr *uint32, cnt uint32) {
	ret := futex(unsafe.Pointer(addr), _FUTEX_WAKE_PRIVATE, cnt, nil, nil, 0)
	if ret >= 0 {
		return
	}

	// I don't know that futex wakeup can return
	// EAGAIN or EINTR, but if it does, it would be
	// safe to loop and call futex again.
	systemstack(func() {
		print("futexwakeup addr=", addr, " returned ", ret, "\n")
	})

	*(*int32)(unsafe.Pointer(uintptr(0x1006))) = 0x1006
}

func getproccount() int32 {
	// This buffer is huge (8 kB) but we are on the system stack
	// and there should be plenty of space (64 kB).
	// Also this is a leaf, so we're not holding up the memory for long.
	// See golang.org/issue/11823.
	// The suggested behavior here is to keep trying with ever-larger
	// buffers, but we don't have a dynamic memory allocator at the
	// moment, so that's a bit tricky and seems like overkill.
	const maxCPUs = 64 * 1024
	var buf [maxCPUs / 8]byte
	r := sched_getaffinity(0, unsafe.Sizeof(buf), &buf[0])
	if r < 0 {
		return 1
	}
	n := int32(0)
	for _, v := range buf[:r] {
		for v != 0 {
			n += int32(v & 1)
			v >>= 1
		}
	}
	if n == 0 {
		n = 1
	}
	return n
}

// Clone, the Linux rfork.
const (
	_CLONE_VM             = 0x100
	_CLONE_FS             = 0x200
	_CLONE_FILES          = 0x400
	_CLONE_SIGHAND        = 0x800
	_CLONE_PTRACE         = 0x2000
	_CLONE_VFORK          = 0x4000
	_CLONE_PARENT         = 0x8000
	_CLONE_THREAD         = 0x10000
	_CLONE_NEWNS          = 0x20000
	_CLONE_SYSVSEM        = 0x40000
	_CLONE_SETTLS         = 0x80000
	_CLONE_PARENT_SETTID  = 0x100000
	_CLONE_CHILD_CLEARTID = 0x200000
	_CLONE_UNTRACED       = 0x800000
	_CLONE_CHILD_SETTID   = 0x1000000
	_CLONE_STOPPED        = 0x2000000
	_CLONE_NEWUTS         = 0x4000000
	_CLONE_NEWIPC         = 0x8000000

	// As of QEMU 2.8.0 (5ea2fc84d), user emulation requires all six of these
	// flags to be set when creating a thread; attempts to share the other
	// five but leave SYSVSEM unshared will fail with -EINVAL.
	//
	// In non-QEMU environments CLONE_SYSVSEM is inconsequential as we do not
	// use System V semaphores.

	cloneFlags = _CLONE_VM | /* share memory */
		_CLONE_FS | /* share cwd, etc */
		_CLONE_FILES | /* share fd table */
		_CLONE_SIGHAND | /* share sig handler table */
		_CLONE_SYSVSEM | /* share SysV semaphore undo lists (see issue #20763) */
		_CLONE_THREAD /* revisit - okay for now */
)

//go:noescape
func clone(flags int32, stk, mp, gp, fn unsafe.Pointer) int32

// 可能在 m.p==nil 下运行，因此不允许写屏障
//go:nowritebarrier
func newosproc(mp *m) {
	stk := unsafe.Pointer(mp.g0.stack.hi)
	/*
	 * note: strace gets confused if we use CLONE_PTRACE here.
	 */
	if false {
		print("newosproc stk=", stk, " m=", mp, " g=", mp.g0, " clone=", funcPC(clone), " id=", mp.id, " ostk=", &mp, "\n")
	}

	// 在 clone 期间禁用信号，以便新线程启动时信号被禁止。
	// 他们会在 minit 中重新启用。
	var oset sigset
	sigprocmask(_SIG_SETMASK, &sigset_all, &oset)
	ret := clone(cloneFlags, stk, unsafe.Pointer(mp), unsafe.Pointer(mp.g0), unsafe.Pointer(funcPC(mstart)))
	sigprocmask(_SIG_SETMASK, &oset, nil)

	if ret < 0 {
		print("runtime: failed to create new OS thread (have ", mcount(), " already; errno=", -ret, ")\n")
		if ret == -_EAGAIN {
			println("runtime: may need to increase max user processes (ulimit -u)")
		}
		throw("newosproc")
	}
}

// Version of newosproc that doesn't require a valid G.
//go:nosplit
func newosproc0(stacksize uintptr, fn unsafe.Pointer) {
	stack := sysAlloc(stacksize, &memstats.stacks_sys)
	if stack == nil {
		write(2, unsafe.Pointer(&failallocatestack[0]), int32(len(failallocatestack)))
		exit(1)
	}
	ret := clone(cloneFlags, unsafe.Pointer(uintptr(stack)+stacksize), nil, nil, fn)
	if ret < 0 {
		write(2, unsafe.Pointer(&failthreadcreate[0]), int32(len(failthreadcreate)))
		exit(1)
	}
}

var failallocatestack = []byte("runtime: failed to allocate stack for the new OS thread\n")
var failthreadcreate = []byte("runtime: failed to create new OS thread\n")

const (
	_AT_NULL   = 0  // End of vector
	_AT_PAGESZ = 6  // System physical page size
	_AT_HWCAP  = 16 // hardware capability bit vector
	_AT_RANDOM = 25 // introduced in 2.6.29
	_AT_HWCAP2 = 26 // hardware capability bit vector 2
)

var procAuxv = []byte("/proc/self/auxv\x00")

var addrspace_vec [1]byte

func mincore(addr unsafe.Pointer, n uintptr, dst *byte) int32

func sysargs(argc int32, argv **byte) {
	n := argc + 1

	// 跳过 argv, envp 来获取 auxv
	for argv_index(argv, n) != nil {
		n++
	}

	// 跳过 NULL 分隔符
	n++

	// 现在 argv+n 即为 auxv
	auxv := (*[1 << 28]uintptr)(add(unsafe.Pointer(argv), uintptr(n)*sys.PtrSize))

	// 如果此时 auxv 读取成功，则直接返回
	if sysauxv(auxv[:]) != 0 {
		return
	}
	// 某些情况下，我们无法获取装载器提供的 auxv，例如 Android 上的装载器
	// 为一个库文件。这时退回到 /proc/self/auxv
	// 使用 open 系统调用打开文件
	fd := open(&procAuxv[0], 0 /* O_RDONLY */, 0)

	// 若 /proc/self/auxv 打开也失败了
	if fd < 0 {
		// 在 Android 下，/proc/self/auxv 可能不可读取（见 #9229），因此我们再回退到
		// 通过 mincore 来检测物理页的大小。
		// mincore 会在地址不是系统页大小的倍数时返回 EINVAL。
		const size = 256 << 10 // 需要分配的内存大小

		// 使用 mmap 系统调用分配内存
		p, err := mmap(nil, size, _PROT_READ|_PROT_WRITE, _MAP_ANON|_MAP_PRIVATE, -1, 0)
		if err != 0 {
			return
		}
		var n uintptr
		for n = 4 << 10; n < size; n <<= 1 {
			err := mincore(unsafe.Pointer(uintptr(p)+n), 1, &addrspace_vec[0])
			if err == 0 {
				// 如果没有出现错误，则说明此时的 n 是系统内存页的整数倍，我们便已第一次拿到的 n 作为 go 运行时的
				// 物理页的大小
				physPageSize = n
				break
			}
		}
		// 如果遍历完后仍然无法得到物理页的大小，则直接以 size 的大小作为物理页的大小。
		if physPageSize == 0 {
			physPageSize = size
		}
		// 使用 munmap 释放分配的内存，这时已经确定好系统页的大小，直接返回。
		munmap(p, size)
		return
	}

	// 打开文件成功，我们从文件中读取 auxv 信息。
	var buf [128]uintptr
	n = read(fd, noescape(unsafe.Pointer(&buf[0])), int32(unsafe.Sizeof(buf)))
	closefd(fd)
	if n < 0 {
		return
	}
	// 即便我们无法读取整个文件，也要确保 buf 已经被终止
	buf[len(buf)-2] = _AT_NULL
	sysauxv(buf[:]) // 调用并确定物理页的大小，读取 vdso 表
}

func sysauxv(auxv []uintptr) int {
	var i int
	// 依次读取 auxv 键值对
	for ; auxv[i] != _AT_NULL; i += 2 {
		tag, val := auxv[i], auxv[i+1]
		switch tag {
		case _AT_RANDOM:
			// 内核提供了一个指针，指向16字节的随机数据
			startupRandomData = (*[16]byte)(unsafe.Pointer(val))[:]

		case _AT_PAGESZ:
			// 读取内存页的大小
			physPageSize = val
			// 这里其实也可能出现无法读取到物理页大小的情况，但后续再内存分配器初始化的时候还会对
			// physPageSize 的大小进行检查，如果读取失败则无法运行程序，从而抛出运行时错误
		}

		archauxv(tag, val) // amd64 下什么也不做的空函数
		vdsoauxv(tag, val) // 读取 vdso 表
	}
	return i / 2
}

var sysTHPSizePath = []byte("/sys/kernel/mm/transparent_hugepage/hpage_pmd_size\x00")

func getHugePageSize() uintptr {
	var numbuf [20]byte
	fd := open(&sysTHPSizePath[0], 0 /* O_RDONLY */, 0)
	if fd < 0 {
		return 0
	}
	n := read(fd, noescape(unsafe.Pointer(&numbuf[0])), int32(len(numbuf)))
	closefd(fd)
	if n <= 0 {
		return 0
	}
	l := n - 1 // remove trailing newline
	v, ok := atoi(slicebytetostringtmp(numbuf[:l]))
	if !ok || v < 0 {
		v = 0
	}
	if v&(v-1) != 0 {
		// v is not a power of 2
		return 0
	}
	return uintptr(v)
}

func osinit() {
	ncpu = getproccount()
	physHugePageSize = getHugePageSize()
	osArchInit()
}

var urandom_dev = []byte("/dev/urandom\x00")

func getRandomData(r []byte) {
	if startupRandomData != nil {
		n := copy(r, startupRandomData)
		extendRandom(r, n)
		return
	}
	fd := open(&urandom_dev[0], 0 /* O_RDONLY */, 0)
	n := read(fd, unsafe.Pointer(&r[0]), int32(len(r)))
	closefd(fd)
	extendRandom(r, int(n))
}

func goenvs() {
	goenvs_unix()
}

// Called to do synchronous initialization of Go code built with
// -buildmode=c-archive or -buildmode=c-shared.
// None of the Go runtime is initialized.
//go:nosplit
//go:nowritebarrierrec
func libpreinit() {
	initsig(true)
}

// gsignalInitQuirk, if non-nil, is called for every allocated gsignal G.
//
// TODO(austin): Remove this after Go 1.15 when we remove the
// mlockGsignal workaround.
var gsignalInitQuirk func(gsignal *g)

// 调用此方法来初始化一个新的 m (包含引导 m)
// 从一个父线程上进行调用（引导时为主线程），可以分配内存
func mpreinit(mp *m) {
	mp.gsignal = malg(32 * 1024) // Linux 需要 >= 2K
	mp.gsignal.m = mp
	if gsignalInitQuirk != nil {
		gsignalInitQuirk(mp.gsignal)
	}
}

func gettid() uint32

// Called to initialize a new m (including the bootstrap m).
// Called on the new thread, cannot allocate memory.
func minit() {
	minitSignals()

	// Cgo-created threads and the bootstrap m are missing a
	// procid. We need this for asynchronous preemption and it's
	// useful in debuggers.
	getg().m.procid = uint64(gettid())
}

// Called from dropm to undo the effect of an minit.
//go:nosplit
func unminit() {
	unminitSignals()
}

//#ifdef GOARCH_386
//#define sa_handler k_sa_handler
//#endif

func sigreturn()
func sigtramp(sig uint32, info *siginfo, ctx unsafe.Pointer)
func cgoSigtramp()

//go:noescape
func sigaltstack(new, old *stackt)

//go:noescape
func setitimer(mode int32, new, old *itimerval)

//go:noescape
func rtsigprocmask(how int32, new, old *sigset, size int32)

//go:nosplit
//go:nowritebarrierrec
func sigprocmask(how int32, new, old *sigset) {
	rtsigprocmask(how, new, old, int32(unsafe.Sizeof(*new)))
}

func raise(sig uint32)
func raiseproc(sig uint32)

//go:noescape
func sched_getaffinity(pid, len uintptr, buf *byte) int32
func osyield()

func pipe() (r, w int32, errno int32)
func pipe2(flags int32) (r, w int32, errno int32)
func setNonblock(fd int32)

//go:nosplit
//go:nowritebarrierrec
func setsig(i uint32, fn uintptr) {
	var sa sigactiont
	sa.sa_flags = _SA_SIGINFO | _SA_ONSTACK | _SA_RESTORER | _SA_RESTART
	sigfillset(&sa.sa_mask)
	// Although Linux manpage says "sa_restorer element is obsolete and
	// should not be used". x86_64 kernel requires it. Only use it on
	// x86.
	if GOARCH == "386" || GOARCH == "amd64" {
		sa.sa_restorer = funcPC(sigreturn)
	}
	if fn == funcPC(sighandler) {
		if iscgo {
			fn = funcPC(cgoSigtramp)
		} else {
			fn = funcPC(sigtramp)
		}
	}
	sa.sa_handler = fn
	sigaction(i, &sa, nil)
}

//go:nosplit
//go:nowritebarrierrec
func setsigstack(i uint32) {
	var sa sigactiont
	sigaction(i, nil, &sa)
	if sa.sa_flags&_SA_ONSTACK != 0 {
		return
	}
	sa.sa_flags |= _SA_ONSTACK
	sigaction(i, &sa, nil)
}

//go:nosplit
//go:nowritebarrierrec
func getsig(i uint32) uintptr {
	var sa sigactiont
	sigaction(i, nil, &sa)
	return sa.sa_handler
}

// setSignaltstackSP sets the ss_sp field of a stackt.
//go:nosplit
func setSignalstackSP(s *stackt, sp uintptr) {
	*(*uintptr)(unsafe.Pointer(&s.ss_sp)) = sp
}

//go:nosplit
func (c *sigctxt) fixsigcode(sig uint32) {
}

// sysSigaction 调用了 rt_sigaction 系统调用.
//go:nosplit
func sysSigaction(sig uint32, new, old *sigactiont) {
	if rt_sigaction(uintptr(sig), new, old, unsafe.Sizeof(sigactiont{}.sa_mask)) != 0 {
		// Workaround for bugs in QEMU user mode emulation.
		//
		// QEMU turns calls to the sigaction system call into
		// calls to the C library sigaction call; the C
		// library call rejects attempts to call sigaction for
		// SIGCANCEL (32) or SIGSETXID (33).
		//
		// QEMU rejects calling sigaction on SIGRTMAX (64).
		//
		// Just ignore the error in these case. There isn't
		// anything we can do about it anyhow.
		if sig != 32 && sig != 33 && sig != 64 {
			// Use system stack to avoid split stack overflow on ppc64/ppc64le.
			systemstack(func() {
				throw("sigaction failed")
			})
		}
	}
}

// rt_sigaction 由汇编实现
//go:noescape
func rt_sigaction(sig uintptr, new, old *sigactiont, size uintptr) int32

func getpid() int
func tgkill(tgid, tid, sig int)

// signalM sends a signal to mp.
func signalM(mp *m, sig int) {
	tgkill(getpid(), int(mp.procid), sig)
}
