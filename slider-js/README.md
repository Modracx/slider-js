# @modracx/slider-js

Content carousel for the web. Loop, autoplay, swipe, arrows, dots, several
slides per view, fade, RTL, and a keyboard and screen-reader story that is not
an afterthought. Zero dependencies, no build step.

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

Every direct child of the container becomes one slide. No wrapper markup, no
stylesheet to copy in.

---

## Contents

- [Options](#options)
- [The controller](#the-controller)
- [Events](#events)
- [How positions are decided](#how-positions-are-decided)
- [Breakpoints](#breakpoints)
- [Autoplay](#autoplay)
- [Declarative setup](#declarative-setup)
- [Right-to-left](#right-to-left)
- [jQuery](#jquery)
- [Granular API](#granular-api)
- [Recipes](#recipes)
- [Accessibility](#accessibility)
- [Browser support](#browser-support)

---

## Options

All options go in one object; `create()` splits them across the three layers.

### Engine

| Option | Type | Default | Notes |
| --- | --- | --- | --- |
| `slidesPerView` | number \| `"auto"` | `1` | Fractional is fine — `2.5` leaves a half-slide peeking. `"auto"` uses each slide's natural width. |
| `slidesPerGroup` | number | `1` | Slides advanced per `next()` / `prev()`. |
| `spaceBetween` | number | `0` | Px between slides. |
| `initialSlide` | number | `0` | |
| `loop` | boolean | `false` | Wraps by cloning slides at both edges. |
| `speed` | number | `350` | Transition duration in ms. |
| `easing` | string | `cubic-bezier(0.4, 0, 0.2, 1)` | Any CSS timing function. |
| `effect` | `"slide"` \| `"fade"` | `"slide"` | Fade stacks the slides and cross-fades. |
| `breakpoints` | object \| `null` | `null` | Layout overrides per minimum viewport width — see [Breakpoints](#breakpoints). |
| `observeResize` | boolean | `true` | `ResizeObserver` on the container and each slide, coalesced per frame. |
| `respectReducedMotion` | boolean | `true` | Jump instead of animating. The carousel still works. |

### Navigation

| Option | Type | Default | Notes |
| --- | --- | --- | --- |
| `arrows` | boolean | `true` | Real `<button>`s, disabled at the ends when not looping. |
| `dots` | boolean | `true` | One per **page**, not per slide — see `slidesPerGroup`. |
| `arrowLabels` | object | Previous / Next slide | Accessible names. |
| `dotLabel` | function | `(p, n) => …` | Builds each dot's accessible name. |
| `announce` | boolean | `true` | Polite live region naming the active slide. |

### Interaction

| Option | Type | Default | Notes |
| --- | --- | --- | --- |
| `draggable` | boolean | `true` | Mouse, touch and pen. Ignored for `effect: "fade"`. |
| `dragThreshold` | number | `5` | Px before a drag counts as a swipe rather than a click. |
| `dragRatio` | number | `0.25` | Fraction of a slide that must be dragged to advance. |
| `flickVelocity` | number | `400` | Px/second above which a release always advances. |
| `keyboard` | boolean | `true` | Arrows, Home and End. Adds a `tabindex`. |
| `autoplay` | number | `0` | Ms between advances. `0` disables. |
| `autoplayEndBehavior` | `"stop"` \| `"rewind"` | `"stop"` | What happens at the last slide when `loop` is off. |
| `autoplayStopOnInteraction` | boolean | `true` | First real interaction ends autoplay permanently. |
| `autoplayResumeDelay` | number | `0` | Ms before autoplay resumes after an interaction. Only read when the option above is `false`. |
| `showPauseButton` | boolean | `false` | An accessible play/pause button. **Turn this on if you use autoplay** — see [Accessibility](#accessibility). |
| `pauseButtonPosition` | string | `"bottom-right"` | Any of the four corners. |
| `pauseButtonLabels` | object | Pause / Resume autoplay | Accessible names. |
| `showProgress` | boolean | `false` | A bar counting down to the next advance. |
| `progressHeight` | number | `3` | Px. |
| `progressColor` | string | white-ish | Any CSS colour. |
| `pauseOnHover` | boolean | `true` | Autoplay only. |
| `pauseOnFocus` | boolean | `true` | Autoplay only. |
| `pauseOnHidden` | boolean | `true` | Tab hidden or carousel offscreen. Autoplay only. |

The three `pauseOn*` options govern **autoplay**, not the carousel — a slider
without autoplay has nothing to pause, so they do nothing there.

---

## The controller

`create()` returns a controller. `Slider.get(container)` fetches it later, or
`null` if there is no slider.

```js
const s = Slider.create(el, { loop: true });

s.next();
s.prev();
s.goTo(3);                  // takes the shortest way round when looping
s.goToPage(1);
s.goTo(0, { instant: true });

s.addSlide(node);           // insert ahead of the clones + re-measure
s.removeSlide(node);
s.update();                 // re-measure after your own DOM edits

s.destroy();                // restores the original DOM exactly
```

Read-only:

| Property | Type | Meaning |
| --- | --- | --- |
| `index` | number | Active slide, always within `[0, length)`. |
| `length` | number | Real slides, excluding clones. |
| `rawPosition` | number | Position before wrapping; sits outside the range mid-loop. |
| `lastIndex` | number | Highest reachable index — below `length - 1` when several slides fit at once. |
| `canGoPrev` / `canGoNext` | boolean | Always true when looping. |
| `pages` / `page` | number | Dot pagination. |
| `slides` | Element[] | The real slides, in order. |
| `autoplayRunning` | boolean | Defined by the control layer. |
| `reducedMotion` | boolean | Are transitions being skipped. |

---

## Events

```js
const off = s.on("change", ({ index, previous }) => {
  console.log(previous, "→", index);
});
off(); // unsubscribe
```

| Event | Fires when |
| --- | --- |
| `change` | The active index changed. |
| `update` | A re-measure finished — after resize, `update()`, or slide changes. |
| `transitionEnd` | A move settled, including the silent loop hop. |
| `reducedMotion` | The OS setting changed. |
| `pause` / `resume` | A named pause reason was added or cleared. |

Subscriptions registered with `on()` are dropped by `destroy()`.

---

## How positions are decided

Slide positions are **measured**, never computed from the options. After
layout, the engine records each slide's offset from the track's start and moves
the track with a single `translate3d`. That is what lets fractional
`slidesPerView`, `"auto"` widths and slides with their own margins all work
through the same code path.

Two consequences worth knowing:

**The end is flush, not overscrolled.** Without `loop`, the final position
aligns the track's end with the container's end rather than putting the last
slide at the start edge. So with 6 slides at 3 per view, `lastIndex` is `3`,
not `5` — positions past that would render identically. Use `lastIndex`, not
`length - 1`, when you want "go to the end".

**Looping clones, then hops.** With `loop`, `slidesPerGroup + ceil(slidesPerView)`
slides are cloned onto each end. Moving past an edge scrolls into the clones,
and once the transition settles the engine jumps back to the real slide with
transitions off. `index` never leaves `[0, length)`; `rawPosition` exposes the
un-wrapped value if you need it.

---

## Breakpoints

Layout options can vary by viewport width, mobile-first — the base options
apply below the smallest breakpoint, and each breakpoint at or below the
current width folds over the ones before it:

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

At 1200px that resolves to 4 per view with a 24px gap; at 800px, 2 per view
with 16px; below 640px, the base values. Narrowing back returns to exactly the
base — overrides are re-resolved from scratch on every measure, never
accumulated.

Only **`slidesPerView`, `slidesPerGroup`, `spaceBetween` and `speed`** may
vary. Structural options (`loop`, `effect`) stay fixed for the life of the
slider, because changing them means rebuilding the DOM rather than re-laying it
out. Create two sliders if you need that.

`activeBreakpoint` reports the current one (`null` below them all), and a
`breakpoint` event fires when it changes:

```js
s.on("breakpoint", ({ width }) => console.log("now at", width));
```

Breakpoints key off `window.innerWidth`, so the slider also listens for window
resizes — a viewport can cross a threshold without the container changing size.

Through data attributes, pass them as JSON:

```html
<div data-slider data-slider-breakpoints='{"640":{"slidesPerView":2}}'>
```

---

## Autoplay

```js
Slider.create(el, {
  autoplay: 5000,
  showPauseButton: true,   // do this
  showProgress: true,
});
```

Autoplay holds — rather than restarts — while the pointer is over the
carousel, while something inside has focus, and while the tab is hidden or the
carousel is offscreen. The remaining time carries over, so hovering for a
moment does not hand you a fresh full interval.

**It waits for the transition.** If `autoplay` is shorter than `speed`, an
advance that comes due mid-transition is deferred until the move settles rather
than retargeting a slide nobody has seen arrive.

**It ends cleanly.** On a non-looping carousel, reaching the last slide
releases the timer (`autoplayEndBehavior: "stop"`) or returns to the first
(`"rewind"`). It never sits there ticking against a `next()` that cannot move.

**Interaction stops it** — permanently by default, which is the polite
behaviour: someone who took control should keep it. For a pause-then-resume
instead:

```js
Slider.create(el, {
  autoplay: 5000,
  autoplayStopOnInteraction: false,
  autoplayResumeDelay: 8000,
});
```

The play/pause button is exempt from that rule — it *is* the autoplay control,
so pressing play after a permanent stop starts it again.

---

## Declarative setup

The standalone `vanilla/` and `jquery/` builds call `autoInit(document)` on
`DOMContentLoaded`, so a carousel can be built with no script of your own —
which is what makes this usable from a CMS or page builder:

```html
<div data-slider data-slider-slides-per-view="3" data-slider-loop>
  <div>One</div>
  <div>Two</div>
  <div>Three</div>
</div>
```

Attribute names are the option names in kebab-case. Values are coerced: `"3"`
becomes a number, `"true"` / `"false"` become booleans, a valueless attribute
reads as `true`, and `"auto"` stays a string. `data-slider` itself may hold a
JSON object which the individual attributes then override.

The npm package does **not** auto-run — a module with side effects on import is
a poor citizen in a bundle. Call `Slider.autoInit()` yourself. It skips
already-initialised elements and returns the controllers it created.

---

## Right-to-left

RTL is detected from the computed `direction` of the container, so `dir="rtl"`
on the element or any ancestor is enough. Arrows swap sides and swap glyphs,
swipe direction inverts, and the transform runs the other way. `next()` always
means "the next slide in reading order".

---

## jQuery

jQuery is an optional peer dependency. The plugin entry registers `$.fn.Slider`
against a global jQuery when imported:

```js
import "@modracx/slider-js/jquery";

$(".carousel").Slider("create", { loop: true, autoplay: 4000 });
```

With a bundled jQuery that is not on `window`, register it yourself:

```js
import registerSliderPlugin from "@modracx/slider-js/jquery";
import $ from "jquery";

registerSliderPlugin($);
```

Methods that act are chainable across the whole set:

```js
$(".carousel").Slider("next");
$(".carousel").Slider("prev");
$(".carousel").Slider("goTo", 2);
$(".carousel").Slider("goToPage", 1);
$(".carousel").Slider("update");
$(".carousel").Slider("destroy");   // "clear" is a synonym
```

Methods that read return a value from the **first** element in the set:

```js
$(".carousel").Slider("get");     // controller, or null
$(".carousel").Slider("index");   // number
$(".carousel").Slider("length");  // number
$(".carousel").Slider("page");    // number
```

An action on an element with no slider throws rather than failing quietly.

---

## Granular API

`create()` is a convenience over three independent layers. Use them directly
when you want, say, arrows but no swipe or autoplay.

```js
import { createSlider, attachNavigation, attachControls } from "@modracx/slider-js";

const s = createSlider(el, { slidesPerView: 3, spaceBetween: 16 });
attachNavigation(s, { dots: false });
attachControls(s, { autoplay: 5000, keyboard: true, draggable: false });
```

Attach navigation **before** controls: the arrows and dots read
`autoplayRunning`, which the control layer defines on the controller.

Both return their own cleanup and register it with the controller, so
`destroy()` still tears everything down.

---

## Recipes

**Hero slideshow**

```js
Slider.create(el, { loop: true, autoplay: 5000, effect: "fade" });
```

**Product row with a peek**

```js
Slider.create(el, { slidesPerView: 3.5, spaceBetween: 16, dots: false });
```

**Logo grid, paged**

```js
Slider.create(el, { slidesPerView: 5, slidesPerGroup: 5, spaceBetween: 24 });
```

**Thumbnails driving a main stage**

```js
const main = Slider.create(stage, { arrows: false });
const thumbs = Slider.create(strip, { slidesPerView: 6, dots: false });

thumbs.slides.forEach((t, i) => (t.onclick = () => main.goTo(i)));
main.on("change", ({ index }) => thumbs.goTo(index));
```

**Pause autoplay while a modal is open**

```js
openModal(() => s.pause("modal"), () => s.resume("modal"));
```

---

## Accessibility

- **Roles.** The container gets `role="region"` and
  `aria-roledescription="carousel"`; each slide gets `role="group"`,
  `aria-roledescription="slide"` and an `aria-label` of `"3 of 8"`.
- **Off-screen slides are hidden.** Slides scrolled outside the viewport are
  marked `aria-hidden` and `inert`, so a screen reader does not walk past the
  visible edge into content the user cannot see. This is re-evaluated on every
  move.
- **Clones are hidden too**, so looping never duplicates content for assistive
  tech or the tab order.
- **Arrows and dots are real buttons** with accessible names, `aria-selected`
  on the active dot, and roving `tabindex` so the dot strip is one tab stop.
- **Keyboard**: arrows move (reversed under RTL), Home and End jump to the
  ends. Keys are ignored when the event came from a link or form control inside
  a slide, so nothing is hijacked.
- **Live region** announces the active slide — but stays silent while autoplay
  is driving, since an unprompted announcement every few seconds is hostile.
- **Autoplay needs a pause control.** WCAG 2.2.2 requires a way to pause
  anything that auto-advances for more than five seconds. Hovering does not
  count — it is unreachable by keyboard, touch and screen reader alike. Pass
  `showPauseButton: true` and you get a real `<button>` with an `aria-label`
  and `aria-pressed` that track the play state. It reports the *explicit* stop,
  not the aggregate, so a carousel resting because it is hovered still reads as
  playing and the control does not flip under the user's cursor.
- **Reduced motion** turns transitions off rather than turning the carousel
  off. Autoplay keeps advancing, it just does not animate. If you would rather
  it not move at all, pass `autoplay: 0` when
  `Slider.prefersReducedMotion()` is true.

---

## Browser support

Chrome / Edge 88+, Firefox 78+, Safari 14+.

| Feature | If missing |
| --- | --- |
| `ResizeObserver` | Auto re-measure is skipped; call `update()` yourself. |
| `IntersectionObserver` | Offscreen autoplay pausing is skipped; tab-visibility pausing still works. |
| `matchMedia` | Reduced motion is treated as "not requested". |
| `inert` | Falls back to `tabindex="-1"` on focusable descendants. |

The package ships as ES modules with no build step. For a `<script>` tag, use
the standalone builds in `vanilla/` or `jquery/` in the repository root.

---

## License

MIT © Kenneth D'silva (Modracx)

---

## Developer

Built by **Kenneth D'silva** — [modracx.com](https://modracx.com/)
