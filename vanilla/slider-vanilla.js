/*!
 * vanilla js slider — content carousel / slideshow
 * Kenneth D'silva (Modracx), Copyright (c) 2026
 * Licensed under the MIT License – https://opensource.org/licenses/MIT
 *
 * Standalone script-tag build. Attaches window.Slider.
 * GENERATED FROM slider-js/src BY build.mjs — DO NOT EDIT BY HAND.
 */
(function () {
  /* ---------------------------------------------------------------- *
   * core.js
   * ---------------------------------------------------------------- */

  /** Teardown handle stashed on the container element. */
  const SLIDER_KEY = Symbol.for("slider-js.slider");

  function createElement(tag, style = {}) {
    const el = document.createElement(tag);
    Object.assign(el.style, style);
    return el;
  }

  function clamp(value, min, max) {
    return value < min ? min : value > max ? max : value;
  }

  /** Wrap `i` into [0, length). Handles negatives, unlike a bare `%`. */
  function wrapIndex(i, length) {
    if (!(length > 0)) return 0;
    return ((i % length) + length) % length;
  }

  /**
   * True when `el` renders right-to-left. In an RTL flex row the first child is
   * the rightmost one, which inverts both the measurement and the transform.
   */
  function isRTL(el) {
    if (typeof getComputedStyle !== "function") return false;
    return getComputedStyle(el).direction === "rtl";
  }

  const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

  function prefersReducedMotion() {
    // matchMedia is missing in jsdom and old embedded webviews; assume motion is
    // fine there rather than silently refusing to animate.
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia(REDUCED_MOTION_QUERY).matches;
  }

  /** Subscribe to reduced-motion changes. Returns an unsubscribe function. */
  function watchReducedMotion(callback) {
    if (typeof window === "undefined" || !window.matchMedia) return function () {};
    const mq = window.matchMedia(REDUCED_MOTION_QUERY);
    const handler = function (e) {
      callback(e.matches);
    };
    // Safari < 14 only has the deprecated addListener form.
    if (mq.addEventListener) {
      mq.addEventListener("change", handler);
      return function () {
        mq.removeEventListener("change", handler);
      };
    }
    mq.addListener(handler);
    return function () {
      mq.removeListener(handler);
    };
  }

  /**
   * The smallest event emitter that does the job. The navigation and control
   * layers are built on top of the engine rather than inside it, so they need a
   * way to hear about index changes without polling.
   */
  function createEmitter() {
    const handlers = Object.create(null);

    return {
      on(name, fn) {
        (handlers[name] || (handlers[name] = [])).push(fn);
        return function off() {
          const list = handlers[name];
          if (!list) return;
          const i = list.indexOf(fn);
          if (i !== -1) list.splice(i, 1);
        };
      },
      emit(name, payload) {
        const list = handlers[name];
        if (!list) return;
        // Copy first: a handler is allowed to unsubscribe itself.
        list.slice().forEach((fn) => fn(payload));
      },
      clear() {
        Object.keys(handlers).forEach((k) => delete handlers[k]);
      },
    };
  }

  /** Run and drop the teardown stored under `key`, if any. */
  function teardown(container, key) {
    if (container && container[key]) {
      container[key]();
      delete container[key];
    }
  }

  /* ---------------------------------------------------------------- *
   * slider.js
   * ---------------------------------------------------------------- */

  const sliderDefaults = {
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
  function createSlider(container, options = {}) {
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
  function getSlider(container) {
    const handle = container && container[SLIDER_KEY];
    return handle ? handle.controller : null;
  }

  /** Tear down the slider on `container` and restore its original DOM. */
  function clearSlider(container) {
    teardown(container, SLIDER_KEY);
  }

  /* ---------------------------------------------------------------- *
   * navigation.js
   * ---------------------------------------------------------------- */

  const navigationDefaults = {
    /** Render previous/next buttons. */
    arrows: true,
    /** Render a dot per page. */
    dots: true,
    /** Accessible names for the arrows. */
    arrowLabels: { prev: "Previous slide", next: "Next slide" },
    /** Builds a dot's accessible name. */
    dotLabel: (page, pages) => `Go to slide ${page + 1} of ${pages}`,
    /**
     * Announce the active slide to screen readers as it changes. Off while
     * autoplay is running, since an unprompted announcement every few seconds
     * is hostile.
     */
    announce: true,
  };

  const ARROW_BASE = {
    position: "absolute",
    top: "50%",
    transform: "translateY(-50%)",
    zIndex: "10",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "36px",
    height: "36px",
    padding: "0",
    borderRadius: "50%",
    border: "1px solid rgba(127, 127, 127, 0.45)",
    background: "rgba(20, 20, 20, 0.62)",
    color: "#fff",
    font: "inherit",
    fontSize: "15px",
    lineHeight: "1",
    cursor: "pointer",
  };

  /**
   * Attach arrows and dots to an existing slider `controller`.
   * Returns a cleanup function, also registered with the controller so
   * `destroy()` removes this chrome too.
   */
  function attachNavigation(controller, options = {}) {
    if (!controller) throw new TypeError("attachNavigation: controller is required");
    const settings = { ...navigationDefaults, ...options };
    const container = controller.container;
    const nodes = [];
    const offs = [];

    let prevBtn = null;
    let nextBtn = null;
    let dotsBar = null;
    let live = null;

    function chrome(el) {
      // Marks our own UI so the drag layer and measurement ignore it.
      el.dataset.sliderChrome = "";
      container.appendChild(el);
      nodes.push(el);
      return el;
    }

    if (settings.arrows) {
      const rtl = getComputedStyle(container).direction === "rtl";

      prevBtn = createElement("button", { ...ARROW_BASE, [rtl ? "right" : "left"]: "8px" });
      prevBtn.type = "button";
      prevBtn.textContent = rtl ? "›" : "‹";
      prevBtn.setAttribute("aria-label", settings.arrowLabels.prev);
      prevBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        controller.prev();
      });
      chrome(prevBtn);

      nextBtn = createElement("button", { ...ARROW_BASE, [rtl ? "left" : "right"]: "8px" });
      nextBtn.type = "button";
      nextBtn.textContent = rtl ? "‹" : "›";
      nextBtn.setAttribute("aria-label", settings.arrowLabels.next);
      nextBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        controller.next();
      });
      chrome(nextBtn);
    }

    if (settings.dots) {
      dotsBar = createElement("div", {
        position: "absolute",
        left: "0",
        right: "0",
        bottom: "8px",
        zIndex: "10",
        display: "flex",
        gap: "8px",
        justifyContent: "center",
        alignItems: "center",
      });
      dotsBar.setAttribute("role", "tablist");
      dotsBar.setAttribute("aria-label", "Choose slide");
      chrome(dotsBar);
    }

    if (settings.announce) {
      // Visually hidden, but not display:none — that would silence it.
      live = createElement("div", {
        position: "absolute",
        width: "1px",
        height: "1px",
        margin: "-1px",
        padding: "0",
        border: "0",
        overflow: "hidden",
        clip: "rect(0 0 0 0)",
        clipPath: "inset(50%)",
        whiteSpace: "nowrap",
      });
      live.setAttribute("aria-live", "polite");
      live.setAttribute("aria-atomic", "true");
      chrome(live);
    }

    function buildDots() {
      if (!dotsBar) return;
      const pages = controller.pages;
      // Rebuild only when the count changed; otherwise reuse and just restyle.
      if (dotsBar.children.length !== pages) {
        dotsBar.textContent = "";
        for (let p = 0; p < pages; p++) {
          const dot = createElement("button", {
            width: "9px",
            height: "9px",
            padding: "0",
            borderRadius: "50%",
            border: "0",
            cursor: "pointer",
            background: "rgba(255, 255, 255, 0.4)",
            transition: "background 150ms, transform 150ms",
          });
          dot.type = "button";
          dot.dataset.sliderChrome = "";
          dot.dataset.page = String(p);
          dot.setAttribute("role", "tab");
          dot.setAttribute("aria-label", settings.dotLabel(p, pages));
          dot.addEventListener("click", (e) => {
            e.stopPropagation();
            controller.goToPage(p);
          });
          dotsBar.appendChild(dot);
        }
      }
      syncDots();
    }

    function syncDots() {
      if (!dotsBar) return;
      const active = controller.page;
      Array.prototype.slice.call(dotsBar.children).forEach((dot, p) => {
        const on = p === active;
        dot.setAttribute("aria-selected", String(on));
        dot.tabIndex = on ? 0 : -1;
        dot.style.background = on ? "#fff" : "rgba(255, 255, 255, 0.4)";
        dot.style.transform = on ? "scale(1.25)" : "scale(1)";
      });
    }

    function syncArrows() {
      if (!prevBtn) return;
      const back = !controller.canGoPrev;
      const fwd = !controller.canGoNext;
      prevBtn.disabled = back;
      nextBtn.disabled = fwd;
      prevBtn.style.opacity = back ? "0.35" : "1";
      nextBtn.style.opacity = fwd ? "0.35" : "1";
      prevBtn.style.cursor = back ? "default" : "pointer";
      nextBtn.style.cursor = fwd ? "default" : "pointer";
    }

    function announce() {
      // Silent while autoplay drives the change: the user did not ask for it.
      if (!live || controller.autoplayRunning) return;
      live.textContent = `Slide ${controller.index + 1} of ${controller.length}`;
    }

    function syncAll() {
      syncArrows();
      syncDots();
    }

    offs.push(
      controller.on("change", () => {
        syncAll();
        announce();
      })
    );
    offs.push(
      controller.on("update", () => {
        buildDots();
        syncArrows();
      })
    );

    buildDots();
    syncArrows();

    const cleanup = function () {
      offs.forEach((off) => off());
      offs.length = 0;
      nodes.forEach((el) => el.remove());
      nodes.length = 0;
    };

    controller.addCleanup(cleanup);
    return cleanup;
  }

  /* ---------------------------------------------------------------- *
   * controls.js
   * ---------------------------------------------------------------- */

  const controlDefaults = {
    /** Swipe/drag between slides with mouse, touch or pen. */
    draggable: true,
    /** Px dragged before it counts as a swipe rather than a click. */
    dragThreshold: 5,
    /**
     * Fraction of a slide that must be dragged to advance on release.
     * A fast flick advances regardless — see `flickVelocity`.
     */
    dragRatio: 0.25,
    /** Px/second above which a release advances no matter how short the drag. */
    flickVelocity: 400,
    /** Arrow keys move between slides once the carousel has focus. */
    keyboard: true,
    /** Advance every N ms. `0` or `false` disables it. */
    autoplay: 0,
    /**
     * What autoplay does when it reaches the last slide of a non-looping
     * carousel: "stop" releases the timer, "rewind" returns to the first slide.
     * Ignored when `loop` is on, where there is no end to reach.
     */
    autoplayEndBehavior: "stop",
    /** Stop autoplay for good on the first real interaction. */
    autoplayStopOnInteraction: true,
    /**
     * Ms to wait before autoplay resumes after an interaction. Only consulted
     * when `autoplayStopOnInteraction` is false; `0` resumes on the next tick.
     */
    autoplayResumeDelay: 0,
    /** Render an accessible play/pause button for autoplay. */
    showPauseButton: false,
    /** Corner for that button. */
    pauseButtonPosition: "bottom-right",
    /** Accessible names for the two button states. */
    pauseButtonLabels: { pause: "Pause autoplay", play: "Resume autoplay" },
    /** Render a progress bar counting down to the next advance. */
    showProgress: false,
    /** Thickness of that bar, in px. */
    progressHeight: 3,
    /** Colour of that bar. */
    progressColor: "rgba(255, 255, 255, 0.85)",
    /** Hold autoplay while the pointer is over the carousel. */
    pauseOnHover: true,
    /** Hold autoplay while something inside has keyboard focus. */
    pauseOnFocus: true,
    /** Hold autoplay while the tab is hidden or the carousel is offscreen. */
    pauseOnHidden: true,
  };

  /** Velocity samples older than this are stale for the flick calculation. */
  const FLICK_WINDOW_MS = 120;

  const BUTTON_CORNERS = {
    "top-left": { top: "8px", left: "8px" },
    "top-right": { top: "8px", right: "8px" },
    "bottom-left": { bottom: "8px", left: "8px" },
    "bottom-right": { bottom: "8px", right: "8px" },
  };

  /**
   * Wire interaction onto an existing slider `controller`.
   * Returns a cleanup function, also registered with the controller.
   */
  function attachControls(controller, options = {}) {
    if (!controller) throw new TypeError("attachControls: controller is required");
    const settings = { ...controlDefaults, ...options };
    const container = controller.container;
    const listeners = [];

    function on(target, type, handler, opts) {
      target.addEventListener(type, handler, opts);
      listeners.push(() => target.removeEventListener(type, handler, opts));
    }

    const isRTLNow = () => getComputedStyle(container).direction === "rtl";

    /* ---------------------------------------------------------------- *
     * Autoplay
     * ---------------------------------------------------------------- */

    let timer = null;
    let waitingForSettle = null; // unsubscribe fn while deferring to a transition
    let running = false;
    let stoppedForGood = false;
    let cycleStart = 0;
    let cycleLength = 0;
    let offsOnChange = null;
    const interval = Number(settings.autoplay) || 0;

    if (["stop", "rewind"].indexOf(settings.autoplayEndBehavior) === -1) {
      throw new TypeError(
        'attachControls: autoplayEndBehavior must be "stop" or "rewind"'
      );
    }

    /** Cancel any pending tick without changing whether autoplay is "running". */
    function clearPending() {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      if (waitingForSettle) {
        waitingForSettle();
        waitingForSettle = null;
      }
    }

    function schedule(ms) {
      clearPending();
      if (!interval || stoppedForGood || controller.paused) return;
      running = true;
      cycleLength = ms == null ? interval : ms;
      cycleStart = performance.now();
      startProgress(cycleLength);
      timer = setTimeout(fire, cycleLength);
    }

    function fire() {
      timer = null;
      // A transition still in flight means the interval is shorter than `speed`.
      // Advancing now would retarget a move nobody has seen finish, so wait.
      if (controller.transitioning) {
        waitingForSettle = controller.on("transitionEnd", () => {
          if (waitingForSettle) waitingForSettle();
          waitingForSettle = null;
          advance();
        });
        return;
      }
      advance();
    }

    function advance() {
      // A non-looping carousel runs out of slides; without this the timer ticks
      // forever against a next() that cannot move.
      if (!controller.settings.loop && !controller.canGoNext) {
        if (settings.autoplayEndBehavior === "rewind") {
          controller.goTo(0);
        } else {
          stopAutoplay();
          return;
        }
      } else {
        // Reduced motion still advances; the engine just skips the animation.
        controller.next();
      }
      schedule();
    }

    function startAutoplay() {
      if (!interval || stoppedForGood || running) return;
      if (controller.paused) return;
      schedule();
    }

    function stopAutoplay() {
      running = false;
      clearPending();
      resetProgress();
    }

    function holdAutoplay(reason) {
      controller.pause(reason);
      if (!running) return;
      // Keep `running` true: this is a hold, not a stop, and the remaining time
      // carries over so a hover does not hand the user a fresh full interval.
      const elapsed = performance.now() - cycleStart;
      cycleLength = Math.max(0, cycleLength - elapsed);
      clearPending();
      freezeProgress();
    }

    function releaseAutoplay(reason) {
      controller.resume(reason);
      if (controller.paused || !running || stoppedForGood) return;
      schedule(cycleLength);
    }

    /** A real interaction ends autoplay permanently, or pauses it for a while. */
    function noteInteraction() {
      if (!interval) return;
      if (settings.autoplayStopOnInteraction) {
        stoppedForGood = true;
        stopAutoplay();
        syncButton();
        return;
      }
      if (settings.autoplayResumeDelay > 0) {
        schedule(settings.autoplayResumeDelay);
      } else {
        schedule();
      }
    }

    // Exposed so the navigation layer can stay quiet while autoplay drives.
    Object.defineProperty(controller, "autoplayRunning", {
      configurable: true,
      get: () => running,
    });

    /* ---------------------------------------------------------------- *
     * Autoplay chrome: play/pause button and progress bar
     * ---------------------------------------------------------------- */

    let pauseButton = null;
    let progressBar = null;

    function syncButton() {
      if (!pauseButton) return;
      // Reflects the user's intent, not the aggregate: a carousel resting
      // because it is hovered or offscreen still reads as playing, so the
      // control does not flip under the user's own cursor.
      const off = stoppedForGood || !running;
      pauseButton.textContent = off ? "▶" : "❚❚";
      pauseButton.setAttribute(
        "aria-label",
        off ? settings.pauseButtonLabels.play : settings.pauseButtonLabels.pause
      );
      pauseButton.setAttribute("aria-pressed", String(off));
    }

    function buildPauseButton() {
      pauseButton = createElement("button", {
        position: "absolute",
        zIndex: "11",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: "28px",
        height: "28px",
        padding: "0",
        borderRadius: "50%",
        border: "1px solid rgba(127, 127, 127, 0.45)",
        background: "rgba(20, 20, 20, 0.62)",
        color: "#fff",
        font: "inherit",
        fontSize: "10px",
        lineHeight: "1",
        cursor: "pointer",
        ...(BUTTON_CORNERS[settings.pauseButtonPosition] || BUTTON_CORNERS["bottom-right"]),
      });
      pauseButton.type = "button";
      pauseButton.dataset.sliderChrome = "";
      // Not "interaction" in the stop-on-interaction sense: this button *is* the
      // autoplay control, so it must not trip the handler that kills autoplay.
      pauseButton.dataset.sliderAutoplayToggle = "";
      pauseButton.addEventListener("click", (e) => {
        e.stopPropagation();
        if (stoppedForGood || !running) {
          // The button is an explicit request, so it also undoes a permanent
          // stop — otherwise "play" would be a dead control.
          stoppedForGood = false;
          running = true;
          schedule();
        } else {
          stopAutoplay();
        }
        syncButton();
      });
      container.appendChild(pauseButton);
      listeners.push(() => pauseButton.remove());
    }

    function buildProgressBar() {
      const rtl = isRTLNow();
      progressBar = createElement("div", {
        position: "absolute",
        left: "0",
        right: "0",
        bottom: "0",
        height: settings.progressHeight + "px",
        background: settings.progressColor,
        transformOrigin: rtl ? "right center" : "left center",
        transform: "scaleX(0)",
        zIndex: "11",
        pointerEvents: "none",
      });
      progressBar.dataset.sliderChrome = "";
      progressBar.dataset.sliderProgress = "";
      container.appendChild(progressBar);
      listeners.push(() => progressBar.remove());
    }

    function startProgress(ms) {
      if (!progressBar) return;
      progressBar.style.transition = "none";
      progressBar.style.transform = "scaleX(0)";
      // Commit the reset before starting the run, or the browser coalesces both
      // into one style change and nothing animates.
      void progressBar.offsetWidth;
      progressBar.style.transition = `transform ${ms}ms linear`;
      progressBar.style.transform = "scaleX(1)";
    }

    function freezeProgress() {
      if (!progressBar) return;
      const current = getComputedStyle(progressBar).transform;
      progressBar.style.transition = "none";
      progressBar.style.transform = current === "none" ? "scaleX(0)" : current;
    }

    function resetProgress() {
      if (!progressBar) return;
      progressBar.style.transition = "none";
      progressBar.style.transform = "scaleX(0)";
    }

    if (interval) {
      if (settings.showPauseButton) buildPauseButton();
      if (settings.showProgress) buildProgressBar();

      offsOnChange = controller.on("change", syncButton);

      if (settings.pauseOnHover) {
        on(container, "pointerenter", () => holdAutoplay("hover"));
        on(container, "pointerleave", () => releaseAutoplay("hover"));
      }
      if (settings.pauseOnFocus) {
        on(container, "focusin", () => holdAutoplay("focus"));
        on(container, "focusout", () => releaseAutoplay("focus"));
      }
      if (settings.pauseOnHidden) {
        const onVisibility = () =>
          document.hidden ? holdAutoplay("hidden") : releaseAutoplay("hidden");
        on(document, "visibilitychange", onVisibility);

        if (typeof IntersectionObserver !== "undefined") {
          const io = new IntersectionObserver((entries) => {
            entries.forEach((entry) =>
              entry.isIntersecting
                ? releaseAutoplay("offscreen")
                : holdAutoplay("offscreen")
            );
          });
          io.observe(container);
          listeners.push(() => io.disconnect());
        }
      }
      startAutoplay();
      syncButton();
    }

    /* ---------------------------------------------------------------- *
     * Swipe / drag
     * ---------------------------------------------------------------- */

    if (settings.draggable && controller.settings.effect !== "fade") {
      let drag = null;

      container.style.touchAction = "pan-y";

      on(container, "pointerdown", (e) => {
        if (e.button !== 0 && e.pointerType === "mouse") return;
        // Arrows and dots handle their own clicks.
        if (e.target.closest("[data-slider-chrome]")) return;
        drag = {
          id: e.pointerId,
          startX: e.clientX,
          moved: false,
          samples: [{ t: e.timeStamp, p: e.clientX }],
        };
        holdAutoplay("drag");
        container.setPointerCapture(e.pointerId);
      });

      on(container, "pointermove", (e) => {
        if (!drag || e.pointerId !== drag.id) return;
        const delta = e.clientX - drag.startX;
        if (Math.abs(delta) >= settings.dragThreshold) {
          if (!drag.moved) noteInteraction();
          drag.moved = true;
        }
        // Dragging right should reveal the previous slide, so the offset the
        // engine applies runs the other way — and inverts again under RTL.
        controller.setDragOffset(isRTLNow() ? -delta : delta);

        drag.samples.push({ t: e.timeStamp, p: e.clientX });
        while (
          drag.samples.length > 2 &&
          e.timeStamp - drag.samples[0].t > FLICK_WINDOW_MS
        ) {
          drag.samples.shift();
        }
      });

      /** Px/second along the drag axis over the tail of the gesture. */
      function velocity(d, endTime) {
        if (d.samples.length < 2) return 0;
        const first = d.samples[0];
        const last = d.samples[d.samples.length - 1];
        const ms = (endTime || last.t) - first.t;
        if (ms <= 0) return 0;
        return ((last.p - first.p) / ms) * 1000;
      }

      const endDrag = function (e) {
        if (!drag || e.pointerId !== drag.id) return;
        const moved = drag.moved;
        const delta = e.clientX - drag.startX;
        const v = velocity(drag, e.timeStamp);
        drag = null;

        if (container.hasPointerCapture(e.pointerId)) {
          container.releasePointerCapture(e.pointerId);
        }
        controller.setDragOffset(0);

        if (moved) {
          // Signed in slide-advance space: positive means "go forward".
          const forward = isRTLNow() ? delta > 0 : delta < 0;
          const distance = Math.abs(delta);
          const speed = Math.abs(v);
          const far = distance > controller.stepSize * settings.dragRatio;
          const fast = speed > settings.flickVelocity;

          if (far || fast) {
            forward ? controller.next() : controller.prev();
          } else {
            // Snap back to where we were.
            controller.goTo(controller.index);
          }

          // A swipe that ends on a link must not also activate it.
          const swallow = function (ev) {
            ev.preventDefault();
            ev.stopPropagation();
          };
          container.addEventListener("click", swallow, { capture: true, once: true });
          requestAnimationFrame(() =>
            container.removeEventListener("click", swallow, { capture: true })
          );
        }

        releaseAutoplay("drag");
      };

      on(container, "pointerup", endDrag);
      on(container, "pointercancel", endDrag);
      on(container, "dragstart", (e) => e.preventDefault());
    }

    /* ---------------------------------------------------------------- *
     * Keyboard
     * ---------------------------------------------------------------- */

    if (settings.keyboard) {
      const hadTabIndex = container.hasAttribute("tabindex");
      if (!hadTabIndex) container.setAttribute("tabindex", "0");
      listeners.push(() => {
        if (!hadTabIndex) container.removeAttribute("tabindex");
      });

      on(container, "keydown", (e) => {
        // Never hijack keys meant for a control the user has focused, except our
        // own dots, where arrow keys are the expected way to move.
        const inControl = e.target.closest("a, button, input, select, textarea");
        if (inControl && !inControl.hasAttribute("data-slider-chrome")) return;

        const rtl = isRTLNow();
        let handled = true;
        switch (e.key) {
          case "ArrowLeft":
            rtl ? controller.next() : controller.prev();
            break;
          case "ArrowRight":
            rtl ? controller.prev() : controller.next();
            break;
          case "Home":
            controller.goTo(0);
            break;
          case "End":
            controller.goTo(controller.lastIndex);
            break;
          default:
            handled = false;
        }
        if (handled) {
          e.preventDefault();
          noteInteraction();
        }
      });
    }

    /* ---------------------------------------------------------------- *
     * Arrow and dot clicks also count as interaction
     * ---------------------------------------------------------------- */

    on(
      container,
      "click",
      (e) => {
        if (e.target.closest("[data-slider-autoplay-toggle]")) return;
        if (e.target.closest("[data-slider-chrome]")) noteInteraction();
      },
      true
    );

    const cleanup = function () {
      stopAutoplay();
      if (offsOnChange) offsOnChange();
      listeners.forEach((off) => off());
      listeners.length = 0;
      delete controller.autoplayRunning;
    };

    controller.addCleanup(cleanup);
    return cleanup;
  }

  /* ---------------------------------------------------------------- *
   * autoinit.js
   * ---------------------------------------------------------------- */

  /** Elements carrying this attribute are picked up by autoInit(). */
  const AUTO_SELECTOR = "[data-slider]";

  /** Our own markers, which must never be read back as options. */
  const RESERVED = [
    "slider",
    "sliderTrack",
    "sliderClone",
    "sliderCloneOf",
    "sliderChrome",
  ];

  /** "3" -> 3, "false" -> false, "" -> true, JSON -> object, "auto" -> "auto". */
  function coerce(raw) {
    if (raw === "") return true; // bare `data-slider-loop` reads as on
    if (raw === "true") return true;
    if (raw === "false") return false;
    if (raw === "null") return null;

    // Structured values such as breakpoints have to survive a data attribute.
    const trimmed = raw.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        return JSON.parse(trimmed);
      } catch (e) {
        throw new SyntaxError(`slider-js: expected JSON in a data attribute, got ${raw}`);
      }
    }

    const n = Number(raw);
    return trimmed !== "" && !Number.isNaN(n) ? n : raw;
  }

  /** sliderSlidesPerView -> slidesPerView */
  function optionName(datasetKey) {
    const rest = datasetKey.slice("slider".length);
    return rest.charAt(0).toLowerCase() + rest.slice(1);
  }

  /**
   * Read options off an element's data attributes.
   *
   * `data-slider` may hold a JSON object; individual `data-slider-*` attributes
   * are merged over it, which is easier to produce from a CMS field than
   * embedded JSON:
   *
   *   <div data-slider='{"speed":500}' data-slider-loop>
   *   <div data-slider data-slider-slides-per-view="3" data-slider-autoplay="4000">
   */
  function readSliderOptions(el) {
    const options = {};

    const json = el.getAttribute("data-slider");
    if (json && json.trim() && json.trim() !== "true") {
      try {
        Object.assign(options, JSON.parse(json));
      } catch (e) {
        throw new SyntaxError(
          `slider-js: data-slider is not valid JSON on <${el.tagName.toLowerCase()}> — ` +
            `received ${json}`
        );
      }
    }

    Object.keys(el.dataset).forEach((key) => {
      if (!key.startsWith("slider") || RESERVED.indexOf(key) !== -1) return;
      options[optionName(key)] = coerce(el.dataset[key]);
    });

    return options;
  }

  /** Elements under `root` that want a slider and do not already have one. */
  function autoTargets(root, hasSlider) {
    const scope = root || document;
    const found = [];
    if (scope.matches && scope.matches(AUTO_SELECTOR)) found.push(scope);
    if (scope.querySelectorAll) {
      Array.prototype.push.apply(
        found,
        Array.prototype.slice.call(scope.querySelectorAll(AUTO_SELECTOR))
      );
    }
    // Skip anything already initialised so autoInit is safe to call repeatedly.
    return found.filter((el) => !hasSlider(el));
  }

  const defaults = Object.assign({}, sliderDefaults, navigationDefaults, controlDefaults);

  function create(container, options) {
    const opts = options || {};
    const settings = Object.assign({}, defaults, opts);

    // Navigation before controls: the arrows and dots read autoplayRunning,
    // which the control layer defines on the controller.
    const controller = createSlider(container, settings);
    attachNavigation(controller, settings);
    attachControls(controller, settings);
    return controller;
  }

  function clear(container) {
    clearSlider(container);
  }

  function autoInit(root) {
    return autoTargets(root, getSlider).map(function (el) {
      return create(el, readSliderOptions(el));
    });
  }

  // Declarative setup: anything with [data-slider] starts on its own.
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      autoInit(document);
    });
  } else {
    autoInit(document);
  }

  window.Slider = {
    create: create,
    clear: clear,
    get: getSlider,
    autoInit: autoInit,
    defaults: defaults,
    // granular control
    createSlider: createSlider,
    clearSlider: clearSlider,
    attachNavigation: attachNavigation,
    attachControls: attachControls,
    // helpers
    prefersReducedMotion: prefersReducedMotion,
    readSliderOptions: readSliderOptions,
  };
})();
