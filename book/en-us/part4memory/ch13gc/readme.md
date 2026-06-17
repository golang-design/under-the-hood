---
weight: 4200
title: "Chapter 13 Garbage Collector"
bookCollapseSection: true
---

# Chapter 13 Garbage Collector

- [13.1 The Basic Idea of Garbage Collection](./basic.md)
- [13.2 Write Barrier Techniques](./barrier.md)
- [13.3 Trigger Frequency and the Pacing Algorithm](./pacing.md)
- [13.4 Scan Marking and Mark Assist](./mark.md)
- [13.5 Sweeping and Bitmaps](./sweep.md)
- [13.6 The Mark Termination Phase](./termination.md)
- [13.7 Safe Point Analysis](./safe.md)
- [13.8 The Generational Hypothesis and Generational Collection](./generational.md)
- [13.9 The Request Hypothesis and Transaction-Oriented Collection](./roc.md)
- [13.10 Finalizers](./finalizer.md)
- [13.11 Past, Present, and Future](./history.md)
- [13.12 A Unified Theory of Garbage Collection](./unifiedgc.md)

<div class="quote">
<i class="quote-mark fas fa-thumbtack"></i>
<I>
When is the best time to do a GC? When nobody is looking. Using camera
to track eye movement when subject looks away do a GC.
</I></br>
<div class="quote-right">
-- Richard Hudson
</div>
</div>

Garbage collection is a rather difficult and intricate piece of systems engineering.
