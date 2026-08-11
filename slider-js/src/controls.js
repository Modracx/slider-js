/*!
 * slider-js/controls — swipe, keyboard and autoplay
 * Kenneth D'silva (Modracx), Copyright (c) 2026
 * Licensed under the MIT License – https://opensource.org/licenses/MIT
 */

import { createElement } from "./core.js";

export const controlDefaults = {
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
export function attachControls(controller, options = {}) {
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
