import {
	type IconName,
	iconShapes,
	registerIcons,
	type Shape,
} from "./icons.ts";

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
	clock: [circle(12, 12, 9), path("M12 7v5l3 2")],
	coin: [
		circle(12, 12, 9),
		path(
			"M14.5 9.2c-.5-.8-1.4-1.2-2.5-1.2-1.5 0-2.5.8-2.5 1.8 0 2.6 5 1.4 5 4 0 1-1 1.9-2.5 1.9-1.2 0-2.2-.5-2.7-1.4M12 6v2M12 16v2",
		),
	],
	key: [circle(8, 15, 4), path("M11 12l9-9M16 7l3 3")],
	lock: [
		{ tag: "rect", x: 5, y: 11, width: 14, height: 9, rx: 2 },
		path("M8 11V8a4 4 0 018 0v3"),
	],
	monitor: [
		{ tag: "rect", x: 3, y: 4, width: 18, height: 12, rx: 2 },
		path("M8 20h8M12 16v4"),
	],
	moon: [path("M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z")],
	plus: [path("M12 5v14M5 12h14")],
	scale: [
		path(
			"M12 3v18M5 21h14M5 7h14M5 7l-3 7a3 3 0 006 0L5 7zM19 7l-3 7a3 3 0 006 0l-3-7z",
		),
	],
	sliders: [
		path("M4 6h8M16 6h4M4 12h2M10 12h10M4 18h10M18 18h2"),
		circle(14, 6, 2),
		circle(8, 12, 2),
		circle(16, 18, 2),
	],
	sun: [
		circle(12, 12, 4),
		path(
			"M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4",
		),
	],
	unlock: [
		{ tag: "rect", x: 5, y: 11, width: 14, height: 9, rx: 2 },
		path("M8 11V8a4 4 0 017.5-2"),
	],
	user: [circle(12, 8, 3.5), path("M5 20c0-3.9 3.1-7 7-7s7 3.1 7 7")],

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
export type PaneIconName = IconName;

registerIcons(lateShapes);

export const shapesOf = (name: PaneIconName): Shape[] =>
	name in lateShapes
		? lateShapes[name as LateIconName]
		: ((iconShapes as Record<string, Shape[]>)[name] ?? []);
