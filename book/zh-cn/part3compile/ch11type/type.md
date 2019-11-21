# reflect.*

[TOC]

在计算机科学中，反射是指计算机程序在运行时（Run time）可以访问、检测和修改它本身
状态或行为的一种能力。这种能力在汇编语言中是天然支持的，因为你可以访问到任何你想
访问的数据并且对齐进行修改，在高级语言中则需要特殊的支持才能实现，目前主流的语言
基本都支持反射的特性，但是还有一些语言是不支持这种特性的。 支持反射的语言的反射
模型并不是相同的，这里对 Go 语言的反射模型及实现原理进行详细的介绍。

##  type 与 interface
反射是建立在类型系统之上的。Go 语言是静态类型的语言, 每个变量都有一个静态类型，
既在编译的时候就已知了其类型，并且是固定的。 对于接口类型，很多人认为它是动态
类型，其实是不对的。接口定义了一组固定的方法，任何实现了这些固定方法的类型都可
以被认为是这个接口类型，这个定义的接口类型本身就是一个静态的类型，任何通过这个
类型传递的变量都对应的是这个静态接口类型。
反射与接口之间有着密切的关系， 接口类型存储是一个变量的具体值及这个变量类型的
描述符。而反射本质上讲，就是一种检查存储在接口变量中的类型和值对的机制。
下面会详细间接反射的原理及源码实现。

## Type  类型描述

Type 是一个 Go 语言的类型一个表示，对于可以通过反射获取信息的类型，Type 都可以表示,
Type 接口的方法并不是所有的类型都适用的, 可以先通过 Kind 方法获取具体的类型，然后再
调用这个类型所拥有的特定的方法，如果调用了不适合该类行的方法则会出现 panic

类型也是可以比较的，例如可以使用运算符 `==` 比较两个类型是否相同。
Type 接口的定义如下：

```go
type Type interface {
    Align() int
    FieldAlign() int
    Method(int) Method
    MethodByName(string) (Method, bool)
    NumMethod() int
    Name() string
    ... 
}
```

函数包含的比较多，这里就不一一列举，对于一些重要的函数实现，下面会详细介绍。

### TypeOf 获取类型

`TypeOf` 函数可以获取到一个接口的具体类型信息，以前面说的 `Type` 接口作为返回值。
`Typeof` 函数的实现比较简单，源码如下：

```go
// TypeOf returns the reflection Type that represents the dynamic type of i.
// If i is a nil interface value, TypeOf returns nil.
func TypeOf(i interface{}) Type {
    eface := *(*emptyInterface)(unsafe.Pointer(&i))
    return toType(eface.typ)
}

func toType(t *rtype) Type {
    if t == nil {
        return nil
    }
    return t
}
```

首先会把接口转换为一个 eface 类型，这个类型在前面的接口部分介绍过, 这里做了对应的定义：

```go
// emptyInterface is the header for an interface{} value.
type emptyInterface struct {
    typ  *rtype
    word unsafe.Pointer
}
```

其次对于 `nil` 会直接返回 `nil` 类型 
这样我们就拿到了一个 `Type` 类型的返回值。真正实现 `Type` 接口的其实是 `rtype` 这个类型，
而这个类型是可以表示所有 Go 语言的类型结构，所以所有类型都可以返回 `Type` 类型。

### 类型支持

主要是有关 Go 语言类型的操作，支持的类型如下：

```go
const (
    Invalid Kind = iota
    Bool
    Int
    Int8
    Int16
    Int32
    Int64
    Uint
    Uint8
    Uint16
    Uint32
    Uint64
    Uintptr
    Float32
    Float64
    Complex64
    Complex128
    Array
    Chan
    Func
    Interface
    Map
    Ptr
    Slice
    String
    Struct
    UnsafePointer
)
```

###  类型方法
通过 `TypeOf` 返回 `Type` 类型后，我们就可以根据每个类型具体的信息来获取其内容或者
改变其内容，下面列举一些常用的函数的实现。

#### kind
`kind` 就是类型的具体分类， 是 Go 语言最底层的协议。在使用中我们经常使用这个函数来
判断接口的具体类型。 `Kind` 函数的定义非常简单：

```go
func (t *rtype) Kind() Kind { return Kind(t.kind & kindMask) }
...
kindMask        = (1 << 5) - 1
```

`kind` 其实就是一个 `uint8` 的类型，通过 `kindMask` 限定了具体的范围，防止出现未知的
类型。`kind` 的具体值可以通过下面的这函数获取：

```go
// String returns the name of k.
func (k Kind) String() string {
    if int(k) < len(kindNames) {
        return kindNames[k]
    }
    return "kind" + strconv.Itoa(int(k))
}
```

类型的所有分类都在 `kindNames` 这个 map 里，具体如下：

```go
var kindNames = []string{
    Invalid:       "invalid",
    Bool:          "bool",
    Int:           "int",
    Int8:          "int8",
    Int16:         "int16",
    Int32:         "int32",
    Int64:         "int64",
    Uint:          "uint",
    Uint8:         "uint8",
    Uint16:        "uint16",
    Uint32:        "uint32",
    Uint64:        "uint64",
    Uintptr:       "uintptr",
    Float32:       "float32",
    Float64:       "float64",
    Complex64:     "complex64",
    Complex128:    "complex128",
    Array:         "array",
    Chan:          "chan",
    Func:          "func",
    Interface:     "interface",
    Map:           "map",
    Ptr:           "ptr",
    Slice:         "slice",
    String:        "string",
    Struct:        "struct",
    UnsafePointer: "unsafe.Pointer",
}
```

#### String
类型的字符串表示, 这个类型与前面的 `Kind` 不一样，这个返回的我们定义的具体类型的
名字。这个名字是一个完整的名字，保留这个类型定义的所在的包的名字, 如果是内置类型,
则不带包名。下面具体例子：

```go
func main() {
    type s1 struct{}

    var i1 interface{} = s1{}
    var i2 interface{} = 1

    t1 := reflect.TypeOf(i1)
    t2 := reflect.TypeOf(i2)

    fmt.Println(t1.String())
    fmt.Println(t2.String())

}
```

输出： 

```
main.s
int
```

具体实现：

```go
func (t *rtype) String() string {
    s := t.nameOff(t.str).name()
    if t.tflag&tflagExtraStar != 0 {
        return s[1:]
    }
    return s
}
```

这个函数先调用 `nameOff` 和 `name`函数，获取类型明的相关信息，然后判断 `tflag` 标记，
如果 `tflagExtraStar` 存在，则输出时去掉 `*`,  否则直接返回。 获取类型相关的代码如下： 

```go
func (t *rtype) nameOff(off nameOff) name {
    return name{(*byte)(resolveNameOff(unsafe.Pointer(t), int32(off)))}
}

func (n name) name() (s string) {
    if n.bytes == nil {
        return
    }
    b := (*[4]byte)(unsafe.Pointer(n.bytes))

    hdr := (*stringHeader)(unsafe.Pointer(&s))
    hdr.Data = unsafe.Pointer(&b[3])
    hdr.Len = int(b[1])<<8 | int(b[2])
    return s
}

// resolveNameOff resolves a name offset from a base pointer.
// The (*rtype).nameOff method is a convenience wrapper for this function.
// Implemented in the runtime package.
func resolveNameOff(ptrInModule unsafe.Pointer, off int32) unsafe.Pointer
```

通过 `resolveNameOff` 函数获取类型名的字节内容，然后通过定义与 `string` 的底层结构
一样的数据结构 `stringHeader`:

```go
// stringHeader is a safe version of StringHeader used within this package.
type stringHeader struct {
    Data unsafe.Pointer
    Len  int
}
```

再通过 `unsafe` 包获取地址，给这两个字段赋值，最后得到了赋值后的字符串表示类型。
`resolveNameOff` 函数的实现在 `runtime` 包里, 函数名存储在一个全局变量 `firstmoduledata`
里 `rtype.str`  变量的值是一个偏移量，通过这个偏移量可以从 `firstmoduledata` 中找到对应
的内容，对应源码如下：

```go
// reflectlite_resolveNameOff resolves a name offset from a base pointer.
//go:linkname reflectlite_resolveNameOff internal/reflectlite.resolveNameOff
func reflectlite_resolveNameOff(ptrInModule unsafe.Pointer, off int32) unsafe.Pointer {
    return unsafe.Pointer(resolveNameOff(ptrInModule, nameOff(off)).bytes)
}

func resolveNameOff(ptrInModule unsafe.Pointer, off nameOff) name {
    if off == 0 {
        return name{}
    }
    base := uintptr(ptrInModule)
    for md := &firstmoduledata; md != nil; md = md.next {
        if base >= md.types && base < md.etypes {
            res := md.types + uintptr(off)
            if res > md.etypes {
                println("runtime: nameOff", hex(off), "out of range", hex(md.types), "-", hex(md.etypes))
                throw("runtime: name offset out of range")
            }
            return name{(*byte)(unsafe.Pointer(res))}
        }
    }

    // No module found. see if it is a run time name.
    reflectOffsLock()
    res, found := reflectOffs.m[int32(off)]
    reflectOffsUnlock()
    if !found {
        println("runtime: nameOff", hex(off), "base", hex(base), "not in ranges:")
        for next := &firstmoduledata; next != nil; next = next.next {
            println("\ttypes", hex(next.types), "etypes", hex(next.etypes))
        }
        throw("runtime: name offset base pointer out of range")
    }
    return name{(*byte)(res)}
}
```

#### Name

这个函数返回类型的名称，但是不带所在包的信息：

```go
func (t *rtype) Name() string {
    if t.tflag&tflagNamed == 0 {
        return ""
    }
    s := t.String()
    i := len(s) - 1
    for i >= 0 && s[i] != '.' {
        i--
    }
    return s[i+1:]
}
```

逻辑很简单，先调用 `String()` 得到一个带有包名的类型名，然后再寻找 `.` 分隔符
输出分隔符后面的内容，就是不带包名的类型名。


#### Elem
`Elem`  对一些复合类型取其包含的元素所对应的 `Type`, 只对复合类型有效，不属于这些类型
的会出现 panic, 源码如下：

```go
func (t *rtype) Elem() Type {
    switch t.Kind() {
    case Array:
        tt := (*arrayType)(unsafe.Pointer(t))
        return toType(tt.elem)
    case Chan:
        tt := (*chanType)(unsafe.Pointer(t))
        return toType(tt.elem)
    case Map:
        tt := (*mapType)(unsafe.Pointer(t))
        return toType(tt.elem)
    case Ptr:
        tt := (*ptrType)(unsafe.Pointer(t))
        return toType(tt.elem)
    case Slice:
        tt := (*sliceType)(unsafe.Pointer(t))
        return toType(tt.elem)
    }
    panic("reflect: Elem of invalid type")
}
```

例如 `sliceType`, 当调用 `Elem` 的时候会转换为 `sliceType` 类型，然后再返回
`Elem` 的值：

```go
// sliceType represents a slice type.
type sliceType struct {
    rtype
    elem *rtype // slice element type
}
```

下面举一个例子：

```go
package main

import (
    "fmt"
    "reflect"
)

type s []int

func main() {
    var i interface{} = s{1, 2, 3}
    ti := reflect.TypeOf(i)
    fmt.Println(ti.Kind().String())
    fmt.Println(ti.Elem().Kind().String())
}
```

结果输出：

```
slice
len
```

#### Field

Filed 函数只对 struct 类型可以用，如果不是就会出现 panic:

```go
func (t *rtype) Field(i int) StructField {
    if t.Kind() != Struct {
        panic("reflect: Field of non-struct type")
    }
    tt := (*structType)(unsafe.Pointer(t))
    return tt.Field(i)
}

// Field returns the i'th struct field.
func (t *structType) Field(i int) (f StructField) {
    if i < 0 || i >= len(t.fields) {
        panic("reflect: Field index out of bounds")
    }
    p := &t.fields[i]
    f.Type = toType(p.typ)
    f.Name = p.name.name()
    f.Anonymous = p.embedded()
    if !p.name.isExported() {
        f.PkgPath = t.pkgPath.name()
    }
    if tag := p.name.tag(); tag != "" {
        f.Tag = StructTag(tag)
    }
    f.Offset = p.offset()

    // NOTE(rsc): This is the only allocation in the interface
    // presented by a reflect.Type. It would be nice to avoid,
    // at least in the common cases, but we need to make sure
    // that misbehaving clients of reflect cannot affect other
    // uses of reflect. One possibility is CL 5371098, but we
    // postponed that ugliness until there is a demonstrated
    // need for the performance. This is issue 2320.
    f.Index = []int{i}
    return
}
```

#### FieldByName
这个函数只适用于 `struct` 类型, 为了能够分析这个类型，反射中定义了跟
 `runtime` 中的定义保持一致：

```go
// runtime/type.go

type structtype struct {
    typ     _type
    pkgPath name
    fields  []structfield
}
```

```go
// reflect/type.go

// structType represents a struct type.
type structType struct {
    rtype
    pkgPath name
    fields  []structField // sorted by offset
}
```

这个函数主要是通过字段的字符串获取对应的字段。 根据前面结构体的定义，字段
都在 `fields` 字段中，所以对齐进行遍历，并且字段名与输入的字段名比较，如果
找到相关字段的名字则返回，如果没有找到相关字段看是不是内嵌字段，如果是内嵌
字段则调用 `FieldByNameFunc` 进行查找，如果不是内嵌字段直接返回失败。
下面看一下详细实现：

```go
func (t *rtype) FieldByName(name string) (StructField, bool) {
    if t.Kind() != Struct {
        panic("reflect: FieldByName of non-struct type")
    }
    tt := (*structType)(unsafe.Pointer(t))
    return tt.FieldByName(name)
}

// FieldByName returns the struct field with the given name
// and a boolean to indicate if the field was found.
func (t *structType) FieldByName(name string) (f StructField, present bool) {
    // Quick check for top-level name, or struct without embedded fields.
    hasEmbeds := false
    if name != "" {
        for i := range t.fields {
            tf := &t.fields[i]
            if tf.name.name() == name {
                return t.Field(i), true
            }
            if tf.embedded() {
                hasEmbeds = true
            }
        }
    }
    if !hasEmbeds {
        return
    }
    return t.FieldByNameFunc(func(s string) bool { return s == name })
}
```

前面逻辑很好理解，主要是直接查找字段或者判断是否是内嵌字段，如果找到就返回，
如果不是内嵌字段也返回。如果是内嵌字段则还要继续查找：

```go
// FieldByNameFunc returns the struct field with a name that satisfies the
// match function and a boolean to indicate if the field was found.
func (t *structType) FieldByNameFunc(match func(string) bool) (result StructField, ok bool) {
    // This uses the same condition that the Go language does: there must be a unique instance
    // of the match at a given depth level. If there are multiple instances of a match at the
    // same depth, they annihilate each other and inhibit any possible match at a lower level.
    // The algorithm is breadth first search, one depth level at a time.

    // The current and next slices are work queues:
    // current lists the fields to visit on this depth level,
    // and next lists the fields on the next lower level.
    current := []fieldScan{}
    next := []fieldScan{{typ: t}}

    // nextCount records the number of times an embedded type has been
    // encountered and considered for queueing in the 'next' slice.
    // We only queue the first one, but we increment the count on each.
    // If a struct type T can be reached more than once at a given depth level,
    // then it annihilates itself and need not be considered at all when we
    // process that next depth level.
    var nextCount map[*structType]int

    // visited records the structs that have been considered already.
    // Embedded pointer fields can create cycles in the graph of
    // reachable embedded types; visited avoids following those cycles.
    // It also avoids duplicated effort: if we didn't find the field in an
    // embedded type T at level 2, we won't find it in one at level 4 either.
    visited := map[*structType]bool{}

    for len(next) > 0 {
        current, next = next, current[:0]
        count := nextCount
        nextCount = nil

        // Process all the fields at this depth, now listed in 'current'.
        // The loop queues embedded fields found in 'next', for processing during the next
        // iteration. The multiplicity of the 'current' field counts is recorded
        // in 'count'; the multiplicity of the 'next' field counts is recorded in 'nextCount'.
        for _, scan := range current {
            t := scan.typ
            if visited[t] {
                // We've looked through this type before, at a higher level.
                // That higher level would shadow the lower level we're now at,
                // so this one can't be useful to us. Ignore it.
                continue
            }
            visited[t] = true
            for i := range t.fields {
                f := &t.fields[i]
                // Find name and (for embedded field) type for field f.
                fname := f.name.name()
                var ntyp *rtype
                if f.embedded() {
                    // Embedded field of type T or *T.
                    ntyp = f.typ
                    if ntyp.Kind() == Ptr {
                        ntyp = ntyp.Elem().common()
                    }
                }

                // Does it match?
                if match(fname) {
                    // Potential match
                    if count[t] > 1 || ok {
                        // Name appeared multiple times at this level: annihilate.
                        return StructField{}, false
                    }
                    result = t.Field(i)
                    result.Index = nil
                    result.Index = append(result.Index, scan.index...)
                    result.Index = append(result.Index, i)
                    ok = true
                    continue
                }

                // Queue embedded struct fields for processing with next level,
                // but only if we haven't seen a match yet at this level and only
                // if the embedded types haven't already been queued.
                if ok || ntyp == nil || ntyp.Kind() != Struct {
                    continue
                }
                styp := (*structType)(unsafe.Pointer(ntyp))
                if nextCount[styp] > 0 {
                    nextCount[styp] = 2 // exact multiple doesn't matter
                    continue
                }
                if nextCount == nil {
                    nextCount = map[*structType]int{}
                }
                nextCount[styp] = 1
                if count[t] > 1 {
                    nextCount[styp] = 2 // exact multiple doesn't matter
                }
                var index []int
                index = append(index, scan.index...)
                index = append(index, i)
                next = append(next, fieldScan{styp, index})
            }
        }
        if ok {
            break
        }
    }
    return
}
```

`structType.FiledByNameFunc` 实际上是一个广度优先遍历的过程:
1. 从当前节点查看,遍历所有字段
2. 找到内嵌字段，把这个字段放到 next 队列中
3. 找到匹配字段， 判断如果存在多个匹配字段返回失败
5. 遍历 next 下一个节点，继续回到 1.
6. 遍历完成，只找到一个匹配字段，返回结果

#### FieldByNameFunc
这个函数可以自己定义匹配的规则，如果匹配规则返回 `true` 则认为匹配到相对应的字段。
底层调用的还是 `structType.FieldByNameFunc`, 具体的前面已经讲过,源码如下：

```go
func (t *rtype) FieldByNameFunc(match func(string) bool) (StructField, bool) {
    if t.Kind() != Struct {
        panic("reflect: FieldByNameFunc of non-struct type")
    }
    tt := (*structType)(unsafe.Pointer(t))
    return tt.FieldByNameFunc(match)
}
```

#### NumField
这个函数是返回 `struct` 类型的字段的数量，源码如下：

```go
func (t *rtype) NumField() int {
    if t.Kind() != Struct {
        panic("reflect: NumField of non-struct type")
    }
    tt := (*structType)(unsafe.Pointer(t))
    return len(tt.fields)
}
```

字段都在`fields`中，所以直接取其长度可以了。

#### MethodByName
根据方法名获取对应的方法, 分为两种情况
1. 类型是接口，调用接口的 `MethodByName`
2. 其他类型遍历 `exportedMethods`, 然后输出名字匹配的方法

源码如下：

```go
func (t *rtype) MethodByName(name string) (m Method, ok bool) {
    if t.Kind() == Interface {
        tt := (*interfaceType)(unsafe.Pointer(t))
        return tt.MethodByName(name)
    }
    ut := t.uncommon()
    if ut == nil {
        return Method{}, false
    }
    // TODO(mdempsky): Binary search.
    for i, p := range ut.exportedMethods() {
        if t.nameOff(p.name).name() == name {
            return t.Method(i), true
        }
    }
    return Method{}, false
}
```

第一种情况, 如下：

```go
// interfaceType represents an interface type.
type interfaceType struct {
    rtype
    pkgPath name      // import path
    methods []imethod // sorted by hash
}

// MethodByName method with the given name in the type's method set.
func (t *interfaceType) MethodByName(name string) (m Method, ok bool) {
    if t == nil {
        return
    }
    var p *imethod
    for i := range t.methods {
        p = &t.methods[i]
        if t.nameOff(p.name).name() == name {
            return t.Method(i), true
        }
    }

    return
}
```

`interfaceType` 的 `methods` 字段包含了接口定义的方法名，除了方法集所处的位置不一样
其他逻辑跟第二种情况基本是一致的。

## Value
Value 是变量值的描述，其定义如下：

```go
type Value struct {
    typ *rtype
    ptr unsafe.Pointer
    flag
}
```

Value 的定义和 eface 定义相似， 只是多了一个字段 `flag`,
这个字段记录了 value 的一些附加信息， 具体的值有下面几个： 

```go
const (
    flagKindWidth        = 5 // there are 27 kinds
    flagKindMask    flag = 1<<flagKindWidth - 1
    flagStickyRO    flag = 1 << 5 // 只读字段， 非内嵌 && 不可导出字段
    flagEmbedRO     flag = 1 << 6 // 只读字段， 内嵌 && 不可导出字段
    flagIndir       flag = 1 << 7 // 拥有指向数据的指针
    flagAddr        flag = 1 << 8 // 可以取地址, v.CanAddr 返回 true
    flagMethod      flag = 1 << 9 // 是一个方法的值
    flagMethodShift      = 10
    flagRO          flag = flagStickyRO | flagEmbedRO
)
```

|字段|含义|二进制表示|
|-|-|-|
|flagKindMask|掩码，低5位用来表示typ.Kind()|11111|
|flagStickyRO|只读字段， 非内嵌 && 不可导出字段|100000|
|flagEmbedRO|只读字段， 内嵌 && 不可导出字段|1000000|
|flagIndir|拥有指向数据的指针|10000000|
|flagAddr|可以取地址, v.CanAddr 返回 true|100000000|
|flagMethod|表示是一个方法|1000000000|
|flagRO|只读字段|1100000|
|other|高 23 位记录了方法的个数||

### ValueOf
ValueOf 获取接口的值相关的信息，前面和 `TypeOf` 一样先转换为 `emptyInterface` 
类型，然后在这个基础上再对 `flag` 进行赋值，最后返回 `Value` 类型：

```go
// ValueOf returns a new Value initialized to the concrete value
// stored in the interface i. ValueOf(nil) returns the zero Value.
func ValueOf(i interface{}) Value {
    if i == nil {
        return Value{}
    }

    // TODO: Maybe allow contents of a Value to live on the stack.
    // For now we make the contents always escape to the heap. It
    // makes life easier in a few places (see chanrecv/mapassign
    // comment below).
    escapes(i)

    return unpackEface(i)
}

// Dummy annotation marking that the value x escapes,
// for use in cases where the reflect code is so clever that
// the compiler cannot follow.
func escapes(x interface{}) {
    if dummy.b {
        dummy.x = x
    }
}

// unpackEface converts the empty interface i to a Value.
func unpackEface(i interface{}) Value {
    e := (*emptyInterface)(unsafe.Pointer(&i))
    // NOTE: don't read e.word until we know whether it is really a pointer or not.
    t := e.typ
    if t == nil {
        return Value{}
    }
    f := flag(t.Kind())
    if ifaceIndir(t) {
        f |= flagIndir
    }
    return Value{t, e.word, f}
}
```

###  与 Type 的关系
`Value` 可以通过调用 `Type` 函数返回一个 `Type` 类型，也就是这个 `Value` 的 `Type` 相关的信息：

```go
// Type returns v's type.
func (v Value) Type() Type {
    f := v.flag
    if f == 0 {
        panic(&ValueError{"reflect.Value.Type", Invalid})
    }
    if f&flagMethod == 0 {
        // Easy case
        return v.typ
    }

    // Method value.
    // v.typ describes the receiver, not the method type.
    i := int(v.flag) >> flagMethodShift
    if v.typ.Kind() == Interface {
        // Method on interface.
        tt := (*interfaceType)(unsafe.Pointer(v.typ))
        if uint(i) >= uint(len(tt.methods)) {
            panic("reflect: internal error: invalid method index")
        }
        m := &tt.methods[i]
        return v.typ.typeOff(m.typ)
    }
    // Method on concrete type.
    ms := v.typ.exportedMethods()
    if uint(i) >= uint(len(ms)) {
        panic("reflect: internal error: invalid method index")
    }
    m := ms[i]
    return v.typ.typeOff(m.mtyp)
}
```

步骤主要如下：
1. 首先判断 `flagMethod` 是否设置了，如果没有设置则证明其类型本质上是 eface ， 
直接返回 `v.typ` 即可。 否则证明是 iface 类型，`v.typ` 其实是 `iface.tab`。
2. `v.typ` 表示的是接收者的信息， 这里还有两个可能，第一是这个接收者 `interfaceType`，
第二 这个接收者不是 `interfaceType`。
3. 对于 `interfaceType`, 通过 iface 的定义可以知道 `iface.itab` 的第一个字段是
`*interfacetype` 类型, 所以可以通过 `(*interfaceType)(unsafe.Pointer(v.typ))` 获取
`interfaceType` 类型, 再通过字段 `interfaceType.methods` 来获取类型的偏移量地址，返回。
4. 对于非 `interfaceType`, 通过字段 `mtyp` 来获取类型的偏移量地址, 返回

### 重要方法

#### Elem
Elem 返回 Value 的类型是 interface 所指向的值，或者类型是指针所指向的值，
其他类型会返回 panic。当 Value 为指针类型时 Elem 返回的是这个指针所指向的
地址的 Value, 当 Value 为 Interface 类型时 Elem 返回的所指向的接口。下面
先看一下源码实现：

```go
/ Elem returns the value that the interface v contains
// or that the pointer v points to.
// It panics if v's Kind is not Interface or Ptr.
// It returns the zero Value if v is nil.
func (v Value) Elem() Value {
    k := v.kind()
    switch k {
    case Interface:
        var eface interface{}
        if v.typ.NumMethod() == 0 {
            eface = *(*interface{})(v.ptr)
        } else {
            eface = (interface{})(*(*interface {
                M()
            })(v.ptr))
        }
        x := unpackEface(eface)
        if x.flag != 0 {
            x.flag |= v.flag.ro()
        }
        return x
    case Ptr:
        ptr := v.ptr
        if v.flag&flagIndir != 0 {
            ptr = *(*unsafe.Pointer)(ptr)
        }
        // The returned value's address is v's value.
        if ptr == nil {
            return Value{}
        }
        tt := (*ptrType)(unsafe.Pointer(v.typ))
        typ := tt.elem
        fl := v.flag&flagRO | flagIndir | flagAddr
        fl |= flag(typ.Kind())
        return Value{typ, ptr, fl}
    }
    panic(&ValueError{"reflect.Value.Elem", v.kind()})
}
```

当 Value 类型为 Interface 时，根据是否有方法判断是 eface 还是 iface 类型,
如果是 eface 可以直接通过 `v.ptr` 类型转换，如果是 iface 则需要调用通过
带方法的类型转换，但是这里只是定义了一个方法，因为之前讲指针的时候讲过，iface
所带的方法是一个地址，起始地址表示的是第一个方法，往后连续的地址是其他方法，这里
只需定义一个就可以满足类型表达上的要求。 定义如下：

```go
            eface = (interface{})(*(*interface {
                M()
            })(v.ptr))
        }
```

最后再把 eface 转化为 Value 的类型，然后再加上 flag 标记，就可以返回了。

当 Value 类型为 Ptr 时，`v.typ` 就是 `*ptrType`, 可以通过 `ptrType.elem` 
获取到这个指针类型所指向的地址的值的类型, 然后对 flag 字段进行赋值，加上
flagIndir, flagAddr 等标记。

这里看上去有点儿晕，我们举一个例子:

```go
package main

import (
    "fmt"
    "reflect"
    "unsafe"
)

type value struct {
    _type int
    data  unsafe.Pointer
    flag  uintptr
}

type eface struct {
    _type int
    data  unsafe.Pointer
}

func main() {
    var n int = 1
    var i interface{} = n
    var addr = &i

    et := *(*eface)(unsafe.Pointer(addr))
    fmt.Println(et._type)
    fmt.Println(et.data)

    ptr := reflect.ValueOf(addr)
    iface := ptr.Elem()
    v := iface.Elem()

    fmt.Println(ptr.Kind())
    fmt.Println(iface)

    fmt.Println(iface.Kind())
    fmt.Println(v)
    fmt.Println(v.Kind())

    t := *(*value)(unsafe.Pointer(&v))
    fmt.Println(t._type)
    fmt.Println(t.data)
    fmt.Println(t.flag)
    fmt.Println(*(*int)(t.data))
}
```
根据运行的结果，可以看出，Elem 其实是获取接口的间接指向的值，但是间接指向的只有
指针和接口两种类型会存在这种情况，所以只针对这两种情况可以使用，它们之间转换的
关系可以用下面的图表示：

```

                                         i                              +----------------+
                               +--------------------+                   |                |
+----------------ValueOf()-----|      _type         |                   v                |
|                              +--------------------+                 +---+              |
|                         +--->|  data = 0xc000180a8+---------------->| 1 |              |
|                         |    +--------------------+ 0xc000010210    +---+ 0xc000180a8  |
|                         |               ^                                              |
|                         |               |                                              |
|                         |               |                                              |
|                         |               |                                              |
|                         |    +----------+                                              |
|                         |    |                                                         |
|          ptr            |    |         iface                              v            |
|  +------------------+   |    |  +------------------+             +------------------+  |
+->|type = Ptr        |   |    |  |type = Interface  |             |type = Int        |  |
   +------------------+   |    |  +------------------+             +------------------+  |
   |ptr = 0xc000010210|---+    +--|ptr = 0xc000010210|             |ptr = 0xc0000180a8|--+
   +------------------+           +------------------+             +------------------+   
   |flag = 22         |--Elem()-->|flag = 404        |--Elem()---->|flag = 130        |   
   +------------------+           +------------------+             +------------------+   

```


#### CanSet
这个函数是判断当前 Value 的值是否可以被修改。 一个 Value 只有当它是
可取值的并且没有被不可导出的字段所引用时才可以被修改。源码非常简单，
是通过 flag 标记来判断的：

```go

// CanSet reports whether the value of v can be changed.
// A Value can be changed only if it is addressable and was not
// obtained by the use of unexported struct fields.
// If CanSet returns false, calling Set or any type-specific
// setter (e.g., SetBool, SetInt) will panic.
func (v Value) CanSet() bool {
    return v.flag&(flagAddr|flagRO) == flagAddr
}

```

#### Set

Set 是改变 Value 的值得方法，前面通过 `CanSet` 判断是否可以被修改值，
如果可以则可以调用这个函数修改其值。Set 的函数实现如下：

```go
// Set assigns x to the value v.
// It panics if CanSet returns false.
// As in Go, x's value must be assignable to v's type.
func (v Value) Set(x Value) {
    v.mustBeAssignable()
    x.mustBeExported() // do not let unexported x leak
    var target unsafe.Pointer
    if v.kind() == Interface {
        target = v.ptr
    }
    x = x.assignTo("reflect.Set", v.typ, target)
    if x.flag&flagIndir != 0 {
        typedmemmove(v.typ, v.ptr, x.ptr)
    } else {
        *(*unsafe.Pointer)(v.ptr) = x.ptr
    }
}

// assignTo returns a value v that can be assigned directly to typ.
// It panics if v is not assignable to typ.
// For a conversion to an interface type, target is a suggested scratch space to use.
func (v Value) assignTo(context string, dst *rtype, target unsafe.Pointer) Value {
    if v.flag&flagMethod != 0 {
        v = makeMethodValue(context, v)
    }

    switch {
    case directlyAssignable(dst, v.typ):
        // Overwrite type so that they match.
        // Same memory layout, so no harm done.
        fl := v.flag&(flagAddr|flagIndir) | v.flag.ro()
        fl |= flag(dst.Kind())
        return Value{dst, v.ptr, fl}

    case implements(dst, v.typ):
        if target == nil {
            target = unsafe_New(dst)
        }
        if v.Kind() == Interface && v.IsNil() {
            // A nil ReadWriter passed to nil Reader is OK,
            // but using ifaceE2I below will panic.
            // Avoid the panic by returning a nil dst (e.g., Reader) explicitly.
            return Value{dst, nil, flag(Interface)}
        }
        x := valueInterface(v, false)
        if dst.NumMethod() == 0 {
            *(*interface{})(target) = x
        } else {
            ifaceE2I(dst, x, target)
        }
        return Value{dst, target, flagIndir | flag(Interface)}
    }

    // Failed.
    panic(context + ": value of type " + v.typ.String() + " is not assignable to type " + dst.String())
}
```
首先会再次判断当前 `v` 是否可以被赋值，如果不可以则会出现 `panic`
其次再判断要赋值的 `x` 是否是可到导出的，如果不可导出则会出现 `panic`
然后 `assignTo` 函数 会根据 `v` 的类型对 `x` 的内容进行判断和调整，
最后返回一个符合 `v` 的值， 如果无法调整，则会出现 `panic`
最后如果 `v` 的值不是指向一个地址，而是具体的值则会出现内存的 copy， 
从 `x.ptr` 到 `v.ptr`, 如果 `v` 指向的是一个地址，则只需要覆盖这个地址
的值就行了。

对于具体的类型也可以直接使用其值覆盖 `v.ptr` 的值，比如 `SetInt`, 
`SetFloat`, `SetString` 等这些函数。

## 其它特性

### MakeFunc 
这个函数会创建一个依附于给定 `Type` 的新函数。 这个函数的参数有两个，
第一个是这个函数要依附的类型类型，第二个是创建的函数函数。 先看一下源码:

```go
// MakeFunc returns a new function of the given Type
// that wraps the function fn. When called, that new function
// does the following:
// ...
func MakeFunc(typ Type, fn func(args []Value) (results []Value)) Value {
    if typ.Kind() != Func {
        panic("reflect: call of MakeFunc with non-Func type")
    }

    t := typ.common()
    ftyp := (*funcType)(unsafe.Pointer(t))

    // Indirect Go func value (dummy) to obtain
    // actual code address. (A Go func value is a pointer
    // to a C function pointer. https://golang.org/s/go11func.)
    dummy := makeFuncStub
    code := **(**uintptr)(unsafe.Pointer(&dummy))

    // makeFuncImpl contains a stack map for use by the runtime
    _, argLen, _, stack, _ := funcLayout(ftyp, nil)

    impl := &makeFuncImpl{code: code, stack: stack, argLen: argLen, ftyp: ftyp, fn: fn}

    return Value{t, unsafe.Pointer(impl), flag(Func)}
}
```

makeFuncStub 是为了获取函数的代码地址, 这个函数的实现不同平台不一样，下面是 
`asm_amd64.s`中的实现:

``` asm
EXT ·makeFuncStub(SB),(NOSPLIT|WRAPPER),$32
    NO_LOCAL_POINTERS
    MOVQ    DX, 0(SP)
    LEAQ    argframe+0(FP), CX
    MOVQ    CX, 8(SP)
    MOVB    $0, 24(SP)
    LEAQ    24(SP), AX
    MOVQ    AX, 16(SP)
    CALL    ·callReflect(SB)
    RET
```

可以看到里面调用 `callReflect`  函数，这个函数是 MakeFunc 返回的函数调用实现真正。
在许多方面，它与上面的 `Value.call` 方法相反。 上面的方法将使用 `Values` 的调用
转换为带有具体参数框架的函数的调用，而 `callReflect` 将具有具体参数框架的函数调
用转换为使用Values的调用。 
`ctxt` 是 `MakeFunc` 生成的“闭包”。 `frame` 是指向堆栈上该闭包的参数的指针。 
函数的源码如下:

```go
func callReflect(ctxt *makeFuncImpl, frame unsafe.Pointer, retValid *bool) {

    // Copy argument frame into Values.
    ptr := frame
    off := uintptr(0)
    in := make([]Value, 0, int(ftyp.inCount))
    for _, typ := range ftyp.in() {
        ...
    }
    ...

    // Copy results back into argument frame.
    if numOut > 0 {
    ...
    }
}
```

通过 `makeFuncImpl` 函数又生成了一个完整的闭包函数，然后构建一个 `Value` 进行返回。

这个函数可以实现一种类似于多态的效果:

```go
package main

import (
    "fmt"
    "reflect"
    "strings"
)

func main() {
    var add = func(in []reflect.Value) []reflect.Value {
        if in[0].Type().Kind() == reflect.String {
            var s []string
            for _, v := range in {
                s = append(s, v.String())
            }
            return []reflect.Value{reflect.ValueOf(strings.Join(s, "-"))}
        }

        if in[0].Type().Kind() == reflect.Int {
            var s int64
            for _, v := range in {
                s += v.Int()
            }
            return []reflect.Value{reflect.ValueOf(int(s))}
        }
        return []reflect.Value{}
    }

    var makeAdd = func(fptr interface{}) {
        var value reflect.Value = reflect.ValueOf(fptr).Elem()
        var v reflect.Value = reflect.MakeFunc(value.Type(), add)
        value.Set(v)
    }
    var intAdd func(int, int) int
    var stringAdd func(string, string, string) string
    makeAdd(&intAdd)
    fmt.Println(intAdd(1, 3))
    makeAdd(&stringAdd)
    fmt.Println(stringAdd("1", "3", "5"))
}
```
输出：

```
4
1-3-5
```

### Swapper
这个函数用于产生一个切片的两个元素的交换的函数, 用于适配切片值得不同数据类型。
对于不同的类型其方式元素交换的方式是不一样的，对于指针类型，字符串和整型其值
其实就是一个对应类型的数组，可以通过下标直接交换值；对于更复杂的类型需要用一
个 `sliceHeader` 的结构表示其结构，其实就是切片的底层数据类型:

```go
type sliceHeader struct {
    Data unsafe.Pointer
    Len  int
    Cap  int
}
```
通过 `arrayAt` 函数可以算出某个下标的偏移位置：

```go
func arrayAt(p unsafe.Pointer, i int, eltSize uintptr, whySafe string) unsafe.Pointer {
    return add(p, uintptr(i)*eltSize, "i < len")
}
```
最后通过中间变量和内存 copy 来交换两个下标的位置, 完整的代码如下：

```go
func Swapper(slice interface{}) func(i, j int) {
    v := ValueOf(slice)
    if v.Kind() != Slice {
        panic(&ValueError{Method: "Swapper", Kind: v.Kind()})
    }
    // Fast path for slices of size 0 and 1. Nothing to swap.
    switch v.Len() {
    case 0:
        return func(i, j int) { panic("reflect: slice index out of range") }
    case 1:
        return func(i, j int) {
            if i != 0 || j != 0 {
                panic("reflect: slice index out of range")
            }
        }
    }

    typ := v.Type().Elem().(*rtype)
    size := typ.Size()
    hasPtr := typ.ptrdata != 0

    // Some common & small cases, without using memmove:
    if hasPtr {
        if size == ptrSize {
            ps := *(*[]unsafe.Pointer)(v.ptr)
            return func(i, j int) { ps[i], ps[j] = ps[j], ps[i] }
        }
        if typ.Kind() == String {
            ss := *(*[]string)(v.ptr)
            return func(i, j int) { ss[i], ss[j] = ss[j], ss[i] }
        }
    } else {
        switch size {
        case 8:
            is := *(*[]int64)(v.ptr)
            return func(i, j int) { is[i], is[j] = is[j], is[i] }
        case 4:
            is := *(*[]int32)(v.ptr)
            return func(i, j int) { is[i], is[j] = is[j], is[i] }
        case 2:
            is := *(*[]int16)(v.ptr)
            return func(i, j int) { is[i], is[j] = is[j], is[i] }
        case 1:
            is := *(*[]int8)(v.ptr)
            return func(i, j int) { is[i], is[j] = is[j], is[i] }
        }
    }

    s := (*sliceHeader)(v.ptr)
    tmp := unsafe_New(typ) // swap scratch space

    return func(i, j int) {
        if uint(i) >= uint(s.Len) || uint(j) >= uint(s.Len) {
            panic("reflect: slice index out of range")
        }
        val1 := arrayAt(s.Data, i, size, "i < s.Len")
        val2 := arrayAt(s.Data, j, size, "j < s.Len")
        typedmemmove(typ, tmp, val1)
        typedmemmove(typ, val1, val2)
        typedmemmove(typ, val2, tmp)
    }
}
```

### DeepEqual 

`DeepEqual` 用来判断两个接口是否深度相等，所谓深度是指接口的 `Value` 相等。
首先`Value` 的类型必须是相同的, 也就是 `v1.Type() == v2.Type()`; 其次是值
的对比, 值也相同则认为它们是深度相等的。但是对于不同的类型判断的值相等 的
方式是不一样的:

- Array:  当它们的元素都是深度相等的，则它们也是深度相等的。
- Struct: 当它们的字段(包括可导出的和不可导出的) 是深度相等的则它们的值
就是深度相等的。
- Func: 当它们都是 `nil` 的时候认为值是相等的，否则就是不相等的。
- Interface: 当它们的值是深度相等的, 它们就是深度相等的
- Map:  同时满足下面几个条件: 
    1. 它们都是 nil 或者都不是 nil 
    2. 它们的长度相同
    3. 它们有相同的 key 和 value (通过 == 来判断)
- Pointer: 如果它们能用 `==` 操作符判断相等或者它们指向的是深度相等的值，
它们就是深度相等的。
- Slice: 同事满足下面几个条件
    1. 它们都是 nil 或者都不是 nil 
    2. 它们的长度相同
    3. 它们数据字段指向同一个数组或者数组元素是深度相等的
注意: 零值切片和没有元素的空切片不是深度相等的( 比如：[]byte{} 和 {}byte(nil))
- 其他类型(例如: numbers, bools, strings 和 channes 等) 只要通过操作符 
`==` 判断是相等的，那么它们就是深度相等的。

```go
func DeepEqual(x, y interface{}) bool {
    if x == nil || y == nil {
        return x == y
    }
    v1 := ValueOf(x)
    v2 := ValueOf(y)
    if v1.Type() != v2.Type() {
        return false
    }
    return deepValueEqual(v1, v2, make(map[visit]bool), 0)
}

func deepValueEqual(v1, v2 Value, visited map[visit]bool, depth int) bool {
    if !v1.IsValid() || !v2.IsValid() {
        return v1.IsValid() == v2.IsValid()
    }
    if v1.Type() != v2.Type() {
        return false
    }

    // if depth > 10 { panic("deepValueEqual") }    // for debugging

    // We want to avoid putting more in the visited map than we need to.
    // For any possible reference cycle that might be encountered,
    // hard(t) needs to return true for at least one of the types in the cycle.
    hard := func(k Kind) bool {
        switch k {
        case Map, Slice, Ptr, Interface:
            return true
        }
        return false
    }

    if v1.CanAddr() && v2.CanAddr() && hard(v1.Kind()) {
        addr1 := unsafe.Pointer(v1.UnsafeAddr())
        addr2 := unsafe.Pointer(v2.UnsafeAddr())
        if uintptr(addr1) > uintptr(addr2) {
            // Canonicalize order to reduce number of entries in visited.
            // Assumes non-moving garbage collector.
            addr1, addr2 = addr2, addr1
        }

        // Short circuit if references are already seen.
        typ := v1.Type()
        v := visit{addr1, addr2, typ}
        if visited[v] {
            return true
        }

        // Remember for later.
        visited[v] = true
    }

    switch v1.Kind() {
    case Array:
        for i := 0; i < v1.Len(); i++ {
            if !deepValueEqual(v1.Index(i), v2.Index(i), visited, depth+1) {
                return false
            }
        }
        return true
    case Slice:
        if v1.IsNil() != v2.IsNil() {
            return false
        }
        if v1.Len() != v2.Len() {
            return false
        }
        if v1.Pointer() == v2.Pointer() {
            return true
        }
        for i := 0; i < v1.Len(); i++ {
            if !deepValueEqual(v1.Index(i), v2.Index(i), visited, depth+1) {
                return false
            }
        }
        return true
    case Interface:
        if v1.IsNil() || v2.IsNil() {
            return v1.IsNil() == v2.IsNil()
        }
        return deepValueEqual(v1.Elem(), v2.Elem(), visited, depth+1)
    case Ptr:
        if v1.Pointer() == v2.Pointer() {
            return true
        }
        return deepValueEqual(v1.Elem(), v2.Elem(), visited, depth+1)
    case Struct:
        for i, n := 0, v1.NumField(); i < n; i++ {
            if !deepValueEqual(v1.Field(i), v2.Field(i), visited, depth+1) {
                return false
            }
        }
        return true
    case Map:
        if v1.IsNil() != v2.IsNil() {
            return false
        }
        if v1.Len() != v2.Len() {
            return false
        }
        if v1.Pointer() == v2.Pointer() {
            return true
        }
        for _, k := range v1.MapKeys() {
            val1 := v1.MapIndex(k)
            val2 := v2.MapIndex(k)
            if !val1.IsValid() || !val2.IsValid() || !deepValueEqual(val1, val2, visited, depth+1) {
                return false
            }
        }
        return true
    case Func:
        if v1.IsNil() && v2.IsNil() {
            return true
        }
        // Can't do better than this:
        return false
    default:
        // Normal equality suffices
        return valueInterface(v1, false) == valueInterface(v2, false)
    }
}

func valueInterface(v Value, safe bool) interface{} {
    if v.flag == 0 {
        panic(&ValueError{"reflect.Value.Interface", Invalid})
    }
    if safe && v.flag&flagRO != 0 {
        // Do not allow access to unexported values via Interface,
        // because they might be pointers that should not be
        // writable or methods or function that should not be callable.
        panic("reflect.Value.Interface: cannot return value obtained from unexported field or method")
    }
    if v.flag&flagMethod != 0 {
        v = makeMethodValue("Interface", v)
    }

    if v.kind() == Interface {
        // Special case: return the element inside the interface.
        // Empty interface has one layout, all interfaces with
        // methods have a second layout.
        if v.NumMethod() == 0 {
            return *(*interface{})(v.ptr)
        }
        return *(*interface {
            M()
        })(v.ptr)
    }

    // TODO: pass safe to packEface so we don't need to copy if safe==true?
    return packEface(v)
}
```

## 总结
Go 语言的反射原理和实现已经说的差不多了，跟其他语言一样反射可以获取数据内部的各种
信息，并且可以对他们进行修改。这在编码是有很多优势，比如可以编写更加灵活通用的程序，
避免了一些硬编码的情况; 还可以在编写单元测试时对变量进行修改，达到构造 Mock 数据
的效果; 甚至一些更加高级的更加具有想象力的使用方法。
同时反射也带来了一些负面的影响，由于反射难度大学习的成本也比较高，对开发人员有更
多的要求。 反射是在运行时完成的，所以过渡使用反射会影响程序的运行性能，比如我们经常
诟病 Go 语言的 Json 解析性能比较查就是因为里面大量的使用了反射机制。 所以反射虽然
提供了更加底层的控制和通用性，也需要在使用时非常谨慎，尽量减少反射的使用。

## 进一步阅读的参考文献
- [Pike, September 2011] Rob Pike, [The Laws of Reflection](https://blog.golang.org/laws-of-reflection), 2011
- [Wiki, November 2019] Wikipedia, [Reflection(computer programming)](https://en.wikipedia.org/wiki/Reflection_(computer_programming)), accesed November 5, 2019

## 许可
[Go under the hood](https://github.com/changkun/go-under-the-hood) | CC-BY-NC-ND 4.0 & MIT &copy; [two](https://two.github.io)
