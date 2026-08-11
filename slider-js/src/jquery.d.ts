/*!
 * slider-js/jquery — type definitions
 * Kenneth D'silva (Modracx), Copyright (c) 2026
 * Licensed under the MIT License – https://opensource.org/licenses/MIT
 */
import type { Options, SliderController } from "./index.js";

declare global {
  interface JQuery {
    Slider(method: "create", options?: Options): JQuery;
    Slider(method: "clear" | "destroy"): JQuery;
    Slider(method: "next" | "prev" | "update"): JQuery;
    Slider(method: "goTo" | "goToPage", value: number): JQuery;
    Slider(method: "get"): SliderController | null;
    Slider(method: "index" | "length" | "page"): number;
  }
}

export declare function registerSliderPlugin<T>($: T): T;
export default registerSliderPlugin;
