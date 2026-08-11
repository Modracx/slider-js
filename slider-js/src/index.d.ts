/*!
 * slider-js — type definitions
 * Kenneth D'silva (Modracx), Copyright (c) 2026
 * Licensed under the MIT License – https://opensource.org/licenses/MIT
 */

export type Effect = "slide" | "fade";

export type PauseButtonPosition =
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right";

/** The subset of options a breakpoint may override. */
export interface ResponsiveOverrides {
  slidesPerView?: number | "auto";
  slidesPerGroup?: number;
  spaceBetween?: number;
  speed?: number;
}

export interface MoveOptions {
  /** Jump with no transition. */
  instant?: boolean;
  /** Emit "change" even if the index did not actually change. */
  force?: boolean;
}

export interface SliderOptions {
  /** Slides visible at once. A number (fractional is fine) or "auto". Default 1. */
  slidesPerView?: number | "auto";
  /** Slides advanced by next() / prev(). Default 1. */
  slidesPerGroup?: number;
  /** Px between slides. Default 0. */
  spaceBetween?: number;
  /** Slide index to open on. Default 0. */
  initialSlide?: number;
  /** Wrap around past the ends by cloning slides at both edges. Default false. */
  loop?: boolean;
  /** Transition duration in ms. Default 350. */
  speed?: number;
  /** CSS timing function for the transition. */
  easing?: string;
  /** "slide" moves a track; "fade" cross-fades stacked slides. Default "slide". */
  effect?: Effect;
  /**
   * Layout overrides per minimum viewport width, mobile-first. Only
   * `slidesPerView`, `slidesPerGroup`, `spaceBetween` and `speed` may vary.
   *
   *   breakpoints: { 640: { slidesPerView: 2 }, 1024: { slidesPerView: 4 } }
   */
  breakpoints?: Record<number, ResponsiveOverrides> | null;
  /** Re-measure when the container or its slides resize. Default true. */
  observeResize?: boolean;
  /** Jump instead of animating under reduced motion. Default true. */
  respectReducedMotion?: boolean;
}

export interface NavigationOptions {
  /** Render previous/next buttons. Default true. */
  arrows?: boolean;
  /** Render a dot per page. Default true. */
  dots?: boolean;
  /** Accessible names for the arrows. */
  arrowLabels?: { prev: string; next: string };
  /** Builds a dot's accessible name. */
  dotLabel?: (page: number, pages: number) => string;
  /** Announce the active slide to screen readers. Default true. */
  announce?: boolean;
}

export interface ControlOptions {
  /** Swipe/drag between slides. Default true. */
  draggable?: boolean;
  /** Px dragged before it counts as a swipe. Default 5. */
  dragThreshold?: number;
  /** Fraction of a slide that must be dragged to advance. Default 0.25. */
  dragRatio?: number;
  /** Px/second above which a release always advances. Default 400. */
  flickVelocity?: number;
  /** Arrow keys move between slides once focused. Default true. */
  keyboard?: boolean;
  /** Advance every N ms. 0 disables. Default 0. */
  autoplay?: number | false;
  /**
   * What autoplay does at the last slide of a non-looping carousel.
   * Default "stop".
   */
  autoplayEndBehavior?: "stop" | "rewind";
  /** Stop autoplay for good on the first interaction. Default true. */
  autoplayStopOnInteraction?: boolean;
  /**
   * Ms before autoplay resumes after an interaction. Only consulted when
   * `autoplayStopOnInteraction` is false. Default 0.
   */
  autoplayResumeDelay?: number;
  /** Render an accessible play/pause button for autoplay. Default false. */
  showPauseButton?: boolean;
  /** Corner for that button. Default "bottom-right". */
  pauseButtonPosition?: PauseButtonPosition;
  /** Accessible names for the two button states. */
  pauseButtonLabels?: { pause: string; play: string };
  /** Render a progress bar counting down to the next advance. Default false. */
  showProgress?: boolean;
  /** Thickness of that bar, in px. Default 3. */
  progressHeight?: number;
  /** Colour of that bar. */
  progressColor?: string;
  /** Hold autoplay while hovered. Default true. */
  pauseOnHover?: boolean;
  /** Hold autoplay while focused. Default true. */
  pauseOnFocus?: boolean;
  /** Hold autoplay while hidden or offscreen. Default true. */
  pauseOnHidden?: boolean;
}

export type Options = SliderOptions & NavigationOptions & ControlOptions;

export interface ChangeEvent {
  index: number;
  previous: number;
  controller: SliderController;
}

export type SliderEvent =
  | "change"
  | "update"
  | "breakpoint"
  | "transitionEnd"
  | "reducedMotion"
  | "pause"
  | "resume";

export interface SliderController {
  readonly container: HTMLElement;
  readonly track: HTMLElement;
  readonly settings: Required<Options>;

  /** The real slides, in order, excluding loop clones. */
  readonly slides: HTMLElement[];
  readonly length: number;
  /** Active slide index, always within [0, length). */
  readonly index: number;
  /** Raw position, which sits outside [0, length) mid-loop. */
  readonly rawPosition: number;
  /** Highest reachable index. Below length-1 when several slides fit. */
  readonly lastIndex: number;
  readonly canGoPrev: boolean;
  readonly canGoNext: boolean;
  readonly pages: number;
  readonly page: number;

  next(opts?: MoveOptions): SliderController;
  prev(opts?: MoveOptions): SliderController;
  goTo(index: number, opts?: MoveOptions): SliderController;
  goToPage(page: number, opts?: MoveOptions): SliderController;

  /** Re-measure after adding, removing or restyling slides. */
  update(): SliderController;
  addSlide(el: Element): SliderController;
  removeSlide(el: Element): boolean;

  on(event: SliderEvent, fn: (payload: any) => void): () => void;

  /** Live finger offset used by the drag layer. */
  setDragOffset(px: number): SliderController;
  readonly dragOffset: number;
  /** Width of one step, for turning a drag distance into slides. */
  readonly stepSize: number;

  /** Named pause reasons, shared with the autoplay layer. */
  pause(reason?: string): void;
  resume(reason?: string): void;
  readonly paused: boolean;
  readonly pausedBy: string[];
  /** Defined by the control layer; true while the autoplay timer is running. */
  readonly autoplayRunning?: boolean;

  /** True when transitions are being skipped for reduced motion. */
  readonly reducedMotion: boolean;
  /** True between a move starting and its transition settling. */
  readonly transitioning: boolean;
  /** Minimum width of the breakpoint in force, or null below them all. */
  readonly activeBreakpoint: number | null;

  addCleanup(fn: () => void): SliderController;
  destroy(): void;
}

export declare const sliderDefaults: Required<SliderOptions>;
export declare const navigationDefaults: Required<NavigationOptions>;
export declare const controlDefaults: Required<ControlOptions>;
export declare const defaults: Required<Options>;

export declare function create(
  container: HTMLElement,
  options?: Options
): SliderController;
export declare function clear(container: HTMLElement): void;

export declare function createSlider(
  container: HTMLElement,
  options?: SliderOptions
): SliderController;
export declare function clearSlider(container: HTMLElement): void;
export declare function getSlider(
  container: HTMLElement
): SliderController | null;

export declare function attachNavigation(
  controller: SliderController,
  options?: NavigationOptions
): () => void;
export declare function attachControls(
  controller: SliderController,
  options?: ControlOptions
): () => void;

export declare function prefersReducedMotion(): boolean;

/** Selector picked up by autoInit(). */
export declare const AUTO_SELECTOR: string;

/**
 * Read slider options from an element's `data-slider` JSON and its individual
 * `data-slider-*` attributes, which override the JSON.
 */
export declare function readSliderOptions(el: Element): Options;

/**
 * Build a carousel on every `[data-slider]` element under `root`, skipping any
 * that already have one. Returns the controllers it created.
 */
export declare function autoInit(root?: ParentNode): SliderController[];

declare const Slider: {
  create: typeof create;
  clear: typeof clear;
  get: typeof getSlider;
  autoInit: typeof autoInit;
  defaults: Required<Options>;
  createSlider: typeof createSlider;
  clearSlider: typeof clearSlider;
  attachNavigation: typeof attachNavigation;
  attachControls: typeof attachControls;
  prefersReducedMotion: typeof prefersReducedMotion;
  readSliderOptions: typeof readSliderOptions;
};

export default Slider;
