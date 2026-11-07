/** Where the toast stack sits (S9-plan section 5): top right on wide screens, just below the top bar so it never
 * covers the help and settings buttons; along the bottom on narrow ones. While a toast shows and the focused control
 * lies under the stack, the stack takes the other edge; with no toast, or nothing under it, it stays put. */

export type Box = { left: number; top: number; right: number; bottom: number };
export type Edge = "usual" | "other";

/** Wider than this, the stack is a column at the top right. */
const narrowWidth = 600;
const stackWidth = 360;
const wideInset = 12;
const narrowInset = 8;

const isNarrow = (viewportWidth: number): boolean =>
	viewportWidth <= narrowWidth;

/** The stack's box on its usual edge: `top` is where the top bar ends (wide), `height` the stack's own height. */
export function usualBox(
	viewport: { width: number; height: number },
	height: number,
	top: number,
): Box {
	if (isNarrow(viewport.width))
		return {
			left: narrowInset,
			right: viewport.width - narrowInset,
			bottom: viewport.height - narrowInset,
			top: viewport.height - narrowInset - height,
		};
	const right = viewport.width - wideInset;
	const width = Math.min(stackWidth, viewport.width - 2 * narrowInset);
	return { left: right - width, right, top, bottom: top + height };
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

/** The stack's inline position for an edge. */
export function positionStyle(
	edge: Edge,
	viewportWidth: number,
	top: number,
): string {
	if (isNarrow(viewportWidth))
		return edge === "usual"
			? `left:${narrowInset}px;right:${narrowInset}px;bottom:${narrowInset}px`
			: `left:${narrowInset}px;right:${narrowInset}px;top:${narrowInset}px`;
	return edge === "usual"
		? `right:${wideInset}px;top:${top}px;width:${stackWidth}px`
		: `right:${wideInset}px;bottom:${wideInset}px;width:${stackWidth}px`;
}
