# Go: Under the Hood

based on go1.11

## Topics

1. Booting
2. Memory menagement
3. Goroutine scheduler
4. Garbage collection
5. Channel
6. Defer
7. Finalizer
8. Cgo
9. Package `sync`
   - `pool`

## References

- [Scalable Go Scheduler Design Doc](https://docs.google.com/document/d/1TTj4T2JO42uD5ID9e89oa0sLKhJYD0Y_kqxDv3I3XMw/edit#heading=h.mmq8lm48qfcw)
- [Go Preemptive Scheduler Design Doc](https://docs.google.com/document/d/1ETuA2IOmnaQ4j81AtTGT40Y4_Jr6_IDASEKg0t0dBR8/edit#heading=h.3pilqarbrc9h)
- [Scheduling Multithreaded Computations by Work Stealing](http://supertech.csail.mit.edu/papers/steal.pdf)
- [Golang Internals, Part 1: Main Concepts and Project Structure](https://blog.altoros.com/golang-part-1-main-concepts-and-project-structure.html)
- [Golang Internals, Part 2: Diving Into the Go Compiler](https://blog.altoros.com/golang-internals-part-2-diving-into-the-go-compiler.html)
- [Golang Internals, Part 3: The Linker, Object Files, and Relocations](https://blog.altoros.com/golang-internals-part-3-the-linker-and-object-files.html)
- [Golang Internals, Part 4: Object Files and Function Metadata](https://blog.altoros.com/golang-part-4-object-files-and-function-metadata.html)
- [Golang Internals, Part 5: the Runtime Bootstrap Process](https://blog.altoros.com/golang-internals-part-5-runtime-bootstrap-process.html)
- [Golang Internals, Part 6: Bootstrapping and Memory Allocator Initialization](https://blog.altoros.com/golang-internals-part-6-bootstrapping-and-memory-allocator-initialization.html)
- [LINUX SYSTEM CALL TABLE FOR X86 64](http://blog.rchapman.org/posts/Linux_System_Call_Table_for_x86_64/)
- [Analysis of the Go runtime scheduler](http://www.cs.columbia.edu/~aho/cs6998/reports/12-12-11_DeshpandeSponslerWeiss_GO.pdf)
- [Getting to Go: The Journey of Go's Garbage Collector](https://blog.golang.org/ismmkeynote)
- [Go 1.5 源码剖析](https://github.com/qyuhen/book/blob/master/Go%201.5%20%E6%BA%90%E7%A0%81%E5%89%96%E6%9E%90%20%EF%BC%88%E4%B9%A6%E7%AD%BE%E7%89%88%EF%BC%89.pdf)
- [也谈 goroutine 调度器](https://tonybai.com/2017/06/23/an-intro-about-goroutine-scheduler/)
- http://www.cnblogs.com/diegodu/p/5803202.html
- https://www.cnblogs.com/zkweb/category/1108329.html
- http://legendtkl.com/categories/golang/
## License

MIT &copy; [changkun](https://changkun.de)