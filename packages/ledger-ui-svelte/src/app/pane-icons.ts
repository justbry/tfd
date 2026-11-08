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
	card: [
		{ tag: "rect", x: 3, y: 5, width: 18, height: 14, rx: 2 },
		path("M3 10h18M7 15h3"),
	],
	cloud: [path("M7 18a4 4 0 01-.5-7.9A5.5 5.5 0 0117 9a4.5 4.5 0 01.5 9H7z")],
	/* The mockup's ellipse (12, 5, 8, 3) as the path the shapes can carry. */
	db: [
		path("M4 5a8 3 0 1016 0 8 3 0 10-16 0z"),
		path("M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"),
	],
	code: [path("M8 8l-5 4 5 4M16 8l5 4-5 4M14 4l-4 16")],
	dot: [circle(12, 12, 2)],
	download: [path("M12 4v11M7 10l5 5 5-5M5 20h14")],
	edit: [path("M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4")],
	ext: [
		path(
			"M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5",
		),
	],
	gift: [
		{ tag: "rect", x: 3, y: 8, width: 18, height: 4, rx: 0 },
		path("M12 8v13M5 12v9h14v-9M12 8c-2-4-6-3-5 0M12 8c2-4 6-3 5 0"),
	],
	heart: [
		path("M12 20s-8-5-8-11a4.5 4.5 0 018-2.8A4.5 4.5 0 0120 9c0 6-8 11-8 11z"),
	],
	mail: [
		{ tag: "rect", x: 3, y: 5, width: 18, height: 14, rx: 2 },
		path("M3 7l9 6 9-6"),
	],
	plug: [path("M9 3v5M15 3v5M6 8h12v3a6 6 0 01-12 0V8zM12 17v4")],
	more: [circle(5, 12, 1.6), circle(12, 12, 1.6), circle(19, 12, 1.6)],
	search: [circle(11, 11, 7), path("M21 21l-4.3-4.3")],
	ticket: [
		path(
			"M3 9a2 2 0 002-2V6h14v1a2 2 0 002 2v6a2 2 0 00-2 2v1H5v-1a2 2 0 00-2-2V9z",
		),
	],
	trash: [path("M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3")],
	undo: [path("M9 14L4 9l5-5"), path("M4 9h10a6 6 0 010 12h-3")],
	upload: [path("M12 16V4M7 9l5-5 5 5M5 20h14")],
} as const satisfies Record<string, readonly Shape[]>;

export type PaneIconName = IconName | keyof typeof paneShapes;

/** The icon is one of the panes' own (drawn from `paneShapes`), not the shell's. */
export const isPaneIcon = (
	name: PaneIconName,
): name is keyof typeof paneShapes => name in paneShapes;
