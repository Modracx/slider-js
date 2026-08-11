/*!
 * slider-js/autoinit — declarative setup from data attributes
 * Kenneth D'silva (Modracx), Copyright (c) 2026
 * Licensed under the MIT License – https://opensource.org/licenses/MIT
 */

/** Elements carrying this attribute are picked up by autoInit(). */
export const AUTO_SELECTOR = "[data-slider]";

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
export function readSliderOptions(el) {
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
export function autoTargets(root, hasSlider) {
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
