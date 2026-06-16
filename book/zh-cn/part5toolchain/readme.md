---
weight: 5000
title: "第五部分 编译器与工具链"
bookCollapseSection: true
---

# 第五部分 编译器与工具链

- [第 15 章 编译器流水线](./ch15compile)
- [第 16 章 工具与可观测性](./ch16tools)
- [第 17 章 模块与依赖](./ch17modules)

<div class="quote">
<i class="quote-mark fas fa-thumbtack"></i>
<I>你无法信任并非完全由你亲手创造的代码。</I></br>
<I>You can't trust code that you did not totally create yourself.</I></br>
<div class="quote-right">
-- Ken Thompson, "Reflections on Trusting Trust"
</div>
</div>

我们写下的源码，最终要经由一整条工具链才能成为可运行的程序，
而这条链上的每一环，编译器、链接器、构建系统乃至依赖的传递闭包，都在悄然决定着程序的行为与可信度。
Thompson 在图灵奖演讲中提出的诘问至今仍发人深省：当信任沿着工具链层层传递，我们究竟在信任什么。
本部分由此切入 Go 的工具链全貌：先走完编译器从源码到机器码的多遍流水线，
再考察围绕构建、测试、性能剖析与可观测性的工具生态，
最后落到模块与依赖管理，看 Go 如何用最小版本选择与可验证的校验和，把「信任」这件事变得可被推理、可被复现。
