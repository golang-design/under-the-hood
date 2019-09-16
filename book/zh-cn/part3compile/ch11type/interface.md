# 关键字: interface

[TOC]

## 接口作用
`interface{}` 在 `Go`中有两个重要的作用:
1. 作为通用动态类型
`Go`语言是一个强类型语言
2. 定义一组方法的集合

## 接口分类
### 不包含方法的接口eface
#### eface 的类型定义
不包含方法的接口是定义一个接口时，并没有指定这个接口需要实现的一组方法, 例如:
```go
type I interface{}
```
不包含方法的接口的定义在`runtime/runtime2.go`中，定义如下:
```go
// 不包含方法的接口
type eface struct {
    _type *_type  // 接口类型
    data  unsafe.Pointer // 接口所指向的具体类型值的地址
}
```
其中`_type`的类型是`*_type`, `_type`这个类型是`Go`语言中表示绝大多数值的表示方式
```go
// _type 必须要与  ../cmd/link/internal/ld/decodesym.go:/^func.commonsize,
// ../cmd/compile/internal/gc/reflect.go:/^func.dcommontype 和 
// ../reflect/type.go:/^type.rtype 中的结构保持同步
type _type struct {
    size       uintptr // 类型大小
    ptrdata    uintptr // size of memory prefix holding all pointers
    hash       uint32  // hash 值
    tflag      tflag   // 用来存储一些类型的额外信息
    align      uint8   // 此类型作为变量时内存对齐的大小
    fieldalign uint8   // 此类型作为 struct field 的内存对齐大小
    kind       uint8   // 所代表的具体类型
    alg        *typeAlg // 定义hash 和 equal 函数
    // gcdata 存储了为垃圾回收而准备的 GC 类型的数据
    // 如果kind 的值是 KindGCProg, gcdata 就是一个垃圾回收程序,
    // 否则，gcdata 就是一个 ptrmask 位图, 详情参考: mbitmap.go
    gcdata    *byte
    str       nameOff // 类型名字的偏移
    ptrToThis typeOff // 指向此类型的指针的类型， 可能是0值
}
```

`kind`的值就是`_type`所表示的具体类型,  定义在`runtime/kindtype.go`中，主要包括:
```go
const (
    kindBool = 1 + iota
    kindInt
	...
    kindDirectIface = 1 << 5
    kindGCProg      = 1 << 6
    kindMask        = (1 << 5) - 1
)
```
`kind`的定义要与`cmd/link/internal/ld/decodesym.go`中的定义保持同步。

#### eface 类型转换
当把一个具体的类型转换为空的`interface{}`类型时，会进行类型转换，可以看下面的例子:
```go
package main

func main() {
    num1 := 3
    var num2 interface{} = num1
    println(num2)
}
```
`num2`被赋值为`num1`, 并且把`num1`的`int`类型转换为`interface{}`类型, 对应的汇编代码如下:
```asm
    0x0026 00038 (main1.go:5)    MOVQ    $3, ""..autotmp_2+24(SP)
    0x002f 00047 (main1.go:5)    LEAQ    type.int(SB), AX
    0x0036 00054 (main1.go:5)    MOVQ    AX, "".num2+32(SP)
    0x003b 00059 (main1.go:5)    LEAQ    ""..autotmp_2+24(SP), AX
    0x0040 00064 (main1.go:5)    MOVQ    AX, "".num2+40(SP)
```
`type.int(SB)` 符号表示 `kind`  为 `int` 的 `_type` 类型, 通过寄存器 `AX` Load 到 `num2+32(SP)`, 执行后的栈如下:
```
                    +--------------+                          
                    |              |          +------------+  
                    |   autotmp_2  |--------->|    value 3 |  
                    |   address    |          +------------+  
                    |              |                          
                    +--------------+<---------  num2+40(SP)   
                    |              |                          
                    |   _type      |                          
                    |   address    |                          
                    |              |<--------   num2+32(SP)   
                    +--------------+                          
```                                                            
`autotmp_2`是一个内部的临时动态变量。
还有一种方式是不经过中间变量直接赋值:
```go
package main

func main() {
    var num2 interface{} = 3
    println(num2)
}
```
对应的汇编代码为:
```asm
    0x001d 00029 (main2.go:4)   LEAQ    type.int(SB), AX
    0x0024 00036 (main2.go:4)   PCDATA  $0, $0
    0x0024 00036 (main2.go:4)   MOVQ    AX, "".num2+16(SP)
    0x0029 00041 (main2.go:4)   LEAQ    ""..stmp_0(SB), AX
    0x0030 00048 (main2.go:4)   MOVQ    AX, "".num2+24(SP)
```
过程与前面基本相同，不同的是常量`3`是通过`stmp_0(SB)`进行赋值的, `stmp_0`符合的信息可以通过下面得到:
```asm
""..stmp_0 SRODATA size=8
    0x0000 03 00 00 00 00 00 00 00                          ........
```
### 包含方法的接口iface
 包含方法的接口是指在定义接口时，定义了一组接口的方法:
```go
type Person interface {
    Name() string
}
```
包含方法的接口的定义在`runtime/runtime2.go`中，定义如下:
```go
// 包含方法的接口
type iface struct {
    tab  *itab // 包含接口的静态类型信息、数据的动态类型信息、函数表的结构
    data unsafe.Pointer // 接口所指向的具体类型值的地址
}
```
其中`itab`类型定义如下:
```go
// 编译器中已知的结构
// 分配在非废垃圾回收的内存区域
// 需要与../cmd/compile/internal/gc/reflect.go:/^func.dumptypestructs 中结构保持同步
type itab struct {
    inter *interfacetype 
    _type *_type
    hash  uint32 // _type.hash 的 copy, 用于类型的判断
    _     [4]byte
    fun   [1]uintptr // 可变大小，func[0]==0 意味着 _type 没有实现相关接口函数
}

```
`fun` 表示的 interface 里面的 method 的具体实现,这里放置和接口方法对应的具体实现的方法地址, 一般在每次给接口赋值发生转换时会更新此表，或者直接拿缓存的itab。
`inter` 的类型是`*interfacetype`, 具体的定义如下:
```go
type interfacetype struct {
    typ     _type // 所实现的接口的类型
    pkgpath name  // 所实现的接口的定义路径
    mhdr    []imethod //   所实现的接口在定义时的函数声明列表
}
```
### iface 类型转换
当一个类型实现了某个接口所定义的一组函数，这个类型就可以被当做这个接口类型，这就是[duck typing](https://en.wikipedia.org/wiki/Duck_typing)。下面我们看看如何实现一个接口:
```go
package main

type Person interface {
    Name() string
}

type student struct {
    name string
}

func (s student) Name() string {
    return s.name
}

func main() {
    s := student{name: "sean"}
    echoName(s)
}

func echoName(p Person) {
    println(p.Name())
}
```
`echoName`函数的参数类型是`Person`, 由于`Student`实现了`Person`的方法`Name`, 所以`Student`也可以作为`Person` 类型传递到`echoName`函数中。 对应的汇编的代码如下:
```asm
    0x003a 00058 (main1.go:17)  PCDATA  $0, $0
    0x003a 00058 (main1.go:17)  MOVQ    AX, (SP)
    0x003e 00062 (main1.go:17)  MOVQ    $4, 8(SP)
    0x0047 00071 (main1.go:17)  CALL    runtime.convTstring(SB)
    0x004c 00076 (main1.go:17)  PCDATA  $0, $1
    0x004c 00076 (main1.go:17)  MOVQ    16(SP), AX
    0x0051 00081 (main1.go:17)  MOVQ    AX, ""..autotmp_1+24(SP)
    0x0056 00086 (main1.go:17)  PCDATA  $0, $2
    0x0056 00086 (main1.go:17)  LEAQ    go.itab."".student,"".Person(SB), CX
    0x005d 00093 (main1.go:17)  PCDATA  $0, $1
    0x005d 00093 (main1.go:17)  MOVQ    CX, (SP)
    0x0061 00097 (main1.go:17)  PCDATA  $0, $0
    0x0061 00097 (main1.go:17)  MOVQ    AX, 8(SP)
    0x0066 00102 (main1.go:17)  CALL    "".echoName(SB)
```
`s` 作为参数传入`echoName`函数中，`s`只有一个`name`字段类型为`string`, 所以将这个字段放到栈底, 然后作为参数调用`runtime.convTstring`函数，函数定义如下:
```go
func convTstring(val string) (x unsafe.Pointer) {
    if val == "" {
        x = unsafe.Pointer(&zeroVal[0])
    } else {
        x = mallocgc(unsafe.Sizeof(val), stringType, true)
        *(*string)(x) = val
    }
    return
}
```
其作用是申请变量`x`, 将`x`的值指向`s`, 然后返回。其实对应的就是`iface`的`data`字段。
再看`go.itab."".student,"".Person(SB)`这个符号 代表的含义如下:
```asm
go.itab."".student,"".Person SRODATA dupok size=32
    0x0000 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00  ................
    0x0010 84 56 eb b4 00 00 00 00 00 00 00 00 00 00 00 00  .V..............
    rel 0+8 t=1 type."".Person+0 // 链接时填充为 Person 类型地址
    rel 8+8 t=1 type."".student+0 // 链接时填充为 student 的 _type 类型地址
    rel 24+8 t=1 "".(*student).Name+0 //  链接时填充函数 Name 的地址
```
可见这个符号其实时定义的一个变量，具体的赋值是在链接阶段完成的。
这个变量大小为`32`字节，与 itab的定义是一致的, 计算方式如下: 
32 = `*interfacetype`(8位) + `*_type` (8位) + `uint32` (4位) + `[4]byte` (4位) + [1]uintptr (8位)

最终`data`与`itab`一起组成了`iface`类型，作为参数传给了函数`echoName`。
### 多方法接口
前面介绍`itab`时`fun`字段的类型是`[1]uintptr`, 是实现的接口的函数的地址，这个是一个长度为1的数组结构，如果包含多个函数时，是如何实现的？
```go
package main

type Person interface {
    Name() string
    Age() int
}

type student struct {
    name string
    age  int
}

func (s student) Name() string {
    return s.name
}

func (s student) Age() int {
    return s.age
}

func main() {
    s := student{name: "sean", age: 20}
    echoPerson(s)
}

func echoPerson(p Person) {
    p.Name()
    p.Age()
}
```
接口`Pseron`定义了两个方法, `student` 实现了这个接口, 下面看一下`echoPerson`是如何调用这两个函数的:
```asm
    0x001d 00029 (main2.go:27)  MOVQ    "".p+40(SP), AX
    0x0022 00034 (main2.go:27)  TESTB   AL, (AX)
    0x0024 00036 (main2.go:27)  MOVQ    32(AX), AX
    0x0028 00040 (main2.go:27)  PCDATA  $0, $1
    0x0028 00040 (main2.go:27)  MOVQ    "".p+48(SP), CX
    0x002d 00045 (main2.go:27)  PCDATA  $0, $0
    0x002d 00045 (main2.go:27)  MOVQ    CX, (SP)
    0x0031 00049 (main2.go:27)  CALL    AX
    0x0033 00051 (main2.go:28)  MOVQ    "".p+40(SP), AX
    0x0038 00056 (main2.go:28)  TESTB   AL, (AX)
    0x003a 00058 (main2.go:28)  MOVQ    24(AX), AX
    0x003e 00062 (main2.go:28)  PCDATA  $0, $1
    0x003e 00062 (main2.go:28)  PCDATA  $1, $1
    0x003e 00062 (main2.go:28)  MOVQ    "".p+48(SP), CX
    0x0043 00067 (main2.go:28)  PCDATA  $0, $0
    0x0043 00067 (main2.go:28)  MOVQ    CX, (SP)
    0x0047 00071 (main2.go:28)  CALL    AX
```
其中`32(AX)`就是`Name`函数的地址，`24(AX)`就是`Age`函数的地址， 根据`itab`的结构，`24(AX)`就是`fun`的地址，所以多个函数时，是按照`fun`地址依次往后排的，函数排列的顺序是按照函数名称的字母顺序排序的。

## 指针 receiver 与值 receiver
接口的接收者可以是指针，也可以是值， 这两个接收者类型会有一些差别: 指针接收者实现的接口，只有指向这个类型的指针才能够实现对应的接口；值接收者实现的接口，这个类型的值和指针都能够实现对应的接口。 这就话看上去有点儿绕， 还以上面的代码为例，分别实现不通接收者:
值接收者:
```go
func (s *student) Name() string {
    return s.name
}
```

指针接收者:
```go
func (s student) Name() string {
    return s.name
}
```
值调用
```go
func main() {
    s := student{name: "sean"}
    echoName(s)
}
```
指针调用:
```go
func main() {
    s := &student{name: "sean"}
    echoName(s)
}
```
分别拿指针接收者和值接收者与指针调用和值调用组合，只有下面这种情况报错:
```go
func (s *student) Name() string {
    return s.name
}

func main() {
    s := student{name: "sean"}
    echoName(s)
}

```
编译错误信息为:
```
main1.go:17:10: cannot use s (type student) as type Person in argument to echoName:
    student does not implement Person (Name method has pointer receiver)
```
这是什么原因呢？ 定义为值接收者时对应的汇编可以看到:
```asm
"".student.Name STEXT nosplit size=29 args=0x20 locals=0x0
...
"".(*student).Name STEXT dupok size=165 args=0x18 locals=0x48
```
既有值得函数实现又有指针的函数实现，所以使用值和指针调用都没有问题。
定义为指针接收者时, 只有指针接收者的函数实现:
```asm
"".(*student).Name STEXT nosplit size=33 args=0x18 locals=0x0
```
这么做主要是因为有些时候是无法取地址的,例如:
```go
package main

type Person interface {
    Name() string
}

type student int

func (s *student) Name() string {
    return "no name"
}

func main() {
    student(12).Name()
}

// ./main.go:14:13: cannot call pointer method on student(12)
// ./main.go:14:13: cannot take the address of student(12)
```

## 类型断言
`interface{}` 是一个抽象的类型，如果需要转换为具体的类型，则需要类型断言, 类型断言其实有两个作用:
1. 类型判断: 判断类型是否一致
2. 类型转换: 类型一致返回具体的类型
调用方式也有两种:
1. 只有一个返回值，如果断言失败，会出现`panic`
2. 两个返回值，第一个返回值是转换后的类型，第二个返回值是断言是否成功
看一个具体的例子:
```go
package main

var u uint32
var i int32
var ok bool
var eface interface{}

func assertion() {
        t := uint64(42)
        eface = t
        u = eface.(uint32)
        i, ok = eface.(int32)
}
```
对于 `u = eface.(uint32)` 对应的汇编如下:
```asm
    0x0066 00102 (main.go:11)   PCDATA  $0, $0
    0x0066 00102 (main.go:11)   PCDATA  $1, $0
    0x0066 00102 (main.go:11)   MOVL    $0, ""..autotmp_1+36(SP)
    0x006e 00110 (main.go:11)   PCDATA  $0, $1
    0x006e 00110 (main.go:11)   MOVQ    "".eface+8(SB), AX
    0x0075 00117 (main.go:11)   MOVQ    "".eface(SB), CX
    0x007c 00124 (main.go:11)   PCDATA  $0, $3
    0x007c 00124 (main.go:11)   LEAQ    type.uint32(SB), DX
    0x0083 00131 (main.go:11)   CMPQ    CX, DX
    0x0086 00134 (main.go:11)   JEQ 138
    0x0088 00136 (main.go:11)   JMP 246
    0x008a 00138 (main.go:11)   PCDATA  $0, $0
    0x008a 00138 (main.go:11)   MOVL    (AX), AX
    0x008c 00140 (main.go:11)   MOVL    AX, ""..autotmp_1+36(SP)
    0x0090 00144 (main.go:11)   MOVL    AX, "".u(SB)
    ...
    0x00f6 00246 (main.go:11)   PCDATA  $0, $4
    0x00f6 00246 (main.go:11)   PCDATA  $1, $0
    0x00f6 00246 (main.go:11)   MOVQ    CX, (SP)
    0x00fa 00250 (main.go:11)   PCDATA  $0, $0
    0x00fa 00250 (main.go:11)   MOVQ    DX, 8(SP)
    0x00ff 00255 (main.go:11)   PCDATA  $0, $1
    0x00ff 00255 (main.go:11)   LEAQ    type.interface {}(SB), AX
    0x0106 00262 (main.go:11)   PCDATA  $0, $0
    0x0106 00262 (main.go:11)   MOVQ    AX, 16(SP)
    0x010b 00267 (main.go:11)   CALL    runtime.panicdottypeE(SB)
    0x0110 00272 (main.go:11)   XCHGL   AX, AX
    0x0111 00273 (main.go:11)   NOP
```
首先把`_type` Load 到寄存器`CX中`:`MOVQ "".eface(SB)`, CX`， 然后与`DX` 中的`uint32`类型比较，如果是相同的类型，则给`u`赋值，否则跳转到下面, 执行`runtime.panicdottypeE(SB)`。

对于 `i, ok = eface.(int32)`函数对应的汇编如下:
```asm
    0x0096 00150 (main.go:12)   PCDATA  $0, $1
    0x0096 00150 (main.go:12)   MOVQ    "".eface+8(SB), AX
    0x009d 00157 (main.go:12)   PCDATA  $0, $2
    0x009d 00157 (main.go:12)   LEAQ    type.int32(SB), CX
    0x00a4 00164 (main.go:12)   PCDATA  $0, $1
    0x00a4 00164 (main.go:12)   CMPQ    "".eface(SB), CX
    0x00ab 00171 (main.go:12)   JEQ 175
    0x00ad 00173 (main.go:12)   JMP 223
    0x00af 00175 (main.go:12)   PCDATA  $0, $0
    0x00af 00175 (main.go:12)   MOVL    (AX), AX
    0x00b1 00177 (main.go:12)   MOVL    $1, CX
    0x00b6 00182 (main.go:12)   JMP 184
    0x00b8 00184 (main.go:12)   MOVL    AX, ""..autotmp_2+32(SP)
    0x00bc 00188 (main.go:12)   MOVB    CL, ""..autotmp_3+31(SP)
    0x00c0 00192 (main.go:12)   MOVL    ""..autotmp_2+32(SP), AX
    0x00c4 00196 (main.go:12)   MOVL    AX, "".i(SB)
    0x00ca 00202 (main.go:12)   MOVBLZX ""..autotmp_3+31(SP), AX
    0x00cf 00207 (main.go:12)   MOVB    AL, "".ok(SB)
    0x00d5 00213 (main.go:13)   MOVQ    56(SP), BP
    0x00da 00218 (main.go:13)   ADDQ    $64, SP
    0x00de 00222 (main.go:13)   RET
    0x00df 00223 (main.go:13)   XORL    AX, AX
    0x00e1 00225 (main.go:13)   XORL    CX, CX
    0x00e3 00227 (main.go:12)   JMP 184
```
其过程如下:
1. 把`int32`类型放到寄存器`CX`
2. 比较`eface`的类型与`CX`寄存器的类型，
3. 如果类型相等， `data`赋值到`i` ，`ok` 的值为 `true`
4. 如果不相等， 零值赋值到`i`, `ok`  赋值为 `false`

## 进一步阅读的参考文献

1. [Go Data Structures: Interfaces](https://research.swtch.com/interfaces)
2. [unaddressable-values](https://go101.org/article/unofficial-faq.html#unaddressable-values)

## 许可

[Go under the hood](https://github.com/changkun/go-under-the-hood) | CC-BY-NC-ND 4.0 & MIT &copy; [changkun](https://changkun.de)
