import { afterEach, expect, test } from "bun:test";
import { h } from "preact";
import { mountApp } from "../../src/app/mount.tsx";
import type { Reader } from "../../src/data/reader.ts";
import { createFixtureReader } from "../../src/fixtures/reader.ts";
import { createFixtureWriter } from "../../src/fixtures/writer.ts";
import { DemoBanner } from "../../src/http/demo-banner.tsx";
import { cleanUp, clock, count, open, settle, text } from "../s5/helpers.ts";

/**
 * Staging review, 2026-11-07. The demo alert is pinned top right (`http/demo-banner.tsx`), so nothing of the demo note
 * sits at its right end under the alert. Since the demo schools' buzz-school reads come from the Worker's `demo-api`
 * answers, only Promos shows the note. A demo school is read-only, so Reports has no "Edit in school settings"; a real
 * school's admin still has it.
 */
let unmount: (() => void) | null = null;
const closeApp = (): void => {
	unmount?.();
	unmount = null;
	cleanUp();
};
afterEach(closeApp);

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

test("with the demo alert open, Promos shows the demo note, and Plans, Members and Bookings their panes", async () => {
	await openUnderAlert("#/vol/promos");
	expect(count("[data-test=demo-banner]")).toBe(1);
	const note = document.querySelector<HTMLElement>("[data-test=demo-tab-note]");
	expect(note?.textContent).toBe(
		"Not available for demo schools: the demo scenarios hold no promo or gift events.",
	);
	// No spacer pushes anything to the note's right end, where the alert is.
	expect(note?.querySelectorAll(".sp").length).toBe(0);
	closeApp();
	for (const tab of ["plans", "members", "bookings"]) {
		await openUnderAlert(`#/vol/${tab}`);
		expect({ tab, notes: count("[data-test=demo-tab-note]") }).toEqual({
			tab,
			notes: 0,
		});
		closeApp();
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
