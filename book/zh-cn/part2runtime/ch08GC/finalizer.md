---
weight: 2310
title: "8.10 终结器"
---

# 8.10 终结器

TODO:

## 存活与终结

### SetFinalizer

```go
type eface struct {
	_type *_type
	data  unsafe.Pointer
}

func efaceOf(ep *interface{}) *eface {
	return (*eface)(unsafe.Pointer(ep))
}

func SetFinalizer(obj interface{}, finalizer interface{}) {
	...
	e := efaceOf(&obj)
	etyp := e._type
	...
	ot := (*ptrtype)(unsafe.Pointer(etyp))
	...

	// find the containing object
	base, _, _ := findObject(uintptr(e.data), 0, 0)

	if base == 0 {
		if e.data == unsafe.Pointer(&zerobase) {
			return
		}
		for datap := &firstmoduledata; datap != nil; datap = datap.next {
			if datap.noptrdata <= uintptr(e.data) && uintptr(e.data) < datap.enoptrdata ||
				datap.data <= uintptr(e.data) && uintptr(e.data) < datap.edata ||
				datap.bss <= uintptr(e.data) && uintptr(e.data) < datap.ebss ||
				datap.noptrbss <= uintptr(e.data) && uintptr(e.data) < datap.enoptrbss {
				return
			}
		}
		throw("runtime.SetFinalizer: pointer not in allocated block")
	}

	if uintptr(e.data) != base {
		// As an implementation detail we allow to set finalizers for an inner byte
		// of an object if it could come from tiny alloc (see mallocgc for details).
		if ot.elem == nil || ot.elem.kind&kindNoPointers == 0 || ot.elem.size >= maxTinySize {
			throw("runtime.SetFinalizer: pointer not at beginning of allocated block")
		}
	}

	f := efaceOf(&finalizer)
	ftyp := f._type
	if ftyp == nil {
		// switch to system stack and remove finalizer
		systemstack(func() {
			removefinalizer(e.data)
		})
		return
	}

	if ftyp.kind&kindMask != kindFunc {
		throw("runtime.SetFinalizer: second argument is " + ftyp.string() + ", not a function")
	}
	ft := (*functype)(unsafe.Pointer(ftyp))
	if ft.dotdotdot() {
		throw("runtime.SetFinalizer: cannot pass " + etyp.string() + " to finalizer " + ftyp.string() + " because dotdotdot")
	}
	if ft.inCount != 1 {
		throw("runtime.SetFinalizer: cannot pass " + etyp.string() + " to finalizer " + ftyp.string())
	}
	fint := ft.in()[0]
	switch {
	case fint == etyp:
		// ok - same type
		goto okarg
	case fint.kind&kindMask == kindPtr:
		if (fint.uncommon() == nil || etyp.uncommon() == nil) && (*ptrtype)(unsafe.Pointer(fint)).elem == ot.elem {
			// ok - not same type, but both pointers,
			// one or the other is unnamed, and same element type, so assignable.
			goto okarg
		}
	case fint.kind&kindMask == kindInterface:
		ityp := (*interfacetype)(unsafe.Pointer(fint))
		if len(ityp.mhdr) == 0 {
			// ok - satisfies empty interface
			goto okarg
		}
		if _, ok := assertE2I2(ityp, *efaceOf(&obj)); ok {
			goto okarg
		}
	}
	throw("runtime.SetFinalizer: cannot pass " + etyp.string() + " to finalizer " + ftyp.string())
okarg:
	// compute size needed for return parameters
	nret := uintptr(0)
	for _, t := range ft.out() {
		nret = round(nret, uintptr(t.align)) + uintptr(t.size)
	}
	nret = round(nret, sys.PtrSize)

	// make sure we have a finalizer goroutine
	createfing()

	systemstack(func() {
		if !addfinalizer(e.data, (*funcval)(f.data), nret, fint, ot) {
			throw("runtime.SetFinalizer: finalizer already set")
		}
	})
}
```


```go
func removefinalizer(p unsafe.Pointer) {
	s := (*specialfinalizer)(unsafe.Pointer(removespecial(p, _KindSpecialFinalizer)))
	if s == nil {
		return // there wasn't a finalizer to remove
	}
	lock(&mheap_.speciallock)
	mheap_.specialfinalizeralloc.free(unsafe.Pointer(s))
	unlock(&mheap_.speciallock)
}
func removespecial(p unsafe.Pointer, kind uint8) *special {
	span := spanOfHeap(uintptr(p))
	if span == nil {
		throw("removespecial on invalid pointer")
	}

	// Ensure that the span is swept.
	// Sweeping accesses the specials list w/o locks, so we have
	// to synchronize with it. And it's just much safer.
	mp := acquirem()
	span.ensureSwept()

	offset := uintptr(p) - span.base()

	lock(&span.speciallock)
	t := &span.specials
	for {
		s := *t
		if s == nil {
			break
		}
		// This function is used for finalizers only, so we don't check for
		// "interior" specials (p must be exactly equal to s->offset).
		if offset == uintptr(s.offset) && kind == s.kind {
			*t = s.next
			unlock(&span.speciallock)
			releasem(mp)
			return s
		}
		t = &s.next
	}
	unlock(&span.speciallock)
	releasem(mp)
	return nil
}
```

```go
func createfing() {
	// start the finalizer goroutine exactly once
	if fingCreate == 0 && atomic.Cas(&fingCreate, 0, 1) {
		go runfinq()
	}
}
func runfinq() {
	var (
		frame    unsafe.Pointer
		framecap uintptr
	)

	for {
		lock(&finlock)
		fb := finq
		finq = nil
		if fb == nil {
			gp := getg()
			fing = gp
			fingwait = true
			goparkunlock(&finlock, waitReasonFinalizerWait, traceEvGoBlock, 1)
			continue
		}
		unlock(&finlock)
		...
		for fb != nil {
			for i := fb.cnt; i > 0; i-- {
				f := &fb.fin[i-1]

				framesz := unsafe.Sizeof((interface{})(nil)) + f.nret
				if framecap < framesz {
					// The frame does not contain pointers interesting for GC,
					// all not yet finalized objects are stored in finq.
					// If we do not mark it as FlagNoScan,
					// the last finalized object is not collected.
					frame = mallocgc(framesz, nil, true)
					framecap = framesz
				}

				if f.fint == nil {
					throw("missing type in runfinq")
				}
				// frame is effectively uninitialized
				// memory. That means we have to clear
				// it before writing to it to avoid
				// confusing the write barrier.
				*(*[2]uintptr)(frame) = [2]uintptr{}
				switch f.fint.kind & kindMask {
				case kindPtr:
					// direct use of pointer
					*(*unsafe.Pointer)(frame) = f.arg
				case kindInterface:
					ityp := (*interfacetype)(unsafe.Pointer(f.fint))
					// set up with empty interface
					(*eface)(frame)._type = &f.ot.typ
					(*eface)(frame).data = f.arg
					if len(ityp.mhdr) != 0 {
						// convert to interface with methods
						// this conversion is guaranteed to succeed - we checked in SetFinalizer
						*(*iface)(frame) = assertE2I(ityp, *(*eface)(frame))
					}
				default:
					throw("bad kind in runfinq")
				}
				fingRunning = true
				reflectcall(nil, unsafe.Pointer(f.fn), frame, uint32(framesz), uint32(framesz))
				fingRunning = false

				// Drop finalizer queue heap references
				// before hiding them from markroot.
				// This also ensures these will be
				// clear if we reuse the finalizer.
				f.fn = nil
				f.arg = nil
				f.ot = nil
				atomic.Store(&fb.cnt, i-1)
			}
			next := fb.next
			lock(&finlock)
			fb.next = finc
			finc = fb
			unlock(&finlock)
			fb = next
		}
	}
}
```

```go
func addfinalizer(p unsafe.Pointer, f *funcval, nret uintptr, fint *_type, ot *ptrtype) bool {
	lock(&mheap_.speciallock)
	s := (*specialfinalizer)(mheap_.specialfinalizeralloc.alloc())
	unlock(&mheap_.speciallock)
	s.special.kind = _KindSpecialFinalizer
	s.fn = f
	s.nret = nret
	s.fint = fint
	s.ot = ot
	if addspecial(p, &s.special) {
		// This is responsible for maintaining the same
		// GC-related invariants as markrootSpans in any
		// situation where it's possible that markrootSpans
		// has already run but mark termination hasn't yet.
		if gcphase != _GCoff {
			base, _, _ := findObject(uintptr(p), 0, 0)
			mp := acquirem()
			gcw := &mp.p.ptr().gcw
			// Mark everything reachable from the object
			// so it's retained for the finalizer.
			scanobject(base, gcw)
			// Mark the finalizer itself, since the
			// special isn't part of the GC'd heap.
			scanblock(uintptr(unsafe.Pointer(&s.fn)), sys.PtrSize, &oneptrmask[0], gcw)
			if gcBlackenPromptly {
				gcw.dispose()
			}
			releasem(mp)
		}
		return true
	}

	// There was an old finalizer
	lock(&mheap_.speciallock)
	mheap_.specialfinalizeralloc.free(unsafe.Pointer(s))
	unlock(&mheap_.speciallock)
	return false
}
```

### KeepAlive

KeepAlive 会将某个参数标记为可达，从而能够保证某个对象在
调用 KeepAlive 之前都不会被垃圾回收所释放（因为被引用），进而这个对象设置的
Finalizer 也不会被运行，考虑下面的例子：

```go
type File struct {d int}

d, err := syscall.Open("/file/path", syscall.O_RDONLY, 0)

// ...

p := &File{d}
runtime.SetFinalizer(p, func(p *File) {
	syscall.Close(p.d)
})
var buf [10]byte
n, err := syscall.Read(p.d, buf[:])

// 确保在 Read 返回之前， p 都不会被 finalize 掉
runtime.KeepAlive(p)
// 此后不再使用 p
```

KeepAlive 的源码非常简单：

```go
func KeepAlive(x interface{}) {
	if cgoAlwaysFalse {
		println(x)
	}
}
```

保留一个引用只需要产生一个参数传递，而这里针对 cgo 做了特殊处理，即
产生了一个 `println` 调用来保证编译器不会将其优化掉。

## 许可

&copy; 2018-2020 The [golang.design](https://golang.design) Initiative Authors. Licensed under [CC-BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/).