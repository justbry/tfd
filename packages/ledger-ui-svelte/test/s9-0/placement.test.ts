import { describe, expect, test } from "bun:test";
import {
	type Box,
	edgeFor,
	type Layout,
	positionStyle,
	usualBox,
	visiblePart,
} from "../../src/app/toasts/placement.ts";

/** The app frame at 1100 px (1px in from each side, 780 tall) with its tabs row ending at y 87. */
const wide: Layout = {
	viewport: { width: 1100, height: 900 },
	frame: { left: 0, top: 0, right: 1100, bottom: 780 },
	barsBottom: 87,
	height: 60,
};
/** At 390 px the frame (780 tall) ends above the viewport's bottom (900). */
const narrow: Layout = {
	viewport: { width: 390, height: 900 },
	frame: { left: 0, top: 0, right: 390, bottom: 780 },
	barsBottom: 123,
	height: 50,
};
const helpButton: Box = { left: 1017, right: 1049, top: 9, bottom: 41 };
const reportsTab: Box = { left: 645, right: 727, top: 50, bottom: 87 };

describe("the toast stack's place", () => {
	test("wide: top right, below the tabs row, clear of every tab and top-bar button", () => {
		const box = usualBox(wide);
		expect(box).toEqual({ left: 728, right: 1088, top: 95, bottom: 155 });
		expect(box.top).toBeGreaterThan(reportsTab.bottom);
		expect(edgeFor({ toastCount: 1, focused: helpButton, usual: box })).toBe(
			"usual",
		);
		expect(edgeFor({ toastCount: 1, focused: reportsTab, usual: box })).toBe(
			"usual",
		);
		expect(positionStyle("usual", wide)).toBe(
			"right:12px;width:360px;top:95px",
		);
		expect(positionStyle("other", wide)).toBe(
			"right:12px;width:360px;bottom:132px",
		);
	});
	test("narrow: along the frame's bottom, not the viewport's", () => {
		expect(usualBox(narrow)).toEqual({
			left: 8,
			right: 382,
			top: 722,
			bottom: 772,
		});
		expect(positionStyle("usual", narrow)).toBe(
			"left:8px;right:8px;bottom:128px",
		);
		expect(positionStyle("other", narrow)).toBe("left:8px;right:8px;top:131px");
	});
	test("the frame is clipped to the viewport", () => {
		expect(
			visiblePart(
				{ left: -5, top: -200, right: 1200, bottom: 1400 },
				{ width: 1100, height: 900 },
			),
		).toEqual({ left: 0, top: 0, right: 1100, bottom: 900 });
	});
	test("with no toast it never moves, whatever has focus", () => {
		const under: Box = { left: 900, right: 1000, top: 100, bottom: 130 };
		expect(
			edgeFor({ toastCount: 0, focused: under, usual: usualBox(wide) }),
		).toBe("usual");
	});
	test("a toast over the focused control sends the stack to the other edge", () => {
		const under: Box = { left: 900, right: 1000, top: 100, bottom: 130 };
		expect(
			edgeFor({ toastCount: 1, focused: under, usual: usualBox(wide) }),
		).toBe("other");
		expect(
			edgeFor({ toastCount: 1, focused: null, usual: usualBox(wide) }),
		).toBe("usual");
	});
});
