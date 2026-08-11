/*!
 * slider-js/navigation — arrows, dot pagination and the live region
 * Kenneth D'silva (Modracx), Copyright (c) 2026
 * Licensed under the MIT License – https://opensource.org/licenses/MIT
 */
import { createElement } from "./core.js";

export const navigationDefaults = {
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
export function attachNavigation(controller, options = {}) {
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
