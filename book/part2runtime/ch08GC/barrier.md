# 垃圾回收器: 内存屏障

[TOC]

Go 的标记清扫分回收器和赋值器两个部分，赋值器在进行标记的过程中，会执行：创建、读取、写入操作。

## 许可

[Go under the hood](https://github.com/changkun/go-under-the-hood) | CC-BY-NC-ND 4.0 & MIT &copy; [changkun](https://changkun.de)
