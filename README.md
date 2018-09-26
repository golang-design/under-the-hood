# Go: Under the Hood

基于 `go1.11`

## 目录

1. [引导](content/1-boot.md)
2. [初始化概览](content/2-init.md)
3. [主 goroutine 生命周期](content/3-main.md)
4. [内存管理](content/4-mem.md)
5. Goroutine scheduler
6. Garbage collection
7. `chan`
8. `defer`
9.  Cgo
10. Finalizer
11. 标准库
    - [`sync.Pool`](content/11-pkg/pool.md)
    - `atomic`
    - `net`
    - ...

## 参考

- [Scalable Go Scheduler Design Doc](https://docs.google.com/document/d/1TTj4T2JO42uD5ID9e89oa0sLKhJYD0Y_kqxDv3I3XMw/edit#heading=h.mmq8lm48qfcw)
- [Go Preemptive Scheduler Design Doc](https://docs.google.com/document/d/1ETuA2IOmnaQ4j81AtTGT40Y4_Jr6_IDASEKg0t0dBR8/edit#heading=h.3pilqarbrc9h)
- [NUMA-aware scheduler for Go](https://docs.google.com/document/u/0/d/1d3iI2QWURgDIsSR6G2275vMeQ_X7w-qxM2Vp7iGwwuM/pub)
- [Scheduling Multithreaded Computations by Work Stealing](papers/steal.pdf)
- [Golang Internals, Part 1: Main Concepts and Project Structure](https://blog.altoros.com/golang-part-1-main-concepts-and-project-structure.html)
- [Golang Internals, Part 2: Diving Into the Go Compiler](https://blog.altoros.com/golang-internals-part-2-diving-into-the-go-compiler.html)
- [Golang Internals, Part 3: The Linker, Object Files, and Relocations](https://blog.altoros.com/golang-internals-part-3-the-linker-and-object-files.html)
- [Golang Internals, Part 4: Object Files and Function Metadata](https://blog.altoros.com/golang-part-4-object-files-and-function-metadata.html)
- [Golang Internals, Part 5: the Runtime Bootstrap Process](https://blog.altoros.com/golang-internals-part-5-runtime-bootstrap-process.html)
- [Golang Internals, Part 6: Bootstrapping and Memory Allocator Initialization](https://blog.altoros.com/golang-internals-part-6-bootstrapping-and-memory-allocator-initialization.html)
- [LINUX SYSTEM CALL TABLE FOR X86 64](http://blog.rchapman.org/posts/Linux_System_Call_Table_for_x86_64/)
- [Getting to Go: The Journey of Go's Garbage Collector](https://blog.golang.org/ismmkeynote)
- [Go 1.5 源码剖析](https://github.com/qyuhen/book/blob/master/Go%201.5%20%E6%BA%90%E7%A0%81%E5%89%96%E6%9E%90%20%EF%BC%88%E4%B9%A6%E7%AD%BE%E7%89%88%EF%BC%89.pdf)
- [也谈 goroutine 调度器](https://tonybai.com/2017/06/23/an-intro-about-goroutine-scheduler/)
- http://www.cnblogs.com/diegodu/p/5803202.html
- https://www.cnblogs.com/zkweb/category/1108329.html
- http://legendtkl.com/categories/golang/

## License

MIT &copy; [changkun](https://changkun.de)