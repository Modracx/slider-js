#!/usr/bin/env node
/*!
 * slider-js build — generates the standalone script-tag builds from src/.
 *
 * The ES modules in slider-js/src are written so they can be concatenated:
 * imports only ever appear at the top of a file, exports are only ever
 * `export function` / `export const` declarations, and every top-level name is
 * unique across the whole source tree. Stripping the module syntax and joining
 * the files in dependency order therefore produces valid script.
 *
 * Run: node build.mjs
 */
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const src = join(root, "slider-js", "src");

/** Dependency order. core has no imports; index composes all the layers. */
const MODULES = [
  "core.js",
  "slider.js",
  "navigation.js",
  "controls.js",
  "autoinit.js",
];

/** Drop the module syntax, keep the declarations. */
function stripModuleSyntax(code) {
  return (
    code
      // `import { a, b } from "./x.js";`, including multi-line forms
      .replace(/^import\s[\s\S]*?from\s*["'][^"']+["'];?[ \t]*$/gm, "")
      // `export function f(` / `export const x =` -> keep the declaration
      .replace(/^export\s+(?=(?:async\s+)?(?:function|const|let|var|class)\b)/gm, "")
      // `export { a, b };` re-export lists
      .replace(/^export\s*\{[\s\S]*?\}\s*;?[ \t]*$/gm, "")
      // `export default X;`
      .replace(/^export\s+default\s[\s\S]*?;[ \t]*$/gm, "")
      .trim()
  );
}

/** Strip the `/*! ... *\/` banner; the bundle carries its own. */
function stripBanner(code) {
  return code.replace(/^\/\*![\s\S]*?\*\/\s*/, "");
}

async function loadBody() {
  const parts = [];
  for (const name of MODULES) {
    const raw = await readFile(join(src, name), "utf8");
    const body = stripModuleSyntax(stripBanner(raw));
    parts.push(
      `  /* ---------------------------------------------------------------- *\n` +
        `   * ${name}\n` +
        `   * ---------------------------------------------------------------- */\n\n` +
        body
          .split("\n")
          .map((line) => (line.trim() ? "  " + line : ""))
          .join("\n")
    );
  }
  return parts.join("\n\n");
}

const SHARED_COMPOSE = `
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
`;

const VANILLA_TAIL = `
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
`;

const JQUERY_TAIL = `
  const READERS = {
    get: function (el) {
      return getSlider(el);
    },
    index: function (el) {
      const c = getSlider(el);
      return c ? c.index : -1;
    },
    length: function (el) {
      const c = getSlider(el);
      return c ? c.length : 0;
    },
    page: function (el) {
      const c = getSlider(el);
      return c ? c.page : -1;
    },
  };

  const ACTIONS = {
    next: function (c) {
      c.next();
    },
    prev: function (c) {
      c.prev();
    },
    goTo: function (c, a) {
      c.goTo(a);
    },
    goToPage: function (c, a) {
      c.goToPage(a);
    },
    update: function (c) {
      c.update();
    },
  };

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
        'slider-js: unknown method "' + method + '" — expected one of "create", ' +
          '"clear", ' +
          Object.keys(ACTIONS)
            .concat(Object.keys(READERS))
            .map(function (k) {
              return '"' + k + '"';
            })
            .join(", ")
      );
    });
  };

  // Also exposed as a plain object for callers that skip the plugin wrapper.
  $.Slider = {
    create: create,
    clear: clear,
    get: getSlider,
    autoInit: autoInit,
    defaults: defaults,
    createSlider: createSlider,
    clearSlider: clearSlider,
    attachNavigation: attachNavigation,
    attachControls: attachControls,
    prefersReducedMotion: prefersReducedMotion,
    readSliderOptions: readSliderOptions,
  };
})(jQuery);
`;

function banner(title, note) {
  return (
    `/*!\n` +
    ` * ${title}\n` +
    ` * Kenneth D'silva (Modracx), Copyright (c) 2026\n` +
    ` * Licensed under the MIT License – https://opensource.org/licenses/MIT\n` +
    ` *\n` +
    ` * ${note}\n` +
    ` * GENERATED FROM slider-js/src BY build.mjs — DO NOT EDIT BY HAND.\n` +
    ` */\n`
  );
}

const body = await loadBody();

await writeFile(
  join(root, "vanilla", "slider-vanilla.js"),
  banner(
    "vanilla js slider — content carousel / slideshow",
    "Standalone script-tag build. Attaches window.Slider."
  ) +
    "(function () {\n" +
    body +
    "\n" +
    SHARED_COMPOSE +
    VANILLA_TAIL,
  "utf8"
);

await writeFile(
  join(root, "jquery", "slider-jquery.js"),
  banner(
    "jQuery slider — content carousel / slideshow",
    "Standalone script-tag build. Registers $.fn.Slider."
  ) +
    "(function ($) {\n" +
    body +
    "\n" +
    SHARED_COMPOSE +
    JQUERY_TAIL,
  "utf8"
);

console.log("built vanilla/slider-vanilla.js and jquery/slider-jquery.js");
