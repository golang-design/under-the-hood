export const meta = {
  name: 'translate-book-en',
  description: 'Translate the remaining 126 Chinese book chapters to English (book/zh-cn -> book/en-us)',
  phases: [{ title: 'Translate', detail: 'one agent per .md file' }],
}

const files = ["finalwords.md","glossary.md","donate.md","part2lang/readme.md","part4memory/readme.md","part1overview/readme.md","part5toolchain/readme.md","part5toolchain/ch16tools/metric.md","part5toolchain/ch16tools/testing.md","part5toolchain/ch16tools/gopls.md","part5toolchain/ch16tools/readme.md","part5toolchain/ch16tools/deadlock.md","part5toolchain/ch16tools/perf.md","part5toolchain/ch16tools/trace.md","part5toolchain/ch16tools/race.md","part5toolchain/ch15compile/cgo.md","part5toolchain/ch15compile/unsafe.md","part5toolchain/ch15compile/parse.md","part5toolchain/ch15compile/future.md","part5toolchain/ch15compile/readme.md","part5toolchain/ch15compile/optimize.md","part5toolchain/ch15compile/escape.md","part5toolchain/ch15compile/ssa.md","part5toolchain/ch17modules/minimum.md","part5toolchain/ch17modules/challenges.md","part5toolchain/ch17modules/readme.md","part5toolchain/ch17modules/fight.md","part5toolchain/ch17modules/semantics.md","part3concurrency/ch11sync/map.md","part3concurrency/ch11sync/cond.md","part3concurrency/ch11sync/basic.md","part3concurrency/ch11sync/context.md","part3concurrency/ch11sync/mem.md","part3concurrency/ch11sync/mutex.md","part3concurrency/ch11sync/waitgroup.md","part3concurrency/ch11sync/pool.md","part3concurrency/ch11sync/atomic.md","part3concurrency/ch11sync/readme.md","part3concurrency/ch09sched/model.md","part3concurrency/ch09sched/preemption.md","part3concurrency/ch09sched/poller.md","part3concurrency/ch09sched/numa.md","part3concurrency/ch09sched/mpg.md","part3concurrency/ch09sched/schedule.md","part3concurrency/ch09sched/readme.md","part3concurrency/ch09sched/signal.md","part3concurrency/ch09sched/thread.md","part3concurrency/ch09sched/sysmon.md","part3concurrency/ch09sched/timer.md","part3concurrency/ch10chan/model.md","part3concurrency/ch10chan/select.md","part3concurrency/ch10chan/impl.md","part3concurrency/ch10chan/close.md","part3concurrency/ch10chan/readme.md","part3concurrency/ch10chan/lockfree.md","part3concurrency/ch10chan/sendrecv.md","part3concurrency/ch10chan/pattern.md","part2lang/ch06func/defer.md","part2lang/ch06func/func.md","part2lang/ch06func/readme.md","part2lang/ch06func/panic.md","part2lang/ch05data/map.md","part2lang/ch05data/swisstable.md","part2lang/ch05data/string.md","part2lang/ch05data/readme.md","part2lang/ch05data/slice.md","part2lang/ch07errors/inspect.md","part2lang/ch07errors/context.md","part2lang/ch07errors/value.md","part2lang/ch07errors/future.md","part2lang/ch07errors/readme.md","part2lang/ch07errors/semantics.md","part2lang/ch04type/readme.md","part2lang/ch04type/alias.md","part2lang/ch04type/type.md","part2lang/ch04type/interface.md","part2lang/ch08generics/contracts.md","part2lang/ch08generics/history.md","part2lang/ch08generics/checker.md","part2lang/ch08generics/future.md","part2lang/ch08generics/readme.md","part4memory/ch14stack/alloc.md","part4memory/ch14stack/shrink.md","part4memory/ch14stack/readme.md","part4memory/ch14stack/copy.md","part4memory/ch14stack/design.md","part4memory/ch14stack/grow.md","part4memory/ch13gc/sweep.md","part4memory/ch13gc/basic.md","part4memory/ch13gc/history.md","part4memory/ch13gc/pacing.md","part4memory/ch13gc/safe.md","part4memory/ch13gc/readme.md","part4memory/ch13gc/finalizer.md","part4memory/ch13gc/mark.md","part4memory/ch13gc/unifiedgc.md","part4memory/ch13gc/generational.md","part4memory/ch13gc/roc.md","part4memory/ch13gc/termination.md","part4memory/ch13gc/barrier.md","part4memory/ch12alloc/mstats.md","part4memory/ch12alloc/basic.md","part4memory/ch12alloc/history.md","part4memory/ch12alloc/pagealloc.md","part4memory/ch12alloc/smallalloc.md","part4memory/ch12alloc/component.md","part4memory/ch12alloc/init.md","part4memory/ch12alloc/readme.md","part4memory/ch12alloc/tinyalloc.md","part4memory/ch12alloc/largealloc.md","part1overview/ch02asm/frame.md","part1overview/ch02asm/args.md","part1overview/ch02asm/asm.md","part1overview/ch02asm/readme.md","part1overview/ch02asm/callconv.md","part1overview/ch01intro/go.md","part1overview/ch01intro/history.md","part1overview/ch01intro/readme.md","part1overview/ch01intro/csp.md","part1overview/ch03life/compile.md","part1overview/ch03life/main.md","part1overview/ch03life/readme.md","part1overview/ch03life/cmd.md","part1overview/ch03life/link.md","part1overview/ch03life/bootstrap.md","part1overview/ch03life/boot.md"]

const SRC = '/Users/changkun/dev/golang.design/under-the-hood/book/zh-cn/'
const DST = '/Users/changkun/dev/golang.design/under-the-hood/book/en-us/'

const SPEC = `Translate one Markdown chapter of a deep technical book on the Go runtime from Chinese to English. Read the source, write the English translation to the destination. Preserve everything structural; translate only natural-language text.

RULES:
1. Frontmatter: keep the YAML block. Keep weight and bookCollapseSection EXACTLY. Translate the title: value to English (keep quotes and any leading section number). Keep weight as the first key and title as the second, in the same order as the source (the site build parses them by byte position, so order and the "weight: " / "title: " prefixes must be exact).
2. Voice: serious, lightly academic, fluent English. Preserve the author's warm, personal voice: first-person "we" walking alongside the reader, anticipating the reader's questions ("the reader may wonder..."), and "the author" / "in the author's view" where the source says the author (笔者). Do not flatten into encyclopedic prose.
3. No em dashes. Never use the long dash or en dash character anywhere. Use commas, colons, parentheses, or separate sentences.
4. Avoid AI-tell phrasing: no "it's worth noting", "in fact", "essentially", "delve", filler "moreover", no hype adjectives. State things plainly and concretely.
5. Code blocks: keep code verbatim EXCEPT translate Chinese comments inside code to English. Never translate identifiers, keywords, or code string-literals. Keep the language tag.
6. Math: keep all LaTeX ($...$ and $$...$$) exactly.
7. Mermaid blocks: keep the diagram type and all node/edge IDs and syntax exactly. Translate only the human-readable label text (inside quotes or brackets). Keep the mermaid fence.
8. Links/assets: keep every link target and image path exactly (relative links like ./foo.md and ../assets/... stay unchanged; they resolve within the English tree). Translate only visible link text.
9. Epigraph quote blocks (div class="quote"): they hold a foreign-language original, its Chinese rendering, and an attribution. Keep the original (usually English) and the attribution; REMOVE the Chinese translation line(s). Keep the surrounding HTML structure.
10. First-occurrence term gloss: Chinese often gives an English term in parentheses. Drop the parenthetical and use the English term.
11. Do not summarize, abridge, or add content. Translate faithfully, paragraph for paragraph.

Write the translated file to the destination path using the Write tool. Then return your structured status.`

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    path: { type: 'string', description: 'the relative path translated' },
    ok: { type: 'boolean', description: 'true if the file was written successfully' },
    concern: { type: 'string', description: 'any structural concern, or empty string' },
  },
  required: ['path', 'ok', 'concern'],
}

log(`translating ${files.length} files`)

const results = await parallel(files.map((rel) => () =>
  agent(
    `${SPEC}\n\nSOURCE: ${SRC}${rel}\nDEST:   ${DST}${rel}\nThe relative path for your status is: ${rel}`,
    { label: `tr:${rel}`, phase: 'Translate', schema: SCHEMA }
  )
))

const done = results.filter(Boolean)
const failed = done.filter((r) => !r.ok).map((r) => r.path)
const concerns = done.filter((r) => r.concern && r.concern.trim()).map((r) => `${r.path}: ${r.concern}`)
const missing = files.length - done.length

return {
  requested: files.length,
  succeeded: done.filter((r) => r.ok).length,
  failedOrNull: missing,
  failedPaths: failed,
  concerns,
}
