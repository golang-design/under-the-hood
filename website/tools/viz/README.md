# Interactive figures

The book embeds interactive figures with a placeholder that GitHub, the PDF and
the EPUB ignore, and that the website mounts:

```html
<div class="viz" data-viz="init-order"></div>
```

`website/themes/book/static/viz/viz.js` is loaded on every page. It mounts the
three built-in canvas widgets (`gmp-scheduler`, `gc-tricolor`, `channel`) and,
for any other name, fetches `viz/widgets/<name>.js` on first use. Names are
lowercase letters, digits and hyphens.

## Writing a widget

Create `website/themes/book/static/viz/widgets/<name>.js`:

```js
(function () {
  "use strict";
  var V = window.BookViz, L = V.L;

  V.register("my-widget", function (host) {
    var p = V.panel(host, { title: L("中文标题", "English title") });
    var root = V.svg("svg", { viewBox: "0 0 720 240", role: "img",
                              "aria-label": L("……", "…") }, p.stage);
    V.svg("rect", { x: 20, y: 20, width: 120, height: 40, rx: 6,
                    style: "fill:var(--viz-c1);fill-opacity:.15;stroke:var(--viz-c1)" }, root);
    V.svg("text", { x: 80, y: 45, "text-anchor": "middle", text: "g0" }, root);
    V.button(p.bar, L("下一步", "Step"), function () { p.note.textContent = L("……", "…"); });
  });
})();
```

API (`window.BookViz`):

| Name | Purpose |
|---|---|
| `register(name, fn)` | Register a widget; pending hosts mount immediately. |
| `L(zh, en)` | Pick the label for the page language (`lang` is `"zh"` or `"en"`). |
| `panel(host, {title})` | DOM/SVG scaffold. Returns `{wrap, stage, bar, note}`; `note` is an `aria-live` line for narrating the current step. |
| `scaffold(host, {title, width, height})` | Canvas scaffold (hi-dpi, resizes). Returns `{canvas, ctx, bar, W, H}`. |
| `driver(s, step, draw)` | Fixed-step animation loop for canvas widgets; stops when the host leaves the DOM. |
| `button(bar, label, onClick)` | Control button. Add class `is-on` for a toggled state; `disabled` works. |
| `slider(bar, label, min, max, value, onInput)` | Range control. |
| `select(bar, label, [{value, label}], value, onChange)` | Drop-down control. |
| `el(tag, attrs, parent)`, `svg(tag, attrs, parent)` | Create HTML / SVG nodes. `text` sets text content, `on: {click: fn}` adds listeners, every other key is an attribute. |
| `col()` | Resolved colours for canvas drawing (follows light/dark). |

## Colour

Prefer SVG/HTML over canvas for diagrams: text stays sharp and selectable, and
colours can reference CSS variables so dark mode needs no repaint.

| Variable | Meaning |
|---|---|
| `--viz-c1` | active / current |
| `--viz-c2` | blocked / needs attention |
| `--viz-c3` | done / ok |
| `--viz-c4` | secondary category |
| `--viz-ink`, `--viz-muted` | text |
| `--viz-line`, `--viz-fill` | strokes and box fills |

The four slots were checked with the dataviz palette validator on both the
light (`#f7f4ee`) and dark (`#1b1914`) surfaces. Use them by meaning, never
cycle them as a rainbow, and always pair a colour with a text label. Text uses
the ink variables, not a series colour. Tint large fills with `fill-opacity`
(about 0.12 to 0.2) and keep the full colour for the stroke.

## Rules

- One figure, one mechanism. The default state should already show the point.
- Let the reader act: step, replay, reset, or change a parameter. Narrate each
  step in `note` with one plain sentence.
- The surrounding prose must make sense without the figure.
- Chinese and English labels for everything (`L`).
- No dependencies, no network requests, no timers left running after the host
  is removed.
- Fit 720 px wide; stay legible at 360 px (use `viewBox` and let SVG scale).

## Checking a widget

Open `website/tools/viz/harness.html?w=<name>` in a browser, or take
screenshots with headless Chrome:

```sh
CH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
"$CH" --headless=new --disable-gpu --hide-scrollbars --allow-file-access-from-files \
  --user-data-dir=/tmp/viz-profile --virtual-time-budget=3000 --window-size=820,640 \
  --screenshot=/tmp/w.png "file://$PWD/website/tools/viz/harness.html?w=<name>&lang=en&theme=dark"
```

Look at both languages and both themes before calling a widget done.
