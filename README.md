# slider-js

Content carousel for the web — loop, autoplay, swipe, arrows, dots, several
slides per view, fade, RTL, and a keyboard and screen-reader story that is not
an afterthought. Zero dependencies.

Three ways to use it, one engine behind all three.

---

## Repository layout

| Path | What it is |
| --- | --- |
| `slider-js/` | The npm package — ES modules, TypeScript types, demos. The source of truth. |
| `vanilla/` | Standalone `<script>` build. Attaches `window.Slider`. |
| `jquery/` | Standalone `<script>` build. Registers `$.fn.Slider`. |
| `build.mjs` | Generates both standalone builds from `slider-js/src`. |

The two standalone builds are **generated** — edit `slider-js/src` and run
`node build.mjs`, never edit `vanilla/slider-vanilla.js` or
`jquery/slider-jquery.js` by hand.

---

## Install

### npm

```bash
npm install @modracx/slider-js
```

```js
import Slider from "@modracx/slider-js";

Slider.create(document.querySelector("#carousel"), {
  slidesPerView: 3,
  spaceBetween: 16,
  loop: true,
  autoplay: 4000,
});
```

### Vanilla, script tag

```html
<div id="carousel">
  <div>One</div>
  <div>Two</div>
  <div>Three</div>
</div>

<script src="vanilla/slider-vanilla.js"></script>
<script>
  Slider.create(document.getElementById("carousel"), { loop: true });
</script>
```

### No JavaScript at all

Both standalone builds run `autoInit(document)` on `DOMContentLoaded`, so a
carousel can be declared entirely in markup:

```html
<div data-slider data-slider-slides-per-view="3" data-slider-loop>
  <div>One</div>
  <div>Two</div>
  <div>Three</div>
</div>
<script src="vanilla/slider-vanilla.js"></script>
```

Attribute names are option names in kebab-case; values are coerced, and a
valueless attribute reads as `true`. `data-slider` may also hold JSON:
`data-slider='{"speed":500}'`.

### jQuery, script tag

```html
<script src="https://code.jquery.com/jquery-3.7.1.min.js"></script>
<script src="jquery/slider-jquery.js"></script>
<script>
  $("#carousel").Slider("create", { slidesPerView: 3, loop: true });
</script>
```

Every direct child of the container becomes one slide. There is no wrapper
markup to add and no stylesheet to copy in.

---

## Options

```js
Slider.create(el, {
  // engine
  slidesPerView: 1,           // number, fractional, or "auto"
  slidesPerGroup: 1,          // slides advanced per step
  spaceBetween: 0,            // px between slides
  initialSlide: 0,
  loop: false,
  speed: 350,                 // transition ms
  easing: "cubic-bezier(0.4, 0, 0.2, 1)",
  effect: "slide",            // or "fade"
  breakpoints: null,          // { 640: { slidesPerView: 2 }, 1024: {...} }
  observeResize: true,
  respectReducedMotion: true, // jump instead of animating

  // navigation
  arrows: true,
  dots: true,                 // one per page, not per slide
  announce: true,             // polite live region

  // interaction
  draggable: true,
  dragThreshold: 5,
  dragRatio: 0.25,            // fraction of a slide to advance
  flickVelocity: 400,         // px/s that always advances
  keyboard: true,             // arrows, Home, End
  autoplay: 0,                // ms, 0 disables
  autoplayEndBehavior: "stop",// or "rewind", when loop is off
  autoplayStopOnInteraction: true,
  autoplayResumeDelay: 0,     // ms, when the option above is false
  showPauseButton: false,     // turn this ON if you use autoplay
  showProgress: false,        // countdown bar to the next slide
  pauseOnHover: true,         // autoplay only
  pauseOnFocus: true,         // autoplay only
  pauseOnHidden: true,        // autoplay only
});
```

---

## Controlling it

`create()` returns a controller; `Slider.get(el)` fetches it later.

```js
const s = Slider.create(el);

s.next();
s.prev();
s.goTo(3);                 // shortest way round when looping
s.goToPage(1);
s.goTo(0, { instant: true });
s.addSlide(node);
s.removeSlide(node);
s.update();                // re-measure after your own DOM edits
s.destroy();               // restores the original DOM exactly

s.index;                   // active slide
s.length;                  // real slides, excluding clones
s.lastIndex;               // highest reachable index — use this for "the end"
s.pages; s.page;
s.canGoPrev; s.canGoNext;

s.on("change", ({ index, previous }) => { /* ... */ });
```

The jQuery surface mirrors this:

```js
$(".carousel").Slider("create", opts);
$(".carousel").Slider("next");
$(".carousel").Slider("goTo", 2);
$(".carousel").Slider("destroy");

$(".carousel").Slider("get");    // controller from the first element
$(".carousel").Slider("index");  // number
```

Full API, events, recipes and the accessibility notes are in
[`slider-js/README.md`](slider-js/README.md).

---

## Responsive breakpoints

Layout options vary by viewport width, mobile-first. The base options apply
below the smallest breakpoint; each breakpoint at or below the current width
folds over the ones before it.

```js
Slider.create(el, {
  slidesPerView: 1,
  spaceBetween: 8,
  breakpoints: {
    640: { slidesPerView: 2, spaceBetween: 16 },
    1024: { slidesPerView: 4, slidesPerGroup: 4, spaceBetween: 24 },
  },
});
```

Only `slidesPerView`, `slidesPerGroup`, `spaceBetween` and `speed` may vary —
structural options like `loop` and `effect` stay fixed, since changing them
means rebuilding the DOM rather than re-laying it out. Narrowing back returns
to exactly the base values; overrides are re-resolved each time, never
accumulated.

---

## Autoplay

```js
Slider.create(el, { autoplay: 5000, showPauseButton: true, showProgress: true });
```

It **holds** rather than restarts on hover, focus, hidden tab and offscreen —
the remaining time carries over. It **waits for the transition** if the
interval is shorter than `speed`. It **ends cleanly** on a non-looping
carousel, releasing the timer at the last slide (or rewinding, with
`autoplayEndBehavior: "rewind"`) instead of ticking against a `next()` that
cannot move.

Turn on `showPauseButton` whenever you use autoplay — see Accessibility below.

---

## Two things that surprise people

**`lastIndex` is not `length - 1`.** Without `loop`, the final position aligns
the track's end with the container's end rather than putting the last slide at
the start edge. With 6 slides at 3 per view, `lastIndex` is `3` — positions
past it would render identically. Use `lastIndex` for "go to the end".

**Dots count pages, not slides.** With `slidesPerGroup: 2` and 6 slides you get
3 dots. That is what `pages` and `page` report.

---

## Try it

The test runners exercise every feature and expose a live control panel.
Serve the directory over HTTP — the ES module demos will not run from
`file://`.

```bash
python3 -m http.server 8000
```

- `vanilla/index-vanilla-js-test.html` — standalone build
- `jquery/index-jquery-test.html` — standalone build
- `slider-js/demo/vanilla.html` — ES modules, straight from `src/`
- `slider-js/demo/jquery.html` — ES modules, plugin entry point

---

## Accessibility

The container is a `role="region"` with `aria-roledescription="carousel"`; each
slide is a labelled `role="group"`. Slides scrolled out of view — and every
loop clone — are `aria-hidden` and `inert`, so a screen reader never walks past
the visible edge or hears content twice. Arrows and dots are real buttons with
accessible names and `aria-selected`. Arrow keys, Home and End work once the
carousel has focus, reversed under RTL.

A polite live region names the active slide, but stays silent while autoplay is
driving, since an unprompted announcement every few seconds is hostile.

**Autoplay needs a pause control.** WCAG 2.2.2 requires a way to pause anything
auto-advancing for more than five seconds, and hovering does not count — it is
unreachable by keyboard, touch and screen reader alike. `showPauseButton: true`
gives you a real `<button>` with `aria-label` and `aria-pressed` tracking the
play state.

Reduced motion turns transitions off rather than turning the carousel off — it
stays fully navigable, it just stops animating.

---

## Building

```bash
node build.mjs
```

Reads `slider-js/src`, strips the module syntax, concatenates the modules in
dependency order and wraps them for each target. No dependencies, no toolchain.

---

## Browser support

Chrome / Edge 88+, Firefox 78+, Safari 14+. Missing `ResizeObserver`,
`IntersectionObserver`, `matchMedia` or `inert` each degrade to a smaller
feature set rather than breaking the carousel.

---

## License

MIT © Kenneth D'silva (Modracx)

---

## Developer

Built by **Kenneth D'silva** — [modracx.com](https://modracx.com/)
