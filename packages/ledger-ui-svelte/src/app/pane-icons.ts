import type { IconName, Shape } from "./icons.ts";

/** The mockup's icons (its `IC` table) that only the Bookings and Members panes draw, beside the shell's own
 * (icons.ts); the same shapes as packages/ledger-ui/src/app/icon.tsx. They load with the panes' chunks. */
const path = (d: string): Shape => ({ tag: "path", d });
const circle = (cx: number, cy: number, r: number): Shape => ({
	tag: "circle",
	cx,
	cy,
	r,
});

export const paneShapes = {
	ban: [circle(12, 12, 9), path("M5.6 5.6l12.8 12.8")],
	download: [path("M12 4v11M7 10l5 5 5-5M5 20h14")],
	ext: [
		path(
			"M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5",
		),
	],
	mail: [
		{ tag: "rect", x: 3, y: 5, width: 18, height: 14, rx: 2 },
		path("M3 7l9 6 9-6"),
	],
	more: [circle(5, 12, 1.6), circle(12, 12, 1.6), circle(19, 12, 1.6)],
	search: [circle(11, 11, 7), path("M21 21l-4.3-4.3")],
	ticket: [
		path(
			"M3 9a2 2 0 002-2V6h14v1a2 2 0 002 2v6a2 2 0 00-2 2v1H5v-1a2 2 0 00-2-2V9z",
		),
	],
	undo: [path("M9 14L4 9l5-5"), path("M4 9h10a6 6 0 010 12h-3")],
} as const satisfies Record<string, readonly Shape[]>;

export type PaneIconName = IconName | keyof typeof paneShapes;

/** The icon is one of the panes' own (drawn from `paneShapes`), not the shell's. */
export const isPaneIcon = (
	name: PaneIconName,
): name is keyof typeof paneShapes => name in paneShapes;
