/*!
 * slider-js — the carousel engine
 * Kenneth D'silva (Modracx), Copyright (c) 2026
 * Licensed under the MIT License – https://opensource.org/licenses/MIT
 */
import {
  SLIDER_KEY,
  clamp,
  createElement,
  createEmitter,
  isRTL,
  prefersReducedMotion,
  teardown,
  watchReducedMotion,
  wrapIndex,
} from "./core.js";

export const sliderDefaults = {
  /** Slides visible at once. A number (fractional is fine) or "auto". */
  slidesPerView: 1,
  /** Slides advanced by next() / prev(). */
  slidesPerGroup: 1,
  /** Px between slides. */
  spaceBetween: 0,
  /** Slide index to open on. */
  initialSlide: 0,
  /** Wrap around past the ends by cloning slides at both edges. */
  loop: false,
  /** Transition duration in ms. */
  speed: 350,
  /** CSS timing function for the transition. */
  easing: "cubic-bezier(0.4, 0, 0.2, 1)",
  /** "slide" moves a track; "fade" cross-fades stacked slides. */
  effect: "slide",
  /**
   * Layout overrides per minimum viewport width, mobile-first:
   *
   *   breakpoints: { 640: { slidesPerView: 2 }, 1024: { slidesPerView: 4 } }
   *
   * Only the keys in RESPONSIVE_KEYS can vary; anything structural (loop,
   * effect) stays fixed for the life of the slider.
   */
  breakpoints: null,
  /** Re-measure automatically when the container or its slides resize. */
  observeResize: true,
  /**
   * Under prefers-reduced-motion, jump between slides instead of animating.
   * The carousel still works; it just stops sliding.
   */
  respectReducedMotion: true,
};

const EFFECTS = ["slide", "fade"];

/**
 * Options a breakpoint may override. Deliberately narrow: these are the ones
 * measure() re-reads, so changing them is just a re-layout. Letting `loop` or
 * `effect` vary would mean rebuilding the DOM on a resize.
 */
const RESPONSIVE_KEYS = [
  "slidesPerView",
  "slidesPerGroup",
  "spaceBetween",
  "speed",
];

/** transitionend can be dropped; this backstop keeps the state machine honest. */
const TRANSITION_GRACE_MS = 60;

/**
 * Turn `container`'s children into a carousel.
 * Any slider already on that container is torn down first.
 * Returns a controller; it is also reachable via `getSlider(container)`.
 */
export function createSlider(container, options = {}) {
  if (!container) throw new TypeError("createSlider: container is required");
  clearSlider(container);

  const settings = { ...sliderDefaults, ...options };
  if (EFFECTS.indexOf(settings.effect) === -1) {
    throw new TypeError(
      `createSlider: effect must be one of ${EFFECTS.join(", ")}, got "${settings.effect}"`
    );
  }
  if (settings.slidesPerView !== "auto" && !(settings.slidesPerView > 0)) {
    throw new TypeError(
      'createSlider: slidesPerView must be a positive number or "auto"'
    );
  }
  if (!(settings.slidesPerGroup >= 1)) {
    throw new TypeError("createSlider: slidesPerGroup must be at least 1");
  }

  // Snapshot the un-overridden layout values: every breakpoint resolution
  // starts from these, so widening then narrowing the window comes back to
  // exactly where it began rather than accumulating overrides.
  const responsiveBase = {};
  RESPONSIVE_KEYS.forEach((k) => (responsiveBase[k] = settings[k]));
  const breakpointWidths = settings.breakpoints
    ? Object.keys(settings.breakpoints)
        .map(Number)
        .filter((n) => !Number.isNaN(n))
        .sort((a, b) => a - b)
    : [];
  if (settings.breakpoints && !breakpointWidths.length) {
    throw new TypeError(
      "createSlider: breakpoints keys must be numeric minimum widths"
    );
  }
  let activeBreakpoint = null;

  const emitter = createEmitter();
  const containerStyle = container.getAttribute("style");
  let slides = Array.prototype.slice.call(container.children);
  const savedStyles = new Map();
  slides.forEach((el) => savedStyles.set(el, el.getAttribute("style")));

  Object.assign(container.style, {
    overflow: "hidden",
    position: container.style.position || "relative",
  });

  const track = createElement("div", {
    display: "flex",
    flexDirection: "row",
    // Fade stacks the slides instead of laying them out in a row.
    ...(settings.effect === "fade"
      ? { position: "relative", display: "block" }
      : { flexWrap: "nowrap" }),
  });
  track.dataset.sliderTrack = "";
  container.appendChild(track);
  slides.forEach((el) => track.appendChild(el));

  /** Replaced with a real implementation when a ResizeObserver is in use. */
  let observeItem = function () {};

  let count = slides.length; // real slides
  let clonesPerSide = 0;
  let flow = []; // distance of each track child from the first, along the flow
  let maxScroll = 0;
  let maxPos = 0;
  let pos = 0; // logical position; may sit outside [0, count) mid-loop
  let rtl = false;
  let dragPx = 0; // live finger offset, outside the committed position
  let transitionTimer = null;
  let reduced = false;

  const pauseReasons = new Set(); // used by the autoplay layer

  /* ------------------------------------------------------------------ *
   * Geometry
   * ------------------------------------------------------------------ */

  function viewportSize() {
    return container.clientWidth;
  }

  function renderSign() {
    return rtl ? 1 : -1;
  }

  function isFade() {
    return settings.effect === "fade";
  }

  function trackChildren() {
    return Array.prototype.slice.call(track.children);
  }

  function removeClones() {
    trackChildren().forEach((el) => {
      if (el.hasAttribute("data-slider-clone")) el.remove();
    });
  }

  function makeClone(source, label) {
    const copy = source.cloneNode(true);
    copy.dataset.sliderClone = "";
    // Duplicated slides must not be announced or tabbed into twice.
    copy.setAttribute("aria-hidden", "true");
    copy.removeAttribute("id");
    if ("inert" in copy) {
      copy.inert = true;
    } else {
      Array.prototype.slice
        .call(copy.querySelectorAll("a, button, input, select, textarea"))
        .forEach((f) => f.setAttribute("tabindex", "-1"));
    }
    if (label) copy.dataset.sliderCloneOf = label;
    return copy;
  }

  /** Re-read the real slides, so DOM edits since the last measure are seen. */
  function syncSlides() {
    slides = trackChildren().filter((el) => !el.hasAttribute("data-slider-clone"));
    count = slides.length;
    slides.forEach((el) => {
      if (!savedStyles.has(el)) {
        savedStyles.set(el, el.getAttribute("style"));
        observeItem(el);
      }
    });
  }

  function sizeSlides() {
    const gap = settings.spaceBetween;
    track.style.gap = isFade() ? "" : gap + "px";

    trackChildren().forEach((el) => {
      if (isFade()) {
        Object.assign(el.style, {
          position: "absolute",
          inset: "0",
          width: "100%",
          opacity: "0",
          transition: transitionCSS("opacity"),
          // Hidden slides must not swallow clicks meant for the visible one.
          pointerEvents: "none",
        });
        return;
      }
      if (settings.slidesPerView === "auto") {
        el.style.flex = "0 0 auto";
      } else {
        const spv = settings.slidesPerView;
        const width = (viewportSize() - gap * (spv - 1)) / spv;
        el.style.flex = `0 0 ${Math.max(0, width)}px`;
      }
      el.style.position = "";
      el.style.opacity = "";
      el.style.pointerEvents = "";
    });

    // The first slide stacks on top when fading, before any position is applied.
    if (isFade()) {
      Object.assign(track.style, { position: "relative", minHeight: "1px" });
    }
  }

  /** How many clones each side needs so a step never runs off the tiles. */
  function cloneCount() {
    if (!settings.loop || !count) return 0;
    const spv = settings.slidesPerView === "auto" ? 1 : Math.ceil(settings.slidesPerView);
    return Math.max(1, settings.slidesPerGroup + spv);
  }

  function buildClones() {
    removeClones();
    clonesPerSide = isFade() ? 0 : cloneCount();
    if (!clonesPerSide) return;

    const before = document.createDocumentFragment();
    for (let j = clonesPerSide; j >= 1; j--) {
      const src = wrapIndex(count - j, count);
      before.appendChild(makeClone(slides[src], String(src)));
    }
    track.insertBefore(before, track.firstChild);

    const after = document.createDocumentFragment();
    for (let j = 0; j < clonesPerSide; j++) {
      const src = wrapIndex(j, count);
      after.appendChild(makeClone(slides[src], String(src)));
    }
    track.appendChild(after);
  }

  /**
   * Fold every breakpoint at or below the current width over the base values,
   * smallest first, so a wide viewport inherits the narrow rules it does not
   * override. Returns true when the active breakpoint changed.
   */
  function resolveBreakpoints() {
    if (!breakpointWidths.length) return false;
    const width = window.innerWidth;

    RESPONSIVE_KEYS.forEach((k) => (settings[k] = responsiveBase[k]));

    let active = null;
    breakpointWidths.forEach((w) => {
      if (width < w) return;
      active = w;
      const overrides = settings.breakpoints[w] || settings.breakpoints[String(w)];
      RESPONSIVE_KEYS.forEach((k) => {
        if (overrides && overrides[k] !== undefined) settings[k] = overrides[k];
      });
    });

    const changed = active !== activeBreakpoint;
    activeBreakpoint = active;
    return changed;
  }

  function measure() {
    const breakpointChanged = resolveBreakpoints();
    rtl = isRTL(container);
    syncSlides();
    if (!count) {
      flow = [];
      maxPos = 0;
      return;
    }

    buildClones();
    sizeSlides();

    const children = trackChildren();
    if (isFade()) {
      flow = children.map(() => 0);
      maxScroll = 0;
      maxPos = count - 1;
    } else {
      // Measured, not computed: this survives fractional slidesPerView, "auto"
      // widths, and any margin the slides bring with them.
      const origin = children.length ? children[0].offsetLeft : 0;
      flow = children.map((el) => Math.abs(el.offsetLeft - origin));

      const last = children[children.length - 1];
      const trackLength = Math.abs(last.offsetLeft - origin) + last.offsetWidth;
      maxScroll = Math.max(0, trackLength - viewportSize());

      if (settings.loop) {
        maxPos = count - 1;
      } else {
        // The last reachable position is the one that puts the track's end
        // flush with the viewport's end; anything past it renders identically.
        maxPos = count - 1;
        for (let i = 0; i < count; i++) {
          if (flowOf(i) >= maxScroll - 0.5) {
            maxPos = i;
            break;
          }
        }
      }
    }

    pos = settings.loop ? wrapIndex(pos, count) : clamp(pos, 0, maxPos);
    labelSlides();
    applyPosition(true);
    emitter.emit("update", controller);
    if (breakpointChanged) {
      emitter.emit("breakpoint", { width: activeBreakpoint, controller });
    }
  }

  /** Flow distance for a logical position, in track-child space. */
  function flowOf(logical) {
    const idx = clamp(logical + clonesPerSide, 0, Math.max(0, flow.length - 1));
    return flow[idx] || 0;
  }

  function targetShift(logical) {
    let distance = flowOf(logical);
    // Without loop the track stops flush with its end rather than scrolling
    // past into empty space.
    if (!settings.loop) distance = Math.min(distance, maxScroll);
    return distance;
  }

  function transitionCSS(property) {
    const ms = reduced ? 0 : settings.speed;
    return `${property} ${ms}ms ${settings.easing}`;
  }

  function applyPosition(instant) {
    if (!count) return;

    if (isFade()) {
      const active = wrapIndex(pos, count);
      trackChildren().forEach((el, i) => {
        el.style.transition = instant ? "none" : transitionCSS("opacity");
        el.style.opacity = i === active ? "1" : "0";
        el.style.pointerEvents = i === active ? "" : "none";
        el.style.zIndex = i === active ? "1" : "0";
      });
      return;
    }

    const shift = (targetShift(pos) - dragPx) * renderSign();
    track.style.transition = instant ? "none" : transitionCSS("transform");
    track.style.transform = `translate3d(${shift}px, 0, 0)`;
  }

  /* ------------------------------------------------------------------ *
   * Accessibility labelling
   * ------------------------------------------------------------------ */

  function labelSlides() {
    slides.forEach((el, i) => {
      if (!el.hasAttribute("role")) el.setAttribute("role", "group");
      el.setAttribute("aria-roledescription", "slide");
      if (!el.hasAttribute("aria-label")) {
        el.setAttribute("aria-label", `${i + 1} of ${count}`);
      }
    });
    markVisible();
  }

  /**
   * Slides scrolled out of view stay in the DOM, so they have to be hidden
   * from assistive tech explicitly or a screen reader walks straight past the
   * viewport edge into content the user cannot see.
   */
  function markVisible() {
    if (!count) return;
    const spv =
      settings.slidesPerView === "auto"
        ? Math.max(1, visibleCountAuto())
        : Math.ceil(settings.slidesPerView);
    const first = wrapIndex(pos, count);
    const shown = {};
    for (let k = 0; k < spv; k++) shown[wrapIndex(first + k, count)] = true;

    slides.forEach((el, i) => {
      if (shown[i]) {
        el.removeAttribute("aria-hidden");
        if ("inert" in el) el.inert = false;
      } else {
        el.setAttribute("aria-hidden", "true");
        if ("inert" in el) el.inert = true;
      }
    });
  }

  function visibleCountAuto() {
    const start = targetShift(pos);
    const end = start + viewportSize();
    let n = 0;
    for (let i = 0; i < count; i++) {
      const a = flowOf(i);
      const b = a + (slides[i] ? slides[i].offsetWidth : 0);
      if (b > start + 1 && a < end - 1) n++;
    }
    return n;
  }

  /* ------------------------------------------------------------------ *
   * Movement
   * ------------------------------------------------------------------ */

  function clearTransitionTimer() {
    if (transitionTimer !== null) {
      clearTimeout(transitionTimer);
      transitionTimer = null;
    }
  }

  /** After a move that landed in the clone region, hop to the real slide. */
  function normalizeLoop() {
    if (!settings.loop || isFade() || !count) return;
    if (pos >= 0 && pos < count) return;
    pos = wrapIndex(pos, count);
    applyPosition(true);
    // Force the browser to commit the un-transitioned jump before anything
    // re-enables the transition, or the hop animates and the seam is visible.
    void track.offsetWidth;
  }

  function settle() {
    clearTransitionTimer();
    normalizeLoop();
    markVisible();
    emitter.emit("transitionEnd", controller);
  }

  function moveTo(target, opts = {}) {
    if (!count) return controller;
    const instant = opts.instant || reduced;
    const previous = wrapIndex(pos, count);

    if (settings.loop) {
      pos = target;
    } else {
      pos = clamp(target, 0, maxPos);
    }

    dragPx = 0;
    applyPosition(instant);

    const index = wrapIndex(pos, count);
    if (index !== previous || opts.force) {
      markVisible();
      emitter.emit("change", { index, previous, controller });
    }

    clearTransitionTimer();
    if (instant || !settings.speed) {
      settle();
    } else {
      // transitionend is unreliable when the transform resolves to no change,
      // so drive the state machine from a timer and treat the event as a hint.
      transitionTimer = setTimeout(settle, settings.speed + TRANSITION_GRACE_MS);
    }
    return controller;
  }

  /** Nearest representation of logical index `i` to the current position. */
  function nearestTarget(i) {
    const wrapped = wrapIndex(i, count);
    if (!settings.loop) return wrapped;
    const current = pos;
    const candidates = [wrapped - count, wrapped, wrapped + count];
    return candidates.reduce((best, c) =>
      Math.abs(c - current) < Math.abs(best - current) ? c : best
    );
  }

  function onTransitionEnd(e) {
    if (e.target !== track && e.currentTarget !== track) return;
    if (e.propertyName !== "transform" && e.propertyName !== "opacity") return;
    settle();
  }

  track.addEventListener("transitionend", onTransitionEnd);

  /* ------------------------------------------------------------------ *
   * Observers
   * ------------------------------------------------------------------ */

  const cleanups = [];
  let measureQueued = false;

  function queueMeasure() {
    if (measureQueued) return;
    measureQueued = true;
    requestAnimationFrame(() => {
      measureQueued = false;
      measure();
    });
  }

  if (settings.respectReducedMotion) {
    reduced = prefersReducedMotion();
    cleanups.push(
      watchReducedMotion((on) => {
        reduced = on;
        emitter.emit("reducedMotion", on);
      })
    );
  }

  if (breakpointWidths.length) {
    // Breakpoints key off the viewport, which can cross a threshold without
    // the container itself changing size.
    window.addEventListener("resize", queueMeasure);
    cleanups.push(() => window.removeEventListener("resize", queueMeasure));
  }

  if (settings.observeResize && typeof ResizeObserver !== "undefined") {
    const ro = new ResizeObserver(queueMeasure);
    observeItem = function (el) {
      ro.observe(el);
    };
    ro.observe(container);
    slides.forEach(observeItem);
    cleanups.push(() => ro.disconnect());
  }

  container.setAttribute("aria-roledescription", "carousel");
  if (!container.hasAttribute("role")) container.setAttribute("role", "region");

  /* ------------------------------------------------------------------ *
   * Controller
   * ------------------------------------------------------------------ */

  const controller = {
    container,
    track,
    settings,

    /** The real slides, in order, excluding loop clones. */
    get slides() {
      return slides.slice();
    },
    get length() {
      return count;
    },
    /** Active slide index, always within [0, length). */
    get index() {
      return wrapIndex(pos, count);
    },
    /** Raw position, which sits outside [0, length) mid-loop. */
    get rawPosition() {
      return pos;
    },
    get canGoPrev() {
      return settings.loop ? count > 0 : pos > 0;
    },
    get canGoNext() {
      return settings.loop ? count > 0 : pos < maxPos;
    },
    /** Highest reachable index. Below length-1 when several slides fit. */
    get lastIndex() {
      return maxPos;
    },
    /** Number of dot pages. */
    get pages() {
      if (!count) return 0;
      return settings.loop
        ? Math.ceil(count / settings.slidesPerGroup)
        : Math.floor(maxPos / settings.slidesPerGroup) + 1;
    },
    get page() {
      return Math.min(
        controller.pages - 1,
        Math.floor(wrapIndex(pos, count) / settings.slidesPerGroup)
      );
    },

    next(opts) {
      if (!settings.loop && !controller.canGoNext) return controller;
      return moveTo(pos + settings.slidesPerGroup, opts);
    },
    prev(opts) {
      if (!settings.loop && !controller.canGoPrev) return controller;
      return moveTo(pos - settings.slidesPerGroup, opts);
    },
    goTo(i, opts) {
      if (typeof i !== "number" || !isFinite(i)) {
        throw new TypeError("goTo: expected a slide index");
      }
      return moveTo(nearestTarget(i), opts);
    },
    goToPage(p, opts) {
      return controller.goTo(p * settings.slidesPerGroup, opts);
    },

    /** Re-measure after adding, removing or restyling slides. */
    update() {
      measure();
      return controller;
    },
    /** Append a slide ahead of the trailing clones and re-measure. */
    addSlide(el) {
      if (!(el instanceof Element)) throw new TypeError("addSlide: expected an Element");
      // Track order is [leading clones][real slides][trailing clones], so the
      // first trailing clone is where a new real slide belongs.
      const anchor = clonesPerSide ? trackChildren()[clonesPerSide + count] : null;
      track.insertBefore(el, anchor || null);
      return controller.update();
    },
    removeSlide(el) {
      if (slides.indexOf(el) === -1) return false;
      el.remove();
      savedStyles.delete(el);
      controller.update();
      return true;
    },

    /** Subscribe to "change", "update", "transitionEnd", "reducedMotion". */
    on(name, fn) {
      const off = emitter.on(name, fn);
      cleanups.push(off);
      return off;
    },

    /* Used by the drag layer to follow the finger without committing. */
    setDragOffset(px) {
      if (isFade()) return controller;
      dragPx = px;
      applyPosition(true);
      return controller;
    },
    get dragOffset() {
      return dragPx;
    },
    /** Width of one step, for turning a drag distance into slides. */
    get stepSize() {
      const a = flowOf(0);
      const b = flowOf(Math.min(1, Math.max(0, count - 1)));
      return Math.abs(b - a) || viewportSize();
    },

    /* Named pause reasons, shared with the autoplay layer. */
    pause(reason) {
      pauseReasons.add(reason || "manual");
      emitter.emit("pause", controller);
    },
    resume(reason) {
      pauseReasons.delete(reason || "manual");
      if (!pauseReasons.size) emitter.emit("resume", controller);
    },
    get paused() {
      return pauseReasons.size > 0;
    },
    get pausedBy() {
      return Array.from(pauseReasons);
    },

    /** True when transitions are being skipped for reduced motion. */
    get reducedMotion() {
      return reduced;
    },
    /** True between a move starting and its transition settling. */
    get transitioning() {
      return transitionTimer !== null;
    },
    /** Minimum width of the breakpoint in force, or null below them all. */
    get activeBreakpoint() {
      return activeBreakpoint;
    },

    addCleanup(fn) {
      cleanups.push(fn);
      return controller;
    },

    destroy() {
      teardown(container, SLIDER_KEY);
    },
  };

  const cleanup = function () {
    clearTransitionTimer();
    track.removeEventListener("transitionend", onTransitionEnd);
    cleanups.forEach((fn) => fn());
    emitter.clear();
    removeClones();
    slides.forEach((el) => {
      const style = savedStyles.get(el);
      if (style === null || style === undefined) el.removeAttribute("style");
      else el.setAttribute("style", style);
      ["role", "aria-roledescription", "aria-label", "aria-hidden"].forEach((a) =>
        el.removeAttribute(a)
      );
      if ("inert" in el) el.inert = false;
      container.appendChild(el);
    });
    track.remove();
    container.removeAttribute("aria-roledescription");
    if (containerStyle === null) container.removeAttribute("style");
    else container.setAttribute("style", containerStyle);
  };

  cleanup.controller = controller;
  container[SLIDER_KEY] = cleanup;

  // Only now that `controller` exists can measure() emit with it.
  pos = settings.initialSlide;
  measure();

  return controller;
}

/** Get the controller for a container, or null if it has no slider. */
export function getSlider(container) {
  const handle = container && container[SLIDER_KEY];
  return handle ? handle.controller : null;
}

/** Tear down the slider on `container` and restore its original DOM. */
export function clearSlider(container) {
  teardown(container, SLIDER_KEY);
}
