# 11.5 关键字： slice 和 array

[TOC]

Go 的切片类型为使用类型化数据序列提供了一种便捷有效的方法。 切片类似于其他语言中的数组，但具有一些不同寻常的属性。 本文将研究什么是切片以及如何使用它们。

## 数据结构

切片的数据结构定义如下：

```go
// runtime/slice.go

type slice struct {
    array unsafe.Pointer
    len   int
    cap   int
}
```

切片的结构中有三个属性，其中 `len` 表示的是切片中数据元素的个数，`cap` 表示的是切片可以存储元素个数的容量。`array` 是切片所指向的一个连续片段的起始地址，也就是具体数据的入口。

例如当我们定一个一个切片：

```go
sl := []int{1, 2, 3, 4}
```

其结构可以用图来表示：

```
                    sl                                                  
              +--------------+                 +-----+-----+-----+-----+
              |    array     +----address------>  1  |  2  |  3  |  4  |
              +--------------+                 +-----+-----+-----+-----+
              |   len = 4    |                                          
              +--------------+                                          
              |   cap = 4    |                                          
              +--------------+                                          
```

## 创建
切片的创建有四种方法：  声明, 初始化, new, make。

```go
package main

import "fmt"

func main() {
    var s1 []int
    s2 := []int{1, 2, 3, 4}
    s3 := new([]int)
    s4 := make([]int, 3, 4)

    fmt.Printf("%v\n", s1)
    fmt.Printf("%v\n", s2)
    fmt.Printf("%v\n", s3)
    fmt.Printf("%v\n", s4)
}
```

### 声明
通过生命方式赋值：`var s1 []int`, 得到的汇编如下：

```asm
    0x0032 00050 (main1.go:6)   MOVQ    $0, "".s1+208(SP)
    0x003e 00062 (main1.go:6)   XORPS   X0, X0
    0x0041 00065 (main1.go:6)   MOVUPS  X0, "".s1+216(SP)
```

可以看到只是给 `len` 和 `cap` 赋值为 0， array 没有赋值，这是 s1 就是 slice 的零值： nil

### 初始化 
初始化在声明变量的同时对其进行了赋值：`s2 := []int{1, 2, 3, 4}`, 得到汇编代码：

```asm
    0x0049 00073 (main1.go:7)   LEAQ    type.[4]int(SB), AX
    0x0050 00080 (main1.go:7)   MOVQ    AX, (SP)
    0x0054 00084 (main1.go:7)   CALL    runtime.newobject(SB)
    0x0059 00089 (main1.go:7)   MOVQ    8(SP), AX
    0x005e 00094 (main1.go:7)   MOVQ    AX, ""..autotmp_6+88(SP)
    0x0063 00099 (main1.go:7)   MOVUPS  ""..stmp_0(SB), X0
    0x006a 00106 (main1.go:7)   MOVUPS  X0, (AX)
    0x006d 00109 (main1.go:7)   MOVUPS  ""..stmp_0+16(SB), X0
    0x0074 00116 (main1.go:7)   MOVUPS  X0, 16(AX)
    0x0078 00120 (main1.go:7)   MOVQ    ""..autotmp_6+88(SP), AX
    0x007d 00125 (main1.go:7)   TESTB   AL, (AX)
    0x007f 00127 (main1.go:7)   JMP 129
    0x0081 00129 (main1.go:7)   MOVQ    AX, "".s2+184(SP)
    0x0089 00137 (main1.go:7)   MOVQ    $4, "".s2+192(SP)
    0x0095 00149 (main1.go:7)   MOVQ    $4, "".s2+200(SP)
```

其过程入下：
1. 定义 `len = 4` 的数组，地址放到 AX 中
2. 数组作为参数调用 `runtime.newobject` 申请内存地址
3. 将申请的内存的起始地址放入寄存器 `""..autotmp_6+88(SP)` 位置，后面使用
4. 通过变量 `stmp_0` 给寄存器 AX 所在的地址赋值, 复制内容为：
    ```asm
    ""..stmp_0 SRODATA size=32
        0x0000 01 00 00 00 00 00 00 00 02 00 00 00 00 00 00 00  ................
        0x0010 03 00 00 00 00 00 00 00 04 00 00 00 00 00 00 00  ................
    ```
5. 将之前存储地址的 `""..autotmp_6+88(SP)` 变量再次放到 AX 中
6. 将 AX 存的数组地址放大变量 `s2.array` 中
7. 给 `s2.len` 和 `s2.cap` 分别赋值 4

### new
使用关键字 `new` 初始化一个切片： `s3 := new([]int)`，对应的汇编代码：

```asm
    0x00a1 00161 (main1.go:8)   LEAQ    type.[]int(SB), AX
    0x00a8 00168 (main1.go:8)   MOVQ    AX, (SP)
    0x00ac 00172 (main1.go:8)   CALL    runtime.newobject(SB)
    0x00b1 00177 (main1.go:8)   MOVQ    8(SP), AX
    0x00b6 00182 (main1.go:8)   MOVQ    AX, "".s3+64(SP)
```

这里可以看出, 跟初始化一样调用了`runtime.newobject`, 但是 `s3`  其实是一个指针，
指向的是一个空的 `[]int`, 可以通过打印查看其内容：

```go
fmt.Println("%v\n", s3)         //  输出 &[]
fmt.Println("%v\n", *s3)        //  输出 []
fmt.Println("%v\n", *s3 == nil) //  输出 true
```

### make
这种方式是最典型的切片创建方式，对应的汇编代码如下：

```asm
    0x00bb 00187 (main1.go:9)   LEAQ    type.int(SB), AX
    0x00c2 00194 (main1.go:9)   MOVQ    AX, (SP)
    0x00c6 00198 (main1.go:9)   MOVQ    $3, 8(SP)
    0x00cf 00207 (main1.go:9)   MOVQ    $4, 16(SP)
    0x00d8 00216 (main1.go:9)   CALL    runtime.makeslice(SB)
    0x00dd 00221 (main1.go:9)   MOVQ    24(SP), AX
    0x00e2 00226 (main1.go:9)   MOVQ    AX, "".s4+160(SP)
    0x00ea 00234 (main1.go:9)   MOVQ    $3, "".s4+168(SP)
    0x00f6 00246 (main1.go:9)   MOVQ    $4, "".s4+176(SP)
```

创建的过程如下：
1. 取 int 类型地址，长度 `len` 和容量 `cap` 作为参数
2. 调用 `runtime.makeslice` 函数，返回创建的数组地址
3. 数组地址赋值给 `s4.array`
4. 长度 `len` 赋值为 3
5. 容量 `cap` 赋值为 4

这里调用了函数 `makeslice` 定义如下：

```go
func makeslice(et *_type, len, cap int) unsafe.Pointer {
    mem, overflow := math.MulUintptr(et.size, uintptr(cap)) // 判断 et.size*cap 是否会溢出
    if overflow || mem > maxAlloc || len < 0 || len > cap {
        // NOTE: Produce a 'len out of range' error instead of a
        // 'cap out of range' error when someone does make([]T, bignumber).
        // 'cap out of range' is true too, but since the cap is only being
        // supplied implicitly, saying len is clearer.
        // See golang.org/issue/4085.
        mem, overflow := math.MulUintptr(et.size, uintptr(len)) // 先判断 et.size*len 是否溢出
        if overflow || mem > maxAlloc || len < 0 {
            panicmakeslicelen() // 返回 len 溢出失败消息 j
        }
        panicmakeslicecap() // 返回 cap 溢出失败消息
    }

    return mallocgc(mem, et, true) // 申请空间返回地址
}
```

`makeslice` 函数会向 Go 堆中申请空间用于保存数组的值, 申请之前会判断空间大小是否移出。
如果切片的长度或者容量在创建时为 int64 类型，则会调用 `makeslice64` 函数，这个函数会
先把 `len` 和 `cap` 转换为 int 类型，如果转换后不相等，证明原来的数据超出了 int 类型
的范围会报错，如果没有超过则还是调用 `makeslice` 函数。  代码如下：

```go
func makeslice64(et *_type, len64, cap64 int64) unsafe.Pointer {
    len := int(len64)
    if int64(len) != len64 {
        panicmakeslicelen()
    }

    cap := int(cap64)
    if int64(cap) != cap64 {
        panicmakeslicecap()
    }

    return makeslice(et, len, cap)
}
```

这个地方也表示了切片的长度和容量最大为 int 类型的最大值。

## 扩容

当往一个切片中添加元素时，如果切片的容量不足，会出现扩容的现象。这时候会新建一个
切片并把原来的切片的内容复制到新切片中。
这里我们举一个例子：

```go
package main

import "fmt"

func main() {
    s := []int{1, 2, 3, 4}
    fmt.Printf("%v\n", &s[0])
    fmt.Printf("%v\n", len(s))
    fmt.Printf("%v\n", cap(s))

    s = append(s, 5)
    fmt.Printf("%v\n", &s[0])
    fmt.Printf("%v\n", len(s))
    fmt.Printf("%v\n", cap(s))
}
```

输出结果：

```
0xc000096000
4
4
0xc00009a000
5
8
```

可以看到切片的数据地址和长度，容量都发生了变化。关于上面代码的汇编如下：

```asm
    0x0290 00656 (main2.go:11)  MOVQ    "".s+200(SP), AX
    0x0298 00664 (main2.go:11)  LEAQ    1(AX), CX
    0x029c 00668 (main2.go:11)  MOVQ    "".s+192(SP), DX
    0x02a4 00676 (main2.go:11)  MOVQ    "".s+208(SP), BX
    0x02ac 00684 (main2.go:11)  CMPQ    CX, BX
    0x02af 00687 (main2.go:11)  JLS 694
    0x02b1 00689 (main2.go:11)  JMP 1279
    0x02b6 00694 (main2.go:11)  JMP 696
    0x02b8 00696 (main2.go:11)  MOVQ    $5, (DX)(AX*8)
    0x02c0 00704 (main2.go:11)  MOVQ    DX, "".s+192(SP)
    0x02c8 00712 (main2.go:11)  MOVQ    CX, "".s+200(SP)
    0x02d0 00720 (main2.go:11)  MOVQ    BX, "".s+208(SP)
    ...
    0x04ff 01279 (main2.go:11)  MOVQ    AX, ""..autotmp_21+72(SP)
    0x0504 01284 (main2.go:11)  LEAQ    type.int(SB), SI
    0x050b 01291 (main2.go:11)  MOVQ    SI, (SP)
    0x050f 01295 (main2.go:11)  MOVQ    DX, 8(SP)
    0x0514 01300 (main2.go:11)  MOVQ    AX, 16(SP)
    0x0519 01305 (main2.go:11)  MOVQ    BX, 24(SP)
    0x051e 01310 (main2.go:11)  MOVQ    CX, 32(SP)
    0x0523 01315 (main2.go:11)  CALL    runtime.growslice(SB)
    0x0528 01320 (main2.go:11)  MOVQ    40(SP), DX
    0x052d 01325 (main2.go:11)  MOVQ    48(SP), AX
    0x0532 01330 (main2.go:11)  MOVQ    56(SP), BX
    0x0537 01335 (main2.go:11)  LEAQ    1(AX), CX
    0x053b 01339 (main2.go:11)  MOVQ    ""..autotmp_21+72(SP), AX
    0x0540 01344 (main2.go:11)  JMP 696
```

过程如下：
1. 先计算 len = len + 1
2. 新的 len 与 cap 进行比较
3. 如果 len > cap 跳转到步骤 4
4. 把类型，老的 slice 和 cap 作为参数调用 `runtime.growslice`函数，返回新的 slice
5. 把新的 slice 的指向的数组起始地址放到寄存器 AX, 跳转到步骤 6
6. 把新  append 的数据放到 slice 指向的数组的对应位置： `DX + (len -1) * 8`
7. 重新给他 s 赋值数组地址和最新的 len, cap
8. 如果 len <= cap, 跳转到步骤 6

下面看一下 `runtime.gorwslice` 是如何实现的：

```go
func growslice(et *_type, old slice, cap int) slice {
    ...
    // 新申请的 cap 不能比原来的 cap  小
    if cap < old.cap {
        panic(errorString("growslice: cap out of range"))
    }
    // 原来的 array 为空，不需要保留，直接返回一个新的 slice
    if et.size == 0 {
        // append should not create a slice with nil pointer but non-zero len.
        // We assume that append doesn't need to preserve old.array in this case.
        return slice{unsafe.Pointer(&zerobase), old.len, cap}
    }

    newcap := old.cap
    doublecap := newcap + newcap
    if cap > doublecap { // 如果需要的 cap 比 老 cap 的两倍还大，则 newcap = cap
        newcap = cap
    } else {
        if old.len < 1024 { // 对于 len < 1024 的 ,  则 newcap = doublecap 
            newcap = doublecap
        } else {
            // Check 0 < newcap to detect overflow
            // and prevent an infinite loop.
            for 0 < newcap && newcap < cap {
                newcap += newcap / 4 // 按照 1/4 的空间增加
            }
            // Set newcap to the requested cap when
            // the newcap calculation overflowed.
            if newcap <= 0 { // 如果溢出的话，就以 cap 为准
                newcap = cap
            }
        }
    }
    
    // 下面会根据对齐的规则  依赖 et.size 和 newcap 进行调整内存申请的大小
    var overflow bool
    var lenmem, newlenmem, capmem uintptr
    // Specialize for common values of et.size.
    // For 1 we don't need any division/multiplication.
    // For sys.PtrSize, compiler will optimize division/multiplication into a shift by a constant.
    // For powers of 2, use a variable shift.
    switch {
    case et.size == 1:
        lenmem = uintptr(old.len)
        newlenmem = uintptr(cap)
        capmem = roundupsize(uintptr(newcap))
        overflow = uintptr(newcap) > maxAlloc
        newcap = int(capmem)
    case et.size == sys.PtrSize:
        lenmem = uintptr(old.len) * sys.PtrSize
        newlenmem = uintptr(cap) * sys.PtrSize
        capmem = roundupsize(uintptr(newcap) * sys.PtrSize)
        overflow = uintptr(newcap) > maxAlloc/sys.PtrSize
        newcap = int(capmem / sys.PtrSize)
    case isPowerOfTwo(et.size):
        var shift uintptr
        if sys.PtrSize == 8 {
            // Mask shift for better code generation.
            shift = uintptr(sys.Ctz64(uint64(et.size))) & 63
        } else {
            shift = uintptr(sys.Ctz32(uint32(et.size))) & 31
        }
        lenmem = uintptr(old.len) << shift
        newlenmem = uintptr(cap) << shift
        capmem = roundupsize(uintptr(newcap) << shift)
        overflow = uintptr(newcap) > (maxAlloc >> shift)
        newcap = int(capmem >> shift)
    default:
        lenmem = uintptr(old.len) * et.size
        newlenmem = uintptr(cap) * et.size
        capmem, overflow = math.MulUintptr(et.size, uintptr(newcap))
        capmem = roundupsize(capmem)
        newcap = int(capmem / et.size)
    }

    // The check of overflow in addition to capmem > maxAlloc is needed
    // to prevent an overflow which can be used to trigger a segfault
    // on 32bit architectures with this example program:
    //
    // type T [1<<27 + 1]int64
    //
    // var d T
    // var s []T
    //
    // func main() {
    //   s = append(s, d, d, d, d)
    //   print(len(s), "\n")
    // }
    if overflow || capmem > maxAlloc { // 溢出失败
        panic(errorString("growslice: cap out of range"))
    }
    
    // 清除指向老的 slice 的指针, 新申请的 slice 还没有指向其的指针
    var p unsafe.Pointer
    if et.ptrdata == 0 {
        p = mallocgc(capmem, nil, false)
        // The append() that calls growslice is going to overwrite from old.len to cap (which will be the new length).
        // Only clear the part that will not be overwritten.
        memclrNoHeapPointers(add(p, newlenmem), capmem-newlenmem)
    } else {
        // Note: can't use rawmem (which avoids zeroing of memory), because then GC can scan uninitialized memory.
        p = mallocgc(capmem, et, true)
        if lenmem > 0 && writeBarrier.enabled {
            // Only shade the pointers in old.array since we know the destination slice p
            // only contains nil pointers because it has been cleared during alloc.
            bulkBarrierPreWriteSrcOnly(uintptr(p), uintptr(old.array), lenmem)
        }
    }

    // 将原来的数组内容 copy 到新的 slice 的数组 p 出, copy 长度为 lenmem
    memmove(p, old.array, lenmem)

    return slice{p, old.len, newcap}
}
```

`growslice` 的步骤主要有以下几个：
1. 先判断扩容的 cap 是不是 比 old.cap 小, 如果是则报错退出
2. 判断 old 是不是 零值，如果是则直接返回一个新的 slice
3. 计算扩容的 cap 的大小，根据老的 old.cap 和 old.len 大小，扩容的方案不一样：
    - cap > doublecap: newcap = cap
    - old.len < 1024: newcap = doublecap
    - old.len >= 1024: newcap 每次增加之前的 1/4 空间
4. 根据数据长度和对齐规则从新计算 newcap
5. 新的 slice 要去掉之前的指针引用
6. 把老的 slice 数据内容 copy 到新的

其中 `memcove` 是内存 COPY 的 实现，针对不同平台有不同的实现。

## 拷贝

执行 `copy` 函数后，大部分并不是调用 `slicecopy` 而是对代码进行了优化：

```go
// cmd/compile/internal/gc/walk.go

// Lower copy(a, b) to a memmove call or a runtime call.
//
// init {
//   n := len(a)
//   if n > len(b) { n = len(b) }
//   if a.ptr != b.ptr { memmove(a.ptr, b.ptr, n*sizeof(elem(a))) }
// }
// n;
//
// Also works if b is a string.
//
func copyany(n *Node, init *Nodes, runtimecall bool) *Node {
    if n.Left.Type.Elem().HasHeapPointer() {
        Curfn.Func.setWBPos(n.Pos)
        fn := writebarrierfn("typedslicecopy", n.Left.Type, n.Right.Type)
        return mkcall1(fn, n.Type, init, typename(n.Left.Type.Elem()), n.Left, n.Right)
    }

    if runtimecall {
        if n.Right.Type.IsString() {
            fn := syslook("slicestringcopy")
            fn = substArgTypes(fn, n.Left.Type, n.Right.Type)
            return mkcall1(fn, n.Type, init, n.Left, n.Right)
        }

        fn := syslook("slicecopy")
        fn = substArgTypes(fn, n.Left.Type, n.Right.Type)
        return mkcall1(fn, n.Type, init, n.Left, n.Right, nodintconst(n.Left.Type.Elem().Width))
    }

    n.Left = walkexpr(n.Left, init)
    n.Right = walkexpr(n.Right, init)
    nl := temp(n.Left.Type)
    nr := temp(n.Right.Type)
    var l []*Node
    l = append(l, nod(OAS, nl, n.Left))
    l = append(l, nod(OAS, nr, n.Right))

    nfrm := nod(OSPTR, nr, nil)
    nto := nod(OSPTR, nl, nil)

    nlen := temp(types.Types[TINT])

    // n = len(to)
    l = append(l, nod(OAS, nlen, nod(OLEN, nl, nil)))

    // if n > len(frm) { n = len(frm) }
    nif := nod(OIF, nil, nil)

    nif.Left = nod(OGT, nlen, nod(OLEN, nr, nil))
    nif.Nbody.Append(nod(OAS, nlen, nod(OLEN, nr, nil)))
    l = append(l, nif)

    // if to.ptr != frm.ptr { memmove( ... ) }
    ne := nod(OIF, nod(ONE, nto, nfrm), nil)
    ne.SetLikely(true)
    l = append(l, ne)

    fn := syslook("memmove")
    fn = substArgTypes(fn, nl.Type.Elem(), nl.Type.Elem())
    nwid := temp(types.Types[TUINTPTR])
    setwid := nod(OAS, nwid, conv(nlen, types.Types[TUINTPTR]))
    ne.Nbody.Append(setwid)
    nwid = nod(OMUL, nwid, nodintconst(nl.Type.Elem().Width))
    call := mkcall1(fn, nil, init, nto, nfrm, nwid)
    ne.Nbody.Append(call)

    typecheckslice(l, ctxStmt)
    walkstmtlist(l)
    init.Append(l...)
    return nlen
}
```
```asm
    0x00d1 00209 (main3.go:9)   MOVQ    AX, ""..autotmp_6+240(SP) # s2.array 地址
    0x00d9 00217 (main3.go:9)   MOVQ    $6, ""..autotmp_6+248(SP) # s2.len
    0x00e5 00229 (main3.go:9)   MOVQ    $6, ""..autotmp_6+256(SP) # s2.cap
    0x00f1 00241 (main3.go:9)   MOVQ    "".s1+208(SP), AX # s1.cap
    0x00f9 00249 (main3.go:9)   MOVQ    "".s1+200(SP), CX # s1.len
    0x0101 00257 (main3.go:9)   MOVQ    "".s1+192(SP), DX # s1.array
    0x0109 00265 (main3.go:9)   MOVQ    DX, ""..autotmp_7+216(SP) # s1.array
    0x0111 00273 (main3.go:9)   MOVQ    CX, ""..autotmp_7+224(SP) # s1.len
    0x0119 00281 (main3.go:9)   MOVQ    AX, ""..autotmp_7+232(SP) # s1.cap
    0x0121 00289 (main3.go:9)   MOVQ    ""..autotmp_6+248(SP), AX # AX = s2.len
    0x0129 00297 (main3.go:9)   MOVQ    AX, ""..autotmp_8+72(SP) # autotmp_8 = s2.len
    0x012e 00302 (main3.go:9)   CMPQ    ""..autotmp_7+224(SP), AX # cmp s1.len s2.len
    0x0136 00310 (main3.go:9)   JLT 317 # s1.len < s2.len
    0x0138 00312 (main3.go:9)   JMP 1320 # s1.len >= s2.len
    0x013d 00317 (main3.go:9)   MOVQ    ""..autotmp_7+224(SP), DX # s1.len -> DX
    0x0145 00325 (main3.go:9)   MOVQ    DX, ""..autotmp_8+72(SP) # autotmp_8 = s1.len
    0x014a 00330 (main3.go:9)   JMP 332
    0x014c 00332 (main3.go:9)   MOVQ    ""..autotmp_7+216(SP), DX # s1.array -> DX
    0x0154 00340 (main3.go:9)   CMPQ    ""..autotmp_6+240(SP), DX # cmp s2.array s1.array
    0x015c 00348 (main3.go:9)   JNE 355 # s2.array != s1.array
    0x015e 00350 (main3.go:9)   JMP 1315
    0x0163 00355 (main3.go:9)   MOVQ    ""..autotmp_8+72(SP), AX # newlen = s1.len < s2.len ? s1.len -> AX : s2.len -> AX
    0x0168 00360 (main3.go:9)   MOVQ    AX, ""..autotmp_9+64(SP) # newlen -> autotmp_9
    0x016d 00365 (main3.go:9)   MOVQ    ""..autotmp_6+240(SP), AX # s2.array -> AX
    0x0175 00373 (main3.go:9)   MOVQ    AX, (SP)
    0x0179 00377 (main3.go:9)   MOVQ    ""..autotmp_7+216(SP), AX # s1.array -> AX
    0x0181 00385 (main3.go:9)   MOVQ    AX, 8(SP)
    0x0186 00390 (main3.go:9)   MOVQ    ""..autotmp_9+64(SP), AX # newlen
    0x018b 00395 (main3.go:9)   SHLQ    $3, AX # newlen << 3
    0x018f 00399 (main3.go:9)   MOVQ    AX, 16(SP)
    0x0194 00404 (main3.go:9)   CALL    runtime.memmove(SB) # memmove(s2.array, s1.array, newlen*8)
    0x0199 00409 (main3.go:9)   JMP 411
    0x0523 01315 (main3.go:9)   JMP 411
    0x0528 01320 (main3.go:9)   JMP 332

```
上面的实现基本上就是：
```go
 n := len(a)
 if n > len(b) { n = len(b) }
 if a.ptr != b.ptr { memmove(a.ptr, b.ptr, n*sizeof(elem(a))) }
```

为了得到`slice`的相关实现，编译的时候需要加参数 `-race`
可以看到调用了`race` 对应的汇编：

```asm
    0x0146 00326 (main3.go:9)   MOVQ    "".s2+288(SP), AX
    0x014e 00334 (main3.go:9)   MOVQ    "".s2+304(SP), CX
    0x0156 00342 (main3.go:9)   MOVQ    "".s2+296(SP), DX
    0x015e 00350 (main3.go:9)   MOVQ    AX, ""..autotmp_10+600(SP)
    0x0166 00358 (main3.go:9)   MOVQ    DX, ""..autotmp_10+608(SP)
    0x016e 00366 (main3.go:9)   MOVQ    CX, ""..autotmp_10+616(SP)
    0x0176 00374 (main3.go:9)   MOVQ    "".s1+328(SP), AX
    0x017e 00382 (main3.go:9)   MOVQ    "".s1+320(SP), CX
    0x0186 00390 (main3.go:9)   MOVQ    "".s1+312(SP), DX
    0x018e 00398 (main3.go:9)   MOVQ    DX, ""..autotmp_11+576(SP)
    0x0196 00406 (main3.go:9)   MOVQ    CX, ""..autotmp_11+584(SP)
    0x019e 00414 (main3.go:9)   MOVQ    AX, ""..autotmp_11+592(SP)
    0x01a6 00422 (main3.go:9)   MOVQ    $8, ""..autotmp_12+88(SP)
    0x01af 00431 (main3.go:9)   MOVQ    ""..autotmp_10+608(SP), AX
    0x01b7 00439 (main3.go:9)   MOVQ    ""..autotmp_10+616(SP), CX
    0x01bf 00447 (main3.go:9)   MOVQ    ""..autotmp_10+600(SP), DX
    0x01c7 00455 (main3.go:9)   MOVQ    DX, (SP)
    0x01cb 00459 (main3.go:9)   MOVQ    AX, 8(SP)
    0x01d0 00464 (main3.go:9)   MOVQ    CX, 16(SP)
    0x01d5 00469 (main3.go:9)   MOVQ    ""..autotmp_11+592(SP), AX
    0x01dd 00477 (main3.go:9)   MOVQ    ""..autotmp_11+576(SP), CX
    0x01e5 00485 (main3.go:9)   MOVQ    ""..autotmp_11+584(SP), DX
    0x01ed 00493 (main3.go:9)   MOVQ    CX, 24(SP)
    0x01f2 00498 (main3.go:9)   MOVQ    DX, 32(SP)
    0x01f7 00503 (main3.go:9)   MOVQ    AX, 40(SP)
    0x01fc 00508 (main3.go:9)   MOVQ    ""..autotmp_12+88(SP), AX
    0x0201 00513 (main3.go:9)   MOVQ    AX, 48(SP)
    0x0206 00518 (main3.go:9)   CALL    runtime.slicecopy(SB)
```

这时候调用了 `runtime.slicecopy`:

```go
func slicecopy(to, fm slice, width uintptr) int {
    if fm.len == 0 || to.len == 0 {
        return 0
    }

    n := fm.len
    if to.len < n {
        n = to.len
    }

    if width == 0 {
        return n
    }
    ...
    size := uintptr(n) * width
    if size == 1 { // common case worth about 2x to do here
        // TODO: is this still worth it with new memmove impl?
        *(*byte)(to.array) = *(*byte)(fm.array) // known to be a byte pointer
    } else {
        memmove(to.array, fm.array, size)
    }
    return n
}
```
这里 `slicecopy`的逻辑跟前面基本上是一致的，除了：
1. 长度判断返回为0时直接返回。
2. width ==0, 直接返回 n, 不用真正执行 copy (width 代表数据类型所占的字节数)

同时 `copy` 还支持 `string` 类型复制到 `[]byte` 类型， 与前面的逻辑基本一致,
由于每个字符都是占用一个字节，所以不需要判断 `width`。

## todo
* 数组和切片
* 函数参数与返回值

## 进一步阅读的参考文献

- [Andrew, January 2011] Andrew Gerrand, [Go Slices: usage and internals](https://blog.golang.org/go-slices-usage-and-internals), 2011

## 许可

[Go under the hood](https://github.com/changkun/go-under-the-hood) | CC-BY-NC-ND 4.0 & MIT &copy; [two](https://two.github.io)
