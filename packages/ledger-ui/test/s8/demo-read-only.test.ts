import { afterEach, expect, test } from "bun:test";
import type { Reader } from "../../src/data/reader.ts";
import { createFixtureReader } from "../../src/fixtures/reader.ts";
import { cleanUp, click, clock, count, open } from "../s5/helpers.ts";

/**
 * Staging review, 2026-11-08. A demo school refuses every write (`demo_read_only`), so it shows no control that would
 * write: no Confirm attended or No-show on Bookings; no Edit, Add, pencils or Review and publish on Plans; none of
 * the member drawer's money buttons or the menu's writes on Members; no change in the member's view; and the settings
 * drawer says it is read-only instead of offering its sections. A real school still has every one of them.
 */
afterEach(cleanUp);

/** The fixtures with `id` as a demo school. */
const demoReader = (id: string): Reader => {
	const base = createFixtureReader({ clock });
	return {
		...base,
		schools: async () =>
			(await base.schools()).map((school) =>
				school.id === id ? { ...school, demo: true } : school,
			),
	};
};

/** How many of each selector the page shows, on the real school and then on the same school as a demo school. */
const countBoth = async (
	hash: string,
	selectors: string[],
	school: string,
	then?: () => Promise<void>,
): Promise<{ real: number[]; demo: number[]; notes: number }> => {
	const counts = () => selectors.map((selector) => count(selector));
	await open(hash);
	await then?.();
	const real = counts();
	cleanUp();
	await open(hash, { reader: demoReader(school) });
	await then?.();
	const demo = counts();
	const notes = count("[data-test=demo-read-only]");
	return { real, demo, notes };
};

const none = (selectors: string[]): number[] => selectors.map(() => 0);

test("Bookings: no Confirm attended, No-show or other row write on a demo school", async () => {
	const selectors = [
		"[data-test=booking-action][data-action=confirm]",
		"[data-test=booking-action][data-action=noshow]",
		"[data-test=booking-action]",
	];
	const { real, demo, notes } = await countBoth(
		"#/vol/bookings",
		selectors,
		"vol",
	);
	for (const shown of real) expect(shown).toBeGreaterThan(0);
	expect(demo).toEqual(none(selectors));
	expect(count("[data-test=booking-bulk]")).toBe(0);
	expect(notes).toBe(1);
});

test("Plans: no Edit, Add membership, Add pack, pencils or Review and publish on a demo school", async () => {
	const selectors = [
		"[data-test=plan-mode][data-mode=edit]",
		"[data-test=plan-add][data-kind=tiers]",
		"[data-test=plan-add][data-kind=addons]",
		"[data-test=plan-edit]",
		"[data-test=plan-review]",
		"[data-test=plan-mode]",
	];
	const { real, demo, notes } = await countBoth(
		"#/vol/plans",
		selectors,
		"vol",
	);
	for (const shown of real) expect(shown).toBeGreaterThan(0);
	expect(demo).toEqual(none(selectors));
	expect(notes).toBe(1);
	expect(count("[data-test=plan-setup], [data-test=plan-discard]")).toBe(0);
	// The note sits at the toolbar's left, clear of the demo alert pinned top right: no spacer pushes it right.
	expect(
		document
			.querySelector("[data-test=demo-read-only]")
			?.parentElement?.querySelector(".sp"),
	).toBeNull();
	// The plans are still listed.
	expect(count("[data-test=plan-row]")).toBeGreaterThan(0);
	// A row opens nothing.
	await click("[data-test=plan-row]");
	expect(count("[data-test=plan-drawer]")).toBe(0);
});

test("Members: the drawer has no money buttons and no booking writes on a demo school", async () => {
	const selectors = [
		"[data-test=drawer-action][data-action=invoice]",
		"[data-test=drawer-action][data-action=adjust]",
		"[data-test=drawer-action][data-action=refund]",
	];
	const { real, demo, notes } = await countBoth(
		"#/vol/members?member=m_012",
		selectors,
		"vol",
	);
	for (const shown of real) expect(shown).toBeGreaterThan(0);
	expect(demo).toEqual(none(selectors));
	expect(count("[data-test=drawer-booking] [data-test=booking-action]")).toBe(
		0,
	);
	expect(count("[data-test=drawer-action][data-action=view-as-member]")).toBe(
		1,
	);
	expect(notes).toBe(1);
});

test("Members: a demo school's ⋯ menu lists only what reads", async () => {
	const actions = (): string[] =>
		[
			...document.querySelectorAll<HTMLElement>("[data-test=member-menu-item]"),
		].map((item) => item.dataset.action ?? "");
	const openMenu = () => click("[data-test=member-menu-button]");
	await open("#/vol/members");
	await openMenu();
	const real = actions();
	cleanUp();
	await open("#/vol/members", { reader: demoReader("vol") });
	await openMenu();
	const demo = actions();
	expect(real).toContain("refund");
	expect(real.length).toBeGreaterThan(demo.length);
	for (const action of demo)
		expect(["view-as-member", "csv", "stripe"]).toContain(action);
	expect(demo).toContain("view-as-member");
	// No separator at either end or two in a row.
	const menu = document.querySelector("[role=menu]");
	expect(menu?.firstElementChild?.tagName).not.toBe("HR");
	expect(menu?.lastElementChild?.tagName).not.toBe("HR");
	expect(menu?.querySelectorAll("hr + hr").length).toBe(0);
});

test("the member's view: no Change amount, Cancel membership or Cancel booking on a demo school", async () => {
	const selectors = [
		"[data-test=portal-action][data-action=quantity]",
		"[data-test=portal-action][data-action=cancel], [data-test=portal-action][data-action=resume]",
	];
	const { real, demo } = await countBoth(
		"#/b4u/members?portal=s_21",
		selectors,
		"b4u",
	);
	for (const shown of real) expect(shown).toBeGreaterThan(0);
	expect(demo).toEqual(none(selectors));
	expect(count("[data-test=portal-plan]")).toBe(1);
});

test("the settings drawer: a demo school says read-only and offers no setting to change", async () => {
	const selectors = [
		"[data-test=basis-save]",
		"[data-test=key-revoke]",
		"[data-test=key-create]",
		"[data-test=stripe-connect]",
		"[data-test=zeffy-connect]",
	];
	const { real, demo } = await countBoth("#/vol/plans", selectors, "vol", () =>
		click("[data-test=settings-button]"),
	);
	for (const shown of real) expect(shown).toBeGreaterThan(0);
	expect(demo).toEqual(none(selectors));
	expect(count("[data-test=settings-demo]")).toBe(1);
	expect(count("[data-test=settings-school]")).toBe(1);
});
