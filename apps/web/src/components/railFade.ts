// What fades as the sidebar narrows to its rail: labels, counts and second lines. They fade out
// over the first half of the collapse, then return over the second half of the expand, so text
// never clips mid-word. Without panel animations they snap with the width.
export const railFade =
  "[[data-panel-animations=true]_&]:transition-opacity [[data-panel-animations=true]_&]:duration-[calc(var(--panel-animation-duration)/2)] [[data-panel-animations=true]_&]:delay-[calc(var(--panel-animation-duration)/2)] group-data-[collapsible=icon]:opacity-0 group-data-[collapsible=icon]:[[data-panel-animations=true]_&]:delay-0";
