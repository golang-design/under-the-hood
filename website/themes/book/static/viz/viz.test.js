/*
 * Regression test for the GMP scheduler widget in viz.js.
 *
 * It loads the REAL viz.js against a stubbed DOM + a recording 2D canvas
 * context, mounts the `gmp-scheduler` widget, and pumps animation frames by
 * hand. Two properties are asserted — the two the widget used to get wrong:
 *
 *   1. The global run queue (GRQ) stays populated over time, not just on the
 *      first frame. (Previously it only filled on a 6-deep local overflow that
 *      work-stealing prevented from ever happening, so the GRQ read as empty.)
 *   2. Goroutines render at off-grid positions between their slots, i.e. they
 *      actually animate from queue to queue / onto their M, instead of
 *      teleporting. (Previously queued Gs snapped straight into slot centres.)
 *
 * Run: node website/themes/book/static/viz/viz.test.js
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// ---- geometry mirrored from viz.js (kept in sync by the slot-center checks) --
const W = 760;
const NP = 3, QCAP = 6, GRQ_MAX = 14;
const GRQ_Y = 56, GRQ_X0 = 150, GRQ_SLOT = 26;
function pGeoX(i) { const pw = 200, gap = 24, total = NP * pw + (NP - 1) * gap; const x0 = (W - total) / 2; return x0 + i * (pw + gap); }
const slotCenters = [];
for (let i = 0; i < GRQ_MAX; i++) slotCenters.push(GRQ_X0 + i * GRQ_SLOT);
for (let p = 0; p < NP; p++) { const gx = pGeoX(p);
  for (let k = 0; k < QCAP; k++) slotCenters.push(gx + 24 + k * 28); // local slots
  slotCenters.push(gx + 200 - 40);                                   // runPos (M)
  slotCenters.push(gx + 30);                                         // headPos (spawn)
}
const onGrid = (x) => slotCenters.some((c) => Math.abs(c - x) < 0.6);

// ---- recording canvas + DOM stubs -------------------------------------------
// We log every arc() as a (x, y, r) sample tagged with the current frame index.
let frameArcs = [];          // arcs drawn in the frame currently being rendered
function makeCtx() {
  const ctx = {
    fillStyle: "", strokeStyle: "", lineWidth: 1, font: "", textAlign: "", textBaseline: "", globalAlpha: 1,
    arc(x, y, r) { frameArcs.push({ x, y, r }); },
    beginPath() {}, moveTo() {}, lineTo() {}, arcTo() {}, closePath() {},
    fill() {}, stroke() {}, fillText() {}, strokeText() {}, clearRect() {},
    setTransform() {}, save() {}, restore() {},
  };
  return ctx;
}
function makeEl() {
  const el = {
    className: "", type: "", textContent: "", innerHTML: "", style: {}, width: 0, height: 0,
    clientWidth: W, isConnected: true,
    classList: { add() {}, remove() {}, contains() { return false; } },
    children: [],
    appendChild(c) { this.children.push(c); return c; },
    addEventListener() {}, removeEventListener() {},
    getContext() { return this._ctx || (this._ctx = makeCtx()); },
    setAttribute() {}, getAttribute(n) { return n === "data-viz" ? "gmp-scheduler" : null; },
  };
  return el;
}

const host = makeEl();
let rafQueue = [];
const sandbox = {
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
  console,
};
sandbox.window.requestAnimationFrame = sandbox.requestAnimationFrame;
sandbox.globalThis = sandbox;

const code = fs.readFileSync(path.join(__dirname, "viz.js"), "utf8");
vm.createContext(sandbox);
vm.runInContext(code, sandbox); // mounts the widget and queues the first frame

// ---- pump frames ------------------------------------------------------------
// The driver computes dt from successive timestamps; feed it a steady 60fps.
let grqPopulatedFrames = 0, offGridSamples = 0, totalFrames = 0, maxGrqDots = 0;
const FRAMES = 1500; // ~25s of simulated time at speed 1
for (let f = 1; f <= FRAMES; f++) {
  const due = rafQueue; rafQueue = [];
  frameArcs = [];
  due.forEach((cb) => cb(f * (1000 / 60))); // run this frame's draw, capture arcs
  // GRQ dots: radius-10 arcs sitting in the global-queue band, right of its label.
  const grqDots = frameArcs.filter((a) => Math.abs(a.y - GRQ_Y) < 3 && a.r >= 9 && a.r <= 11 && a.x >= GRQ_X0 - 2);
  if (f > 60) { // let the seeded layout settle before counting
    totalFrames++;
    if (grqDots.length > 0) grqPopulatedFrames++;
    maxGrqDots = Math.max(maxGrqDots, grqDots.length);
    // off-grid goroutine dots (r 10/11) prove interpolation between slots.
    if (frameArcs.some((a) => a.r >= 10 && a.r <= 11 && !onGrid(a.x))) offGridSamples++;
  }
}

// ---- assertions -------------------------------------------------------------
const failures = [];
const grqPct = grqPopulatedFrames / totalFrames;
const offGridPct = offGridSamples / totalFrames;
if (grqPct < 0.8) failures.push(`global queue should stay populated; only ${(grqPct * 100).toFixed(1)}% of frames had GRQ goroutines (max ${maxGrqDots} at once)`);
if (maxGrqDots < 2) failures.push(`global queue never held more than ${maxGrqDots} goroutine(s); expected it to fill as a real backstop`);
if (offGridPct < 0.5) failures.push(`goroutines should animate between slots; only ${(offGridPct * 100).toFixed(1)}% of frames showed off-grid (mid-flight) dots`);
if (totalFrames < 1000) failures.push(`too few frames pumped (${totalFrames}); the rAF loop may have stalled`);

if (failures.length) {
  console.error("FAIL — GMP scheduler viz:");
  failures.forEach((m) => console.error("  - " + m));
  process.exit(1);
}
console.log(`PASS — GMP scheduler viz`);
console.log(`  GRQ populated in ${(grqPct * 100).toFixed(1)}% of frames (max ${maxGrqDots} Gs at once)`);
console.log(`  off-grid (animating) dots in ${(offGridPct * 100).toFixed(1)}% of frames`);
