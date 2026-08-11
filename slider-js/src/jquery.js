/*!
 * slider-js/jquery — jQuery plugin wrapper
 * Kenneth D'silva (Modracx), Copyright (c) 2026
 * Licensed under the MIT License – https://opensource.org/licenses/MIT
 */
import { create, clear, autoInit } from "./index.js";
import { getSlider } from "./slider.js";

/** Methods that read from the first element instead of iterating the set. */
const READERS = {
  get: (el) => getSlider(el),
  index: (el) => {
    const c = getSlider(el);
    return c ? c.index : -1;
  },
  length: (el) => {
    const c = getSlider(el);
    return c ? c.length : 0;
  },
  page: (el) => {
    const c = getSlider(el);
    return c ? c.page : -1;
  },
};

/** Methods forwarded to the controller on every matched element. */
const ACTIONS = {
  next: (c) => c.next(),
  prev: (c) => c.prev(),
  goTo: (c, a) => c.goTo(a),
  goToPage: (c, a) => c.goToPage(a),
  update: (c) => c.update(),
};

/**
 * Register `$.fn.Slider` on a jQuery instance.
 * Call this yourself when jQuery is loaded from a CDN as a global instead of
 * being installed as a dependency.
 */
export function registerSliderPlugin($) {
  if (!$ || !$.fn) {
    throw new TypeError("slider-js/jquery: a jQuery instance is required");
  }

  $.fn.Slider = function (method, a) {
    if (READERS[method]) {
      return this.length ? READERS[method](this[0]) : null;
    }

    return this.each(function () {
      if (method === "create" || method === undefined) {
        create(this, a);
        return;
      }
      if (method === "clear" || method === "destroy") {
        clear(this);
        return;
      }
      if (ACTIONS[method]) {
        const controller = getSlider(this);
        if (!controller) {
          throw new Error(
            'slider-js: no slider on this element — call .Slider("create") first'
          );
        }
        ACTIONS[method](controller, a);
        return;
      }
      throw new Error(
        `slider-js: unknown method "${method}" — expected one of "create", ` +
          `"clear", ${Object.keys(ACTIONS).concat(Object.keys(READERS)).map((k) => `"${k}"`).join(", ")}`
      );
    });
  };

  // Also exposed as a plain object for callers that skip the plugin wrapper.
  $.Slider = { create, clear, get: getSlider, autoInit };

  return $;
}

// Auto-register against a global jQuery when one is present (CDN / script tag).
const globalJQuery =
  typeof window !== "undefined" ? window.jQuery || window.$ : undefined;

if (globalJQuery && globalJQuery.fn) {
  registerSliderPlugin(globalJQuery);
}

export default registerSliderPlugin;
