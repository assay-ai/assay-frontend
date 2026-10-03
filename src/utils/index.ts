import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * tailwind-merge has to be taught this design system's token names.
 *
 * Out of the box it groups classes by parsing their suffix against Tailwind's
 * stock scales. Our tokens come from the design file, so it cannot parse them,
 * and it falls back to treating every `text-*` as one group and every
 * `border-*` as another. The result is silent and destructive: in
 * `cn("bg-primary-500 text-on-color", "text-label-sm")` it decides the two
 * `text-` classes conflict and drops the colour, and in
 * `cn("border border-02")` it reads `border-02` as a width like `border-2` and
 * drops the real width, leaving a 1px border rendering at 0px.
 *
 * That is not hypothetical — it shipped. Every filled Button rendered
 * near-black text on its own accent instead of white, and every bordered
 * surface lost its border, while the source class strings looked correct and
 * the CSS for them existed. Teaching the groups here fixes all of it at once.
 *
 * Anything added to `fontSize`, `textColor`, `borderColor` or `backgroundColor`
 * in tailwind.config.js must be added here too, or it will be silently dropped
 * the first time it shares a prefix with another class on the same element.
 */

const FONT_SIZES = [
  "display-lg", "display-md",
  "heading-lg", "heading-md", "heading-sm",
  "label-md", "label-sm", "label-xs", "label-13",
  "body-md", "body-sm", "body-xs", "body-13",
  "mono-2xl", "mono-xl", "mono-md", "mono-sm", "mono-13", "mono-12", "mono-xs", "mono-2xs",
];

const RAMPS = ["primary", "success", "danger", "warning", "info", "teal", "indigo", "pink", "yellow", "lime"];
const RAMP_STEPS = ["5", "10", "20", "300", "400", "500", "600", "700"];
const RAMP_COLORS = RAMPS.flatMap((r) => [r, ...RAMP_STEPS.map((s) => `${r}-${s}`)]);
const CHART_COLORS = ["chart-1", "chart-2", "chart-3", "chart-4", "chart-5", "chart-6"];

const TEXT_COLORS = ["01", "02", "03", "inverse", "on-color", ...RAMP_COLORS, ...CHART_COLORS];
const BORDER_COLORS = ["01", "02", "03", ...RAMP_COLORS, ...CHART_COLORS];
const BG_COLORS = [
  "01", "02", "03", "04", "inverse",
  "text-01", "text-02", "text-03",
  "overlay-dark", "overlay-light",
  ...RAMP_COLORS, ...CHART_COLORS,
];

const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": FONT_SIZES.map((s) => `text-${s}`),
      "text-color": TEXT_COLORS.map((c) => `text-${c}`),
      "border-color": BORDER_COLORS.map((c) => `border-${c}`),
      "bg-color": BG_COLORS.map((c) => `bg-${c}`),
      shadow: ["shadow-hair", "shadow-soft", "shadow-lifted"],
      rounded: ["rounded-sm", "rounded-md", "rounded-lg", "rounded-xl", "rounded-full"],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
