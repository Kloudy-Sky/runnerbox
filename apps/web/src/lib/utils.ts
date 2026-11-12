import { type CxOptions, cx } from "class-variance-authority";
import { twMerge } from "tailwind-merge";

// Joins class names, letting a later Tailwind class win over an earlier one for the same property.
export const cn = (...inputs: CxOptions) => twMerge(cx(inputs));
