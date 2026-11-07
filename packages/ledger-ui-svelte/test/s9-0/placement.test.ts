import { describe, expect, test } from "bun:test";
import {
	type Box,
	edgeFor,
	positionStyle,
	usualBox,
} from "../../src/app/toasts/placement.ts";

const wide = { width: 1100, height: 900 };
const narrow = { width: 390, height: 900 };
const helpButton: Box = { left: 1017, right: 1049, top: 9, bottom: 41 };

describe("the toast stack's place", () => {
	test("wide: top right, below the top bar, clear of the help and settings buttons", () => {
		const box = usualBox(wide, 60, 58);
		expect(box).toEqual({ left: 728, right: 1088, top: 58, bottom: 118 });
		expect(edgeFor({ toastCount: 1, focused: helpButton, usual: box })).toBe(
			"usual",
		);
		expect(positionStyle("usual", wide.width, 58)).toBe(
			"right:12px;top:58px;width:360px",
		);
	});
	test("narrow: along the bottom", () => {
		expect(usualBox(narrow, 50, 58)).toEqual({
			left: 8,
			right: 382,
			top: 842,
			bottom: 892,
		});
		expect(positionStyle("usual", narrow.width, 58)).toBe(
			"left:8px;right:8px;bottom:8px",
		);
		expect(positionStyle("other", narrow.width, 58)).toBe(
			"left:8px;right:8px;top:8px",
		);
	});
	test("with no toast it never moves, whatever has focus", () => {
		const box = usualBox(wide, 0, 58);
		const under: Box = { left: 900, right: 1000, top: 50, bottom: 90 };
		expect(edgeFor({ toastCount: 0, focused: under, usual: box })).toBe(
			"usual",
		);
	});
	test("a toast over the focused control sends the stack to the other edge", () => {
		const box = usualBox(wide, 60, 58);
		const under: Box = { left: 900, right: 1000, top: 70, bottom: 100 };
		expect(edgeFor({ toastCount: 1, focused: under, usual: box })).toBe(
			"other",
		);
		expect(edgeFor({ toastCount: 1, focused: null, usual: box })).toBe("usual");
	});
});
