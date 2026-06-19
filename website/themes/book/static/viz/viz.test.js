/*
 * Regression test for the GMP scheduler widget in viz.js.
 *
 * It loads the REAL viz.js against a stubbed DOM + a recording 2D canvas
 * context, mounts the `gmp-scheduler` widget, and pumps animation frames by
 * hand. It then asserts the behaviours the widget is supposed to teach — the
 * ones it has historically gotten wrong:
 *
 *   1. A local run queue actually FILLS with several goroutines (a `go`-burst),
 *      instead of holding at most one at a time.
 *   2. Work stealing is VISIBLE — the "窃取!" flash fires as an idle P pulls
 *      half of a busy P's queue.
 *   3. The global run queue (GRQ) is a live backstop: visibly used a good
 *      fraction of the time and holding several Gs at peak (it may legitimately
 *      empty sometimes — idle Ps drain it).
 *   4. Goroutines ANIMATE between slots (render at off-grid positions) instead
 *      of teleporting.
 *
 * The widget is stochastic (Math.random), so the harness seeds a deterministic
 * PRNG and runs several seeds, asserting on the aggregate. That keeps the test
 * reproducible and non-flaky while still exercising many trajectories.
 *
 * Run: node website/themes/book/static/viz/viz.test.js
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// ---- geometry mirrored from viz.js ------------------------------------------
const W = 760;
const NP = 3, QCAP = 6, GRQ_MAX = 14;
const GRQ_Y = 56, GRQ_X0 = 150, GRQ_SLOT = 26;
const LOCAL_Y = 120 + 132; // pGeo.y + 132 — where settled local-queue dots sit
function pGeoX(i) { const pw = 200, gap = 24, total = NP * pw + (NP - 1) * gap; const x0 = (W - total) / 2; return x0 + i * (pw + gap); }
const localXRange = (p) => { const gx = pGeoX(p); return [gx + 24 - 6, gx + 24 + (QCAP - 1) * 28 + 6]; };
const slotCenters = [];
for (let i = 0; i < GRQ_MAX; i++) slotCenters.push(GRQ_X0 + i * GRQ_SLOT);
for (let p = 0; p < NP; p++) { const gx = pGeoX(p);
  for (let k = 0; k < QCAP; k++) slotCenters.push(gx + 24 + k * 28); // local slots
  slotCenters.push(gx + 200 - 40);                                   // runPos (M)
  slotCenters.push(gx + 30);                                         // headPos (spawn)
}
const onGrid = (x) => slotCenters.some((c) => Math.abs(c - x) < 0.6);

// A goroutine is a *filled* dot; an empty queue slot is a *stroked* ring at the
// same place. Tagging each arc with how it was painted keeps the two from being
// conflated (an earlier version of this test counted the 14 GRQ slot rings as
// goroutines and "passed" trivially).
const G_FILLS = new Set(["#007d9c" /*blue/queued*/, "#1f9d6b" /*green/running*/, "#c9742a" /*orange/stolen*/]);
const isG = (a) => a.fill && G_FILLS.has(a.fill) && a.r >= 8;

const code = fs.readFileSync(path.join(__dirname, "viz.js"), "utf8");

// deterministic PRNG (mulberry32) so each seed is a fixed, reproducible run.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function runSim(seed, frames) {
  let frameArcs = [], frameTexts = [], pending = null;
  function makeCtx() {
    return {
      fillStyle: "", strokeStyle: "", lineWidth: 1, font: "", textAlign: "", textBaseline: "", globalAlpha: 1,
      beginPath() { pending = null; },
      arc(x, y, r) { pending = { x, y, r, fill: null, stroked: false }; frameArcs.push(pending); },
      fill() { if (pending) pending.fill = this.fillStyle; },
      stroke() { if (pending) pending.stroked = true; },
      moveTo() {}, lineTo() {}, arcTo() {}, closePath() {}, strokeText() {}, clearRect() {},
      fillText(t, x, y) { frameTexts.push({ t, x, y }); },
      setTransform() {}, save() {}, restore() {},
    };
  }
  function makeEl() {
    return {
      className: "", type: "", textContent: "", innerHTML: "", style: {}, width: 0, height: 0,
      clientWidth: W, isConnected: true,
      classList: { add() {}, remove() {}, contains() { return false; } },
      _ctx: null, children: [],
      appendChild(c) { this.children.push(c); return c; },
      addEventListener() {}, removeEventListener() {},
      getContext() { return this._ctx || (this._ctx = makeCtx()); },
      setAttribute() {}, getAttribute(n) { return n === "data-viz" ? "gmp-scheduler" : null; },
    };
  }
  const host = makeEl();
  let rafQueue = [];
  // Math with a seeded random() so the run is deterministic.
  const M = {}; Object.getOwnPropertyNames(Math).forEach((k) => { M[k] = Math[k]; });
  M.random = mulberry32(seed);
  const sandbox = {
    Math: M, console,
    window: { devicePixelRatio: 1, addEventListener() {}, removeEventListener() {} },
    document: {
      readyState: "complete",
      documentElement: { classList: { contains() { return false; } } },
      addEventListener() {},
      createElement() { return makeEl(); },
      querySelectorAll(sel) { return sel.indexOf("viz") >= 0 ? [host] : []; },
    },
    getComputedStyle() { return { getPropertyValue() { return ""; } }; },
    MutationObserver: class { observe() {} disconnect() {} },
    requestAnimationFrame(cb) { rafQueue.push(cb); return rafQueue.length; },
    cancelAnimationFrame() {},
  };
  sandbox.window.requestAnimationFrame = sandbox.requestAnimationFrame;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox); // mounts the widget, queues the first frame

  const r = { totalFrames: 0, grqPopulatedFrames: 0, maxGrqDots: 0, sumGrq: 0,
              maxLocalDepth: 0, sumLocalTotal: 0, localFillFrames: 0, multiColFrames: 0,
              stealFrames: 0, offGridSamples: 0 };
  for (let f = 1; f <= frames; f++) {
    const due = rafQueue; rafQueue = [];
    frameArcs = []; frameTexts = [];
    due.forEach((cb) => cb(f * (1000 / 60))); // steady 60fps
    const grqDots = frameArcs.filter((a) => isG(a) && Math.abs(a.y - GRQ_Y) < 4 && a.x >= GRQ_X0 - 2);
    if (f <= 120) continue; // let the seeded pile drain before counting steady state
    r.totalFrames++;
    if (grqDots.length > 0) r.grqPopulatedFrames++;
    r.maxGrqDots = Math.max(r.maxGrqDots, grqDots.length);
    r.sumGrq += grqDots.length;
    if (frameArcs.some((a) => isG(a) && !onGrid(a.x))) r.offGridSamples++;
    let frameMaxDepth = 0, colsWithBacklog = 0;
    for (let p = 0; p < NP; p++) {
      const [lo, hi] = localXRange(p);
      const depth = frameArcs.filter((a) => isG(a) && Math.abs(a.y - LOCAL_Y) < 6 && a.x >= lo && a.x <= hi).length;
      frameMaxDepth = Math.max(frameMaxDepth, depth);
      if (depth >= 2) colsWithBacklog++;
      r.sumLocalTotal += depth;
    }
    r.maxLocalDepth = Math.max(r.maxLocalDepth, frameMaxDepth);
    if (frameMaxDepth >= 3) r.localFillFrames++;        // a queue is visibly full this frame
    if (colsWithBacklog >= 2) r.multiColFrames++;       // backlog spread across >1 column, not one hot P
    if (frameTexts.some((t) => t.t.indexOf("窃取") >= 0)) r.stealFrames++;
  }
  return r;
}

// ---- run several seeds and aggregate ----------------------------------------
const SEEDS = [1, 7, 42, 1234, 90210];
const FRAMES = 1500; // ~25s of simulated time at speed 1
const runs = SEEDS.map((s) => ({ seed: s, ...runSim(s, FRAMES) }));

const agg = {
  frames: Math.min(...runs.map((r) => r.totalFrames)),
  grqPctMean: avg(runs.map((r) => r.grqPopulatedFrames / r.totalFrames)),
  grqPctMin: Math.min(...runs.map((r) => r.grqPopulatedFrames / r.totalFrames)),
  maxGrq: Math.max(...runs.map((r) => r.maxGrqDots)),
  maxLocal: Math.max(...runs.map((r) => r.maxLocalDepth)),
  localFillPctMin: Math.min(...runs.map((r) => r.localFillFrames / r.totalFrames)),
  localFillPctMean: avg(runs.map((r) => r.localFillFrames / r.totalFrames)),
  multiColPctMin: Math.min(...runs.map((r) => r.multiColFrames / r.totalFrames)),
  multiColPctMean: avg(runs.map((r) => r.multiColFrames / r.totalFrames)),
  offGridMean: avg(runs.map((r) => r.offGridSamples / r.totalFrames)),
  stealMin: Math.min(...runs.map((r) => r.stealFrames)),
  avgGrq: avg(runs.map((r) => r.sumGrq / r.totalFrames)),
  avgLocalTotal: avg(runs.map((r) => r.sumLocalTotal / r.totalFrames)),
};
function avg(a) { return a.reduce((x, y) => x + y, 0) / a.length; }

// ---- assertions (on the aggregate, so no single random run can flake) -------
const failures = [];
// 1. queue fills REPEATEDLY: a local queue must be visibly full (>= 3 Gs) in a
//    real fraction of frames on every seed — not just a one-off transient from
//    the initial seed pile. This is the "only one goroutine at a time" guard.
if (agg.localFillPctMin < 0.25) failures.push(`a local run queue should repeatedly fill with multiple goroutines; the thinnest seed showed a full (>=3) queue in only ${(agg.localFillPctMin * 100).toFixed(1)}% of frames`);
// 2. backlog is SPREAD: >= 2 columns hold a backlog much of the time, so the
//    work doesn't all pile on one hot P while the others sit empty.
if (agg.multiColPctMin < 0.6) failures.push(`backlog should spread across columns; the thinnest seed had >=2 columns busy in only ${(agg.multiColPctMin * 100).toFixed(1)}% of frames (one-hot-P regression)`);
// 3. stealing is visible in every seed.
if (agg.stealMin < 10) failures.push(`work stealing should be visible; the quietest seed showed the "窃取!" flash in only ${agg.stealMin} frames`);
// 4. GRQ is a live BOUNDED backstop: often populated, but never jammed full.
if (agg.grqPctMean < 0.5) failures.push(`global queue should be visibly used; averaged only ${(agg.grqPctMean * 100).toFixed(1)}% of frames across seeds`);
if (agg.grqPctMin < 0.3) failures.push(`global queue went near-dead on a seed; populated in only ${(agg.grqPctMin * 100).toFixed(1)}% of its frames`);
if (agg.maxGrq < 3) failures.push(`global queue never held more than ${agg.maxGrq} goroutine(s); expected it to fill as a real backstop`);
if (agg.avgGrq > 9) failures.push(`global queue is saturating (avg ${agg.avgGrq.toFixed(1)} of ${14} slots); it should ebb as a bounded backstop, not jam full`);
// 4. animation: goroutines render off-grid (mid-flight), not snapped to slots.
if (agg.offGridMean < 0.5) failures.push(`goroutines should animate between slots; off-grid dots averaged only ${(agg.offGridMean * 100).toFixed(1)}% of frames`);
if (agg.frames < 1000) failures.push(`too few frames pumped (${agg.frames}); the rAF loop may have stalled`);

if (failures.length) {
  console.error(`FAIL — GMP scheduler viz (seeds ${SEEDS.join(", ")}):`);
  failures.forEach((m) => console.error("  - " + m));
  process.exit(1);
}
console.log(`PASS — GMP scheduler viz (${SEEDS.length} seeds, ${FRAMES} frames each)`);
console.log(`  local queue fills:   full (>=3) queue in ${(agg.localFillPctMean * 100).toFixed(1)}% of frames (min seed ${(agg.localFillPctMin * 100).toFixed(1)}%), peak ${agg.maxLocal}`);
console.log(`  backlog spread:      >=2 columns busy in ${(agg.multiColPctMean * 100).toFixed(1)}% of frames (min seed ${(agg.multiColPctMin * 100).toFixed(1)}%)`);
console.log(`  work stealing:       "窃取!" flash >= ${agg.stealMin} frames on every seed`);
console.log(`  global queue:        used in ${(agg.grqPctMean * 100).toFixed(1)}% of frames (min seed ${(agg.grqPctMin * 100).toFixed(1)}%), avg ${agg.avgGrq.toFixed(2)} Gs, peak ${agg.maxGrq}`);
console.log(`  animation:           off-grid dots in ${(agg.offGridMean * 100).toFixed(1)}% of frames`);
