// The frame every day chart on Overview shares, in pixels: the plot sits right of the value labels
// and above the date labels, across whatever width the chart is given.
export const CHART = { height: 196, left: 30, right: 6, top: 8, base: 166 } as const;

export const columnWidth = (count: number, width: number) => (width - CHART.left - CHART.right) / count;

// The centre of column `index` of `count`.
export const columnX = (index: number, count: number, width: number) => CHART.left + columnWidth(count, width) * (index + 0.5);

// Where `value` sits on a scale whose top gridline is `top`.
export const valueY = (value: number, top: number) => CHART.base - (value / top) * (CHART.base - CHART.top);
