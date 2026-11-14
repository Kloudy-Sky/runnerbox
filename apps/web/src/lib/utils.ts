// A stand-in of runnerbox's, not T3 Code's file: what the primitives copied from T3 Code import from
// `~/lib/utils`. Theirs also mints IDs for their threads and drafts, which runnerbox has no use for.
import { type CxOptions, cx } from "class-variance-authority";
import { extendTailwindMerge } from "tailwind-merge";

// Register T3 Code's extra font sizes and background images so tailwind-merge doesn't treat
// text-2xs or bg-composer-seam-below as colors.
const twMerge = extendTailwindMerge({
  extend: {
    theme: { text: ["2xs", "3xs", "4xs", "5xs"] },
    classGroups: { "bg-image": [{ bg: ["composer-seam-below", "composer-seam-above"] }] },
  },
});

// Joins class names, letting a later Tailwind class win over an earlier one for the same property.
export const cn = (...inputs: CxOptions) => twMerge(cx(inputs));

export const isMacPlatform = (platform: string) => /mac|iphone|ipad|ipod/i.test(platform);
export const isWindowsPlatform = (platform: string) => /^win(dows)?/i.test(platform);
