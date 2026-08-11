/*!
 * slider-js — shared internals
 * Kenneth D'silva (Modracx), Copyright (c) 2026
 * Licensed under the MIT License – https://opensource.org/licenses/MIT
 */

/** Teardown handle stashed on the container element. */
export const SLIDER_KEY = Symbol.for("slider-js.slider");

export function createElement(tag, style = {}) {
  const el = document.createElement(tag);
  Object.assign(el.style, style);
  return el;
}

export function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value;
}

/** Wrap `i` into [0, length). Handles negatives, unlike a bare `%`. */
export function wrapIndex(i, length) {
  if (!(length > 0)) return 0;
  return ((i % length) + length) % length;
}

/**
 * True when `el` renders right-to-left. In an RTL flex row the first child is
 * the rightmost one, which inverts both the measurement and the transform.
 */
export function isRTL(el) {
  if (typeof getComputedStyle !== "function") return false;
  return getComputedStyle(el).direction === "rtl";
}

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

export function prefersReducedMotion() {
  // matchMedia is missing in jsdom and old embedded webviews; assume motion is
  // fine there rather than silently refusing to animate.
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

/** Subscribe to reduced-motion changes. Returns an unsubscribe function. */
export function watchReducedMotion(callback) {
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
export function createEmitter() {
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
export function teardown(container, key) {
  if (container && container[key]) {
    container[key]();
    delete container[key];
  }
}
