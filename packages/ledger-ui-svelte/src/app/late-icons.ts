import { type IconName, iconShapes, type Shape } from "./icons.ts";

/** The mockup's stroke icons that only the panes loaded on demand draw (the Preact package's `lateShapes`), beside the
 * shell's own in icons.ts, so that the first page load does not carry them. */
const path = (d: string): Shape => ({ tag: "path", d });
const circle = (cx: number, cy: number, r: number): Shape => ({
	tag: "circle",
	cx,
	cy,
	r,
});

export const lateShapes = {
	ban: [circle(12, 12, 9), path("M5.6 5.6l12.8 12.8")],
	code: [path("M8 8l-5 4 5 4M16 8l5 4-5 4M14 4l-4 16")],
	dot: [circle(12, 12, 2)],
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
	mail: [
		{ tag: "rect", x: 3, y: 5, width: 18, height: 14, rx: 2 },
		path("M3 7l9 6 9-6"),
	],
	plug: [path("M9 3v5M15 3v5M6 8h12v3a6 6 0 01-12 0V8zM12 17v4")],
	ticket: [
		path(
			"M3 9a2 2 0 002-2V6h14v1a2 2 0 002 2v6a2 2 0 00-2 2v1H5v-1a2 2 0 00-2-2V9z",
		),
	],
	trash: [path("M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3")],
	undo: [path("M9 14L4 9l5-5"), path("M4 9h10a6 6 0 010 12h-3")],
	upload: [path("M12 16V4M7 9l5-5 5 5M5 20h14")],
} satisfies Record<string, Shape[]>;

export type LateIconName = keyof typeof lateShapes;
export type PaneIconName = IconName | LateIconName;

export const shapesOf = (name: PaneIconName): Shape[] =>
	name in lateShapes
		? lateShapes[name as LateIconName]
		: iconShapes[name as IconName];
