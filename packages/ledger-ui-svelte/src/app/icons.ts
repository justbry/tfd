/** The mockup's stroke icons (its `IC` table) that the shell draws, as SVG elements on a 24-unit grid; the same shapes
 * as packages/ledger-ui/src/app/core-icon.tsx and icon.tsx. */
export type Shape =
	| { tag: "path"; d: string }
	| { tag: "circle"; cx: number; cy: number; r: number }
	| {
			tag: "rect";
			x: number;
			y: number;
			width: number;
			height: number;
			rx: number;
	  };

const path = (d: string): Shape => ({ tag: "path", d });
const circle = (cx: number, cy: number, r: number): Shape => ({
	tag: "circle",
	cx,
	cy,
	r,
});

export const iconShapes = {
	alert: [path("M12 4l9 16H3L12 4zM12 10v4M12 17h.01")],
	box: [path("M21 8l-9-5-9 5v8l9 5 9-5V8zM3 8l9 5 9-5M12 13v8")],
	building: [
		path("M4 21V7l8-4 8 4v14M9 21v-6h6v6M8 10h.01M12 10h.01M16 10h.01"),
	],
	calendar: [
		{ tag: "rect", x: 3, y: 5, width: 18, height: 16, rx: 2 },
		path("M3 10h18M8 3v4M16 3v4"),
	],
	chart: [path("M4 20V11M10 20V5M16 20v-6M2 20h20")],
	check: [path("M4 12l5 5L20 6")],
	clock: [circle(12, 12, 9), path("M12 7v5l3 2")],
	coin: [
		circle(12, 12, 9),
		path(
			"M14.5 9.2c-.5-.8-1.4-1.2-2.5-1.2-1.5 0-2.5.8-2.5 1.8 0 2.6 5 1.4 5 4 0 1-1 1.9-2.5 1.9-1.2 0-2.2-.5-2.7-1.4M12 6v2M12 16v2",
		),
	],
	chevronDown: [path("M6 9l6 6 6-6")],
	chevronLeft: [path("M15 6l-6 6 6 6")],
	chevronRight: [path("M9 6l6 6-6 6")],
	copy: [
		{ tag: "rect", x: 9, y: 9, width: 11, height: 11, rx: 2 },
		path("M5 15V5a2 2 0 012-2h8"),
	],
	eye: [
		path("M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"),
		circle(12, 12, 3),
	],
	gear: [
		path(
			"M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z",
		),
		circle(12, 12, 3),
	],
	help: [
		circle(12, 12, 9),
		path("M9.5 9.5a2.5 2.5 0 114 2c-.9.6-1.5 1-1.5 2M12 17h.01"),
	],
	info: [circle(12, 12, 9), path("M12 11v5M12 8h.01")],
	key: [circle(8, 15, 4), path("M11 12l9-9M16 7l3 3")],
	layers: [
		path("M12 3l9 5-9 5-9-5 9-5z"),
		path("M3 12.5l9 5 9-5"),
		path("M3 17l9 5 9-5"),
	],
	list: [path("M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01")],
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
	tag: [
		path("M20.6 13.4l-7.2 7.2a2 2 0 01-2.8 0L3 13V3h10l7.6 7.6a2 2 0 010 2.8z"),
		circle(7.5, 7.5, 1.3),
	],
	unlock: [
		{ tag: "rect", x: 5, y: 11, width: 14, height: 9, rx: 2 },
		path("M8 11V8a4 4 0 017.5-2"),
	],
	user: [circle(12, 8, 3.5), path("M5 20c0-3.9 3.1-7 7-7s7 3.1 7 7")],
	users: [
		circle(9, 8, 3.2),
		path("M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"),
		circle(17, 9, 2.4),
		path("M16 14.2c2.9.3 5 2.6 5 5.8"),
	],
	x: [path("M6 6l12 12M18 6L6 18")],
	xCircle: [circle(12, 12, 9), path("M9 9l6 6M15 9l-6 6")],
} satisfies Record<string, Shape[]>;

export type IconName = keyof typeof iconShapes;
