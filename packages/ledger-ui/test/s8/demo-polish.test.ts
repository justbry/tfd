import { afterEach, expect, test } from "bun:test";
import { h } from "preact";
import { mountApp } from "../../src/app/mount.tsx";
import type { Reader } from "../../src/data/reader.ts";
import { createFixtureReader } from "../../src/fixtures/reader.ts";
import { createFixtureWriter } from "../../src/fixtures/writer.ts";
import { DemoBanner } from "../../src/http/demo-banner.tsx";
import { cleanUp, clock, count, open, settle, text } from "../s5/helpers.ts";

/**
 * Staging review, 2026-11-07. The demo alert is pinned top right (`http/demo-banner.tsx`), so the demo note's links to
 * the books tabs sit on their own line under its text, at the left, never at the note's right end under the alert. A
 * demo school is read-only, so Reports has no "Edit in school settings"; a real school's admin still has it.
 * happy-dom has no layout: the note's tests assert the structure that puts the links at the left.
 */
let unmount: (() => void) | null = null;
afterEach(() => {
	unmount?.();
	unmount = null;
	cleanUp();
});

const base = createFixtureReader({ clock });
/** The fixtures with Vibes of Light (`vol`, the first school) as a demo school. */
const withDemo: Reader = {
	...base,
	schools: async () =>
		(await base.schools()).map((school) =>
			school.id === "vol" ? { ...school, demo: true } : school,
		),
};

/** The app as the HTTP build shows it signed out: the demo schools under the open demo alert. */
const openUnderAlert = async (hash: string): Promise<void> => {
	window.location.hash = hash;
	const container = document.createElement("div");
	container.id = "app";
	document.body.append(container);
	unmount = mountApp(container, {
		reader: withDemo,
		writer: createFixtureWriter({ mode: "instant" }),
		clock,
		banner: h(DemoBanner, {
			reason: "signed_out",
			signInUrl: "https://staging.b4uni.com/sign-in",
			reload: () => undefined,
		}),
	}).unmount;
	await settle();
};

const links = (): HTMLAnchorElement[] => [
	...document.querySelectorAll<HTMLAnchorElement>("[data-test=demo-tab-link]"),
];

test("with the demo alert open, the note's links sit on their own line under its text, at the left", async () => {
	for (const tab of ["plans", "members", "bookings", "promos"]) {
		await openUnderAlert(`#/vol/${tab}`);
		expect(count("[data-test=demo-banner]")).toBe(1);
		const note = document.querySelector<HTMLElement>(
			"[data-test=demo-tab-note]",
		);
		const row = document.querySelector<HTMLElement>(
			"[data-test=demo-tab-links]",
		);
		expect({ tab, row: row?.textContent }).toEqual({
			tab,
			row: "DashboardLedgerReports",
		});
		// No spacer pushes anything to the note's right end, where the alert is.
		expect(note?.querySelectorAll(".sp").length).toBe(0);
		// The row is a block under the text, not an item of the note's own flex row beside it.
		expect(row?.parentElement?.parentElement).toBe(note);
		expect(row?.previousElementSibling?.textContent).toStartWith(
			"Demo schools show the books only",
		);
		expect(row?.style.display).toBe("flex");
		expect(row?.style.justifyContent).toBe("");
		expect(row?.style.marginLeft).toBe("");
		expect(links().every((link) => link.parentElement === row)).toBe(true);
		unmount?.();
		unmount = null;
		cleanUp();
	}
});

test("with the demo alert open, each of the note's links opens its tab", async () => {
	for (const [index, tab] of ["dashboard", "ledger", "reports"].entries()) {
		await openUnderAlert("#/vol/plans");
		const link = links()[index];
		expect(link?.getAttribute("href")).toBe(`#/vol/${tab}`);
		link?.click();
		await settle();
		expect(window.location.hash).toBe(`#/vol/${tab}`);
		expect(count("[data-test=demo-tab-note]")).toBe(0);
		unmount?.();
		unmount = null;
		cleanUp();
	}
});

test("a demo school's Reports has no Edit in school settings; a real school's admin has it", async () => {
	await open("#/vol/reports", { reader: withDemo });
	expect(count("[data-test=report-rules]")).toBe(1);
	expect(count("[data-test=report-rules-edit]")).toBe(0);
	cleanUp();
	await open("#/vol/reports");
	expect(text("[data-test=report-rules-edit]")).toBe("Edit in school settings");
});
