/*!
 * slider-js
 * Kenneth D'silva (Modracx), Copyright (c) 2026
 * Licensed under the MIT License – https://opensource.org/licenses/MIT
 */
import {
  createSlider,
  clearSlider,
  getSlider,
  sliderDefaults,
} from "./slider.js";
import { attachNavigation, navigationDefaults } from "./navigation.js";
import { attachControls, controlDefaults } from "./controls.js";
import { AUTO_SELECTOR, autoTargets, readSliderOptions } from "./autoinit.js";
import { prefersReducedMotion } from "./core.js";

export {
  createSlider,
  clearSlider,
  getSlider,
  attachNavigation,
  attachControls,
  prefersReducedMotion,
  readSliderOptions,
  AUTO_SELECTOR,
  sliderDefaults,
  navigationDefaults,
  controlDefaults,
};

export const defaults = {
  ...sliderDefaults,
  ...navigationDefaults,
  ...controlDefaults,
};

/**
 * Build a carousel inside `container`, with navigation and interaction wired.
 * Any slider already on that container is torn down first.
 * Returns the controller: `.next()`, `.prev()`, `.goTo()`, `.destroy()`.
 */
export function create(container, options = {}) {
  const settings = { ...defaults, ...options };

  // Navigation must be attached before controls: the arrows and dots read
  // `autoplayRunning`, which the control layer defines on the controller.
  const controller = createSlider(container, settings);
  attachNavigation(controller, settings);
  attachControls(controller, settings);
  return controller;
}

/** Tear down the slider on `container` and restore its original DOM. */
export function clear(container) {
  clearSlider(container);
}

/**
 * Build a carousel on every `[data-slider]` element under `root`, reading its
 * options from data attributes. Already-initialised elements are skipped, so
 * this is safe to call again after inserting content.
 *
 *   <div data-slider data-slider-slides-per-view="3" data-slider-loop>
 *
 * Returns the controllers it created.
 */
export function autoInit(root) {
  return autoTargets(root, getSlider).map((el) =>
    create(el, readSliderOptions(el))
  );
}

const Slider = {
  create,
  clear,
  get: getSlider,
  autoInit,
  defaults,
  // granular control
  createSlider,
  clearSlider,
  attachNavigation,
  attachControls,
  // helpers
  prefersReducedMotion,
  readSliderOptions,
};

export default Slider;
