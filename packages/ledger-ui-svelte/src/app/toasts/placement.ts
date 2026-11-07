/** Where the toast stack sits (S9-plan section 5), inside the app's frame as the viewport shows it. Wide: top right,
 * just below the bars (the tabs row, or the top bar on All schools), so it never covers a tab or a top-bar button.
 * Narrow: along the frame's bottom. While a toast shows and the focused control lies under the stack, the stack takes
 * the other edge (wide: the frame's bottom right; narrow: just below the bars); with no toast, or nothing under it,
 * it stays put. */

export type Box = { left: number; top: number; right: number; bottom: number };
export type Edge = "usual" | "other";

/** The measures the stack is placed by: the viewport, the frame's visible part, where the bars end, its own height. */
export type Layout = {
	viewport: { width: number; height: number };
	frame: Box;
	barsBottom: number;
	height: number;
};

const narrowWidth = 600;
const stackWidth = 360;
const wideInset = 12;
const narrowInset = 8;
const belowBars = 8;

const isNarrow = ({ viewport }: Layout): boolean =>
	viewport.width <= narrowWidth;

const wideWidth = ({ frame }: Layout): number =>
	Math.min(stackWidth, frame.right - frame.left - 2 * narrowInset);

/** The part of `frame` inside the viewport. */
export const visiblePart = (
	frame: Box,
	viewport: { width: number; height: number },
): Box => ({
	left: Math.max(0, frame.left),
	top: Math.max(0, frame.top),
	right: Math.min(viewport.width, frame.right),
	bottom: Math.min(viewport.height, frame.bottom),
});

/** The stack's box on its usual edge. */
export function usualBox(layout: Layout): Box {
	const { frame, barsBottom, height } = layout;
	if (isNarrow(layout))
		return {
			left: frame.left + narrowInset,
			right: frame.right - narrowInset,
			bottom: frame.bottom - narrowInset,
			top: frame.bottom - narrowInset - height,
		};
	const right = frame.right - wideInset;
	const top = barsBottom + belowBars;
	return { left: right - wideWidth(layout), right, top, bottom: top + height };
}

const overlaps = (first: Box, second: Box): boolean =>
	first.left < second.right &&
	second.left < first.right &&
	first.top < second.bottom &&
	second.top < first.bottom;

/** The edge for the stack: the other one only while a toast shows over the focused control. */
export const edgeFor = (options: {
	toastCount: number;
	focused: Box | null;
	usual: Box;
}): Edge =>
	options.toastCount > 0 &&
	options.focused !== null &&
	overlaps(options.focused, options.usual)
		? "other"
		: "usual";

/** The stack's `position: fixed` offsets for an edge. */
export function positionStyle(edge: Edge, layout: Layout): string {
	const { viewport, frame, barsBottom } = layout;
	const fromRight = (inset: number) => viewport.width - frame.right + inset;
	const fromBottom = (inset: number) => viewport.height - frame.bottom + inset;
	if (isNarrow(layout)) {
		const sides = `left:${frame.left + narrowInset}px;right:${fromRight(narrowInset)}px`;
		return edge === "usual"
			? `${sides};bottom:${fromBottom(narrowInset)}px`
			: `${sides};top:${barsBottom + belowBars}px`;
	}
	const sides = `right:${fromRight(wideInset)}px;width:${wideWidth(layout)}px`;
	return edge === "usual"
		? `${sides};top:${barsBottom + belowBars}px`
		: `${sides};bottom:${fromBottom(wideInset)}px`;
}
