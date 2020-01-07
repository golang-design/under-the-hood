---
weight: 1105
title: "1.5 CPU 设计与架构"
---

## 1.5 CPU 设计与架构

TODO: 请不要阅读此小节，内容编排中

- 此处暂时记录平台相关差异
- 考虑成书时要么加入所有平台的比较、要么只考虑 darwin/linux,amd64

## amd64p32

- amd64p32 具有 ptrSize == 4 的大小但 CALL 指令仍然在栈中存储了 8 字节的 PC。
- `runtime.dataOffset`: amd64p32 表示 32 位指针仍然使用 64 位对齐布局。
- amd64p32 (NaCl) 不支持 AES 指令