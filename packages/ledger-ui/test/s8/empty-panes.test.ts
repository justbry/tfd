import { afterEach, expect, test } from "bun:test";
import type { Reader } from "../../src/data/reader.ts";
import { createFixtureReader } from "../../src/fixtures/reader.ts";
import { cleanUp, clock, count, open, text } from "../s5/helpers.ts";

/**
 * Never an empty pane (orchestrator report on staging, 2026-11-08). A demo school opens on its Dashboard, and each tab
 * it has no data for (Plans, Members, Bookings, Promos) says so, with links to the books tabs. Any pane whose read
 * rejects says why: "Not available yet" for `not_available` (no Try again: nothing provides it), else "Could not load"
 * with Try again, for real schools too.
 */
afterEach(cleanUp);

const base = createFixtureReader({ clock });
const failing = (kind: string): Error & { kind: string } =>
	Object.assign(new Error(kind), { kind });
const rejecting = (kind: string) => async (): Promise<never> => {
	throw failing(kind);
};
/** The fixtures with Vibes of Light (`vol`, the first school) as a demo school, or the second one. */
const withDemo = (demoId: string, changes: Partial<Reader> = {}): Reader => ({
	...base,
	...changes,
	schools: async () =>
		(await base.schools()).map((school) =>
			school.id === demoId ? { ...school, demo: true } : school,
		),
});
const noteText =
	"Demo schools show the books only: Dashboard, Ledger and Reports. Plans, Members, Bookings and Promos need a real school.";

test("a demo school opens on its Dashboard; a real school still opens on Plans", async () => {
	await open("#/vol", { reader: withDemo("vol") });
	expect(window.location.hash).toBe("#/vol/dashboard");
	expect(count("[data-test=demo-tab-note]")).toBe(0);
	cleanUp();
	await open("#/b4u", { reader: withDemo("vol") });
	expect(window.location.hash).toBe("#/b4u/plans");
	cleanUp();
	// the first school is the default one, on its own default tab
	await open("#/", { reader: withDemo("vol") });
	expect(window.location.hash).toBe("#/vol/dashboard");
});

test("each tab a demo school has no data for shows the demo note with links to the books tabs", async () => {
	for (const tab of ["plans", "members", "bookings", "promos"]) {
		await open(`#/vol/${tab}`, { reader: withDemo("vol") });
		expect({ tab, note: text("[data-test=demo-tab-note]") }).toEqual({
			tab,
			note: `${noteText}DashboardLedgerReports`,
		});
		expect(
			[
				...document.querySelectorAll<HTMLAnchorElement>(
					"[data-test=demo-tab-link]",
				),
			].map((link) => link.getAttribute("href")),
		).toEqual(["#/vol/dashboard", "#/vol/ledger", "#/vol/reports"]);
		cleanUp();
	}
});

test("a demo school's books tabs show their data, not the note", async () => {
	for (const tab of ["dashboard", "ledger", "reports"]) {
		await open(`#/vol/${tab}`, { reader: withDemo("vol") });
		expect({ tab, notes: count("[data-test=demo-tab-note]") }).toEqual({
			tab,
			notes: 0,
		});
		expect(document.querySelector("[data-test=pane]")?.textContent).not.toBe(
			"",
		);
		cleanUp();
	}
});

test("a real school's pane whose read is not available says so, with no Try again", async () => {
	const reader: Reader = {
		...base,
		menuVersions: rejecting("not_available"),
		people: rejecting("not_available"),
		bookings: rejecting("not_available"),
		promos: rejecting("not_available"),
	};
	for (const tab of ["plans", "members", "bookings", "promos"]) {
		await open(`#/vol/${tab}`, { reader });
		expect({
			tab,
			note: text("[data-test=not-available]").startsWith(
				"Not available yet: nothing provides",
			),
		}).toEqual({ tab, note: true });
		expect(
			document.querySelector("[data-test=pane]")?.textContent,
		).not.toContain("Try again");
		cleanUp();
	}
});

test("a pane whose read fails another way offers Try again, and reads again", async () => {
	let calls = 0;
	const reader: Reader = {
		...base,
		people: async (query) => {
			calls += 1;
			if (calls === 1) throw failing("unavailable");
			return base.people(query);
		},
	};
	await open("#/vol/members", { reader });
	const pane = document.querySelector("[data-test=pane]");
	expect(pane?.textContent).toContain("Could not load the members.");
	[...(pane?.querySelectorAll("button") ?? [])]
		.find((button) => button.textContent === "Try again")
		?.click();
	for (let attempt = 0; attempt < 100 && calls < 2; attempt += 1)
		await new Promise((resolve) => setTimeout(resolve, 0));
	expect(calls).toBe(2);
});

test("the Dashboard and the shell's audiences read say why they failed, never an empty pane", async () => {
	await open("#/vol/dashboard", {
		reader: { ...base, kpiDocument: rejecting("not_available") },
	});
	expect(text("[data-test=not-available]")).toBe(
		"Not available yet: nothing provides the dashboard here.",
	);
	cleanUp();
	await open("#/vol/ledger", {
		reader: { ...base, disclosure: rejecting("unavailable") },
	});
	expect(document.querySelector("[data-test=pane]")?.textContent).toContain(
		"Could not load the school's audiences.",
	);
});
