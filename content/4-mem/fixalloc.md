# 4 内存管理：FixAlloc、LinearAlloc 组件

## FixAlloc

`fixalloc` 是一个基于自由列表的固定大小的分配器。其核心原理是将若干未分配的内存块连接起来，
将未分配的区域的第一个字为指向下一个未分配区域的指针使用。

Go 的主分配堆中 malloc（span、cache、treap、finalizer、profile、arena hint 等） 均
围绕它为实体进行固定分配和回收。

fixalloc 作为抽象，非常简洁，只包含三个基本操作：初始化、分配、回收

### 结构

```go
// FixAlloc 是一个简单的固定大小对象的自由表内存分配器。
// Malloc 使用围绕 sysAlloc 的 FixAlloc 来管理其 MCache 和 MSpan 对象。
//
// fixalloc.alloc 返回的内存默认为零，但调用者可以通过将 zero 标志设置为 false
// 来自行负责将分配归零。如果这部分内存永远不包含堆指针，则这样的操作是安全的。
//
// 调用方负责锁定 FixAlloc 调用。调用方可以在对象中保持状态，
// 但当释放和重新分配时第一个字会被破坏。
//
// 考虑使 fixalloc 的类型变为 go:notinheap.
type fixalloc struct {
	size   uintptr
	first  func(arg, p unsafe.Pointer) // 首次调用时返回 p
	arg    unsafe.Pointer
	list   *mlink
	chunk  uintptr // 使用 uintptr 而非 unsafe.Pointer 来避免 write barrier
	nchunk uint32
	inuse  uintptr // 正在使用的字节
	stat   *uint64
	zero   bool // 归零的分配
}
```

### 初始化

Go 语言对于零值有自己的规定，自然也就体现在内存分配器上。而 `fixalloc` 作为内存分配器内部组件的来源于
操作系统的内存，自然需要自行初始化，因此，`fixalloc` 的初始化也就不可避免的需要将自身的各个字段归零：

```go
// 初始化 f 来分配给定大小的对象。
// 使用分配器来按 chunk 获取
func (f *fixalloc) init(size uintptr, first func(arg, p unsafe.Pointer), arg unsafe.Pointer, stat *uint64) {
	f.size = size
	f.first = first
	f.arg = arg
	f.list = nil
	f.chunk = 0
	f.nchunk = 0
	f.inuse = 0
	f.stat = stat
	f.zero = true
}
```

### 分配

`fixalloc` 基于自由表策略进行实现，分为两种情况：

1. 存在被释放、可复用的内存
2. 不存在可复用的内存

对于第一种情况，也就是在运行时内存被释放，但这部分内存并不会被立即回收给操作系统，
我们直接从自由表中获得即可，但需要注意按需将这部分内存进行清零操作。

对于第二种情况，我们直接向操作系统申请固定大小的内存，然后扣除分配的大小即可。

```go
const 	_FixAllocChunk = 16 << 10               // FixAlloc 一个 Chunk 的大小

func (f *fixalloc) alloc() unsafe.Pointer {
	// fixalloc 的个字段必须先被 init
	if f.size == 0 {
		print("runtime: use of FixAlloc_Alloc before FixAlloc_Init\n")
		throw("runtime: internal error")
	}

	// 如果 f.list 不是 nil, 则说明还存在已经释放、可复用的内存，直接将其分配
	if f.list != nil {
		// 取出 f.list
		v := unsafe.Pointer(f.list)
		// 并将其指向下一段区域
		f.list = f.list.next
		// 增加使用的(分配)大小
		f.inuse += f.size
		// 如果需要对内存清零，则对取出的内存执行初始化
		if f.zero {
			memclrNoHeapPointers(v, f.size)
		}
		// 返回分配的内存
		return v
	}

	// f.list 中没有可复用的内存

	// 如果此时 nchunk 不足以分配一个 size
	if uintptr(f.nchunk) < f.size {
		// 则向操作系统申请内存，大小为 16 << 10 pow(2,14)
		f.chunk = uintptr(persistentalloc(_FixAllocChunk, 0, f.stat))
		f.nchunk = _FixAllocChunk
	}

	// 指向申请好的内存
	v := unsafe.Pointer(f.chunk)
	if f.first != nil { // first 只有在 fixalloc 作为 spanalloc 时候，才会被设置为 recordspan
		f.first(f.arg, v) // 用于为 heap.allspans 添加新的 span
	}
	// 扣除并保留 size 大小的空间
	f.chunk = f.chunk + f.size
	f.nchunk -= uint32(f.size)
	f.inuse += f.size // 记录已经使用的大小
	return v
}
```

上面的代码中：

- `memclrNoHeapPointers` 具体实现分析见 [5 调度器: 初始化](../5-sched/init.md)。
- `persistentalloc` 具体实现分析见 [4 内存分配器: 全局分配](../5-mem/galloc.md)

### 回收

回收就更加简单了，直接将回收的地址指针放回到自由表中即可：

```go
func (f *fixalloc) free(p unsafe.Pointer) {
	// 减少使用的字节数
	f.inuse -= f.size
	// 将要释放的内存地址作为 mlink 指针插入到 f.list 内，完成回收
	v := (*mlink)(p)
	v.next = f.list
	f.list = v
}
```


## LinearAlloc

`linearAlloc` 是一个基于线性分配策略的分配器，但由于它只作为 `mheap_.heapArenaAlloc` 和 `mheap_.arena`
在 32 位系统上使用，这里不做详细分析。

```go
// linearAlloc 是一个简单的线性分配器，提前储备了内存的一块区域并在需要时指向该区域。
// 调用方负责加锁。
type linearAlloc struct {
	next   uintptr // 下一个可用的字节
	mapped uintptr // 映射空间后的一个字节
	end    uintptr // 保留空间的末尾
}

func (l *linearAlloc) init(base, size uintptr) {
	l.next, l.mapped = base, base
	l.end = base + size
}

func (l *linearAlloc) alloc(size, align uintptr, sysStat *uint64) unsafe.Pointer {
	p := round(l.next, align)
	if p+size > l.end {
		return nil
	}
	l.next = p + size
	if pEnd := round(l.next-1, physPageSize); pEnd > l.mapped {
		// We need to map more of the reserved space.
		sysMap(unsafe.Pointer(l.mapped), pEnd-l.mapped, sysStat)
		l.mapped = pEnd
	}
	return unsafe.Pointer(p)
}
```

## 许可

[Go under the hood](https://github.com/changkun/go-under-the-hood) | CC-BY-NC-ND 4.0 & MIT &copy; [changkun](https://changkun.de)
