import { afterEach, describe, expect, test } from "bun:test";
import { Layer } from "effect";
import { flushSync } from "svelte";
import type { KpiDocument } from "$contract/data/kpi-document.ts";
import type { Reader as ReaderContract } from "$contract/data/reader.ts";
import type { Writer as WriterContract } from "$contract/data/writer.ts";
import { createFixtureReader } from "$contract/fixtures/reader.ts";
import { createFixtureWriter } from "$contract/fixtures/writer.ts";
import { AdapterError } from "$contract/http/errors.ts";
import { leavesOutNote } from "../../src/app/all-schools-model.ts";
import { type MountedApp, mountApp } from "../../src/app/mount.ts";
import { chunks } from "../../src/app/Shell.svelte";
import { appLayer } from "../../src/effect/app-layer.ts";
import { manualClock } from "../../src/effect/clock.ts";
import { memoryLog } from "../../src/effect/log.ts";
import type { LogEntry } from "../../src/effect/services.ts";
import { click, query, queryAll, textOf, until } from "../app-harness.ts";
import { calendar, noConfig } from "../helpers.ts";

/** The Dashboard's states the golden file does not reach: a missing figure or document, a failed read, View as and
 * the period limits it brings, the preview banner, a refused PIN, and All schools' figures per viewer. */
let mounted: MountedApp | undefined;
afterEach(async () => {
	await mounted?.unmount();
	mounted = undefined;
});

/** The app's log in the last `open`, for the tests that check nothing was written. */
let logEntries: () => readonly LogEntry[] = () => [];

/** Mounts the app at `hash` over the fixture adapters, either changed by the test, and waits for the route. */
async function open(
	hash: string,
	change: {
		reader?: (fixture: ReaderContract) => ReaderContract;
		writer?: (fixture: WriterContract) => WriterContract;
		waitForRoute?: boolean;
	} = {},
): Promise<HTMLElement> {
	document.body.innerHTML = '<div id="app"></div>';
	document.documentElement.className = "";
	window.history.replaceState(null, "", `/${hash}`);
	const root = document.getElementById("app") as HTMLElement;
	const reader = createFixtureReader({ clock: calendar });
	const writer = createFixtureWriter({ mode: "instant" });
	const log = memoryLog();
	logEntries = log.entries;
	mounted = mountApp(root, {
		layer: Layer.mergeAll(
			appLayer({
				reader: change.reader?.(reader) ?? reader,
				writer: change.writer?.(writer) ?? writer,
				config: noConfig,
				clockLayer: manualClock().layer,
			}),
			log.layer,
		),
		calendar,
	});
	if (change.waitForRoute !== false)
		await until(
			() => root.dataset.route === window.location.hash,
			"the route to render",
		);
	return root;
}

const withSeries = (
	document: KpiDocument,
	keep: (kpi: string) => boolean,
): KpiDocument => ({
	...document,
	tables: Object.fromEntries(
		Object.entries(document.tables).map(([grain, table]) => [
			grain,
			{
				...table,
				series: Object.fromEntries(
					Object.entries(table.series).filter(([kpi]) => keep(kpi)),
				),
			},
		]),
	),
});

describe("a missing figure is never 0", () => {
	test("a document without its series reads Not computed in every card, on every view", async () => {
		const root = await open("#/vol/dashboard", {
			reader: (fixture) => ({
				...fixture,
				kpiDocument: async (asked) => {
					const found = await fixture.kpiDocument(asked);
					return found && withSeries(found, () => false);
				},
			}),
		});
		for (const view of ["money", "members", "risk"]) {
			click(`[data-test=dash-view][data-view=${view}]`);
			await until(
				() => root.dataset.route === window.location.hash,
				`the ${view} view`,
			);
			const values = queryAll("[data-test=kpi-value]");
			expect(values.length).toBeGreaterThan(3);
			for (const value of values) {
				expect(value.dataset.cell).toBe("not_computed");
				expect(value.textContent?.trim()).toBe("Not computed");
			}
			const text = root.textContent ?? "";
			expect(/\$0\.00|\b0 granted/.test(text)).toBe(false);
		}
		click("[data-test=dash-view][data-view=money]");
		await until(
			() => query("svg[aria-label^='Gross by day']") !== null,
			"days",
		);
		expect(queryAll("[data-day]")).toEqual([]);
	});
	test("a hidden figure's bar is not drawn, and its row says why", async () => {
		await open(
			"#/b4u/dashboard?preset=monthly-members&as=governance&view=money&month=2026-06",
		);
		const fund = query(
			'[data-kpi="donations_by_fund:building-fund"][data-period="2026-06"]',
		);
		expect(fund?.textContent?.trim()).toBe("—");
		expect(fund?.dataset.cell).toBe("suppressed");
		expect(fund?.closest("div")?.querySelector("i")).toBeNull();
	});
	test("no document for the view: Not available, and the route is on screen", async () => {
		const root = await open("#/vol/dashboard", {
			reader: (fixture) => ({ ...fixture, kpiDocument: async () => undefined }),
		});
		expect(textOf("[data-test=dash-missing]")).toContain("Not available");
		expect(queryAll("[data-test=kpi-card]")).toEqual([]);
		expect(root.dataset.route).toBe("#/vol/dashboard");
	});
});

describe("a failed document read", () => {
	test("is retried, then shows its message in place and in a toast; Retry shows the document", async () => {
		let calls = 0;
		const root = await open("#/vol/dashboard", {
			reader: (fixture) => ({
				...fixture,
				kpiDocument: (asked) => {
					calls += 1;
					return calls <= 3
						? Promise.reject(new AdapterError("network", "offline"))
						: fixture.kpiDocument(asked);
				},
			}),
		});
		expect(calls).toBe(3);
		expect(textOf("[data-test=load-failed]")).toContain("No connection");
		expect(textOf("[data-test=toast-title]")).toBe("No connection");
		expect(textOf("[data-test=toast-action]")).toBe("Retry");
		expect(root.dataset.route).toBe("#/vol/dashboard");
		click("[data-test=load-retry]");
		await until(
			() => queryAll("[data-test=kpi-card]").length === 5,
			"the cards",
		);
		expect(query("[data-test=load-failed]")).toBeNull();
		await until(
			() => queryAll("[data-test=toast]").length === 0,
			"the toast to leave",
		);
	});
});

describe("a read the Dashboard no longer wants", () => {
	test("leaving the PIN-locked document while its read retries stops the retries, with no toast and no log entry", async () => {
		let lockedCalls = 0;
		const root = await open(
			"#/b4u/dashboard?preset=monthly-members&as=governance&view=money&month=2026-06",
			{
				reader: (fixture) => ({
					...fixture,
					kpiDocument: (asked) => {
						if (!asked.pinLocked) return fixture.kpiDocument(asked);
						lockedCalls += 1;
						return Promise.reject(new AdapterError("network", "offline"));
					},
				}),
			},
		);
		click("[data-test=pin-chip]");
		expect(window.location.hash).toContain("pin=locked");
		await until(
			() => textOf("[data-test=toasts]").includes("Retrying"),
			"the retry toast",
			1000,
		);
		// The unlocked document stays on screen while the locked one loads: its chip takes the PIN off again.
		click("[data-test=pin-chip]");
		const callsAtCancel = lockedCalls;
		expect(window.location.hash).not.toContain("pin=");
		// Well inside the retries' backoff (at least 320 ms): only an aborted read lets its retry toast go this soon.
		const turnsInsideTheBackoff = 30;
		await until(
			() =>
				root.dataset.route === window.location.hash &&
				queryAll("[data-test=toast]").length === 0,
			"the unlocked document and the retry toast to leave",
			turnsInsideTheBackoff,
		);
		// Longer than the retries' backoff: a read that kept going would try again, and fail with a toast.
		await new Promise((resolve) => setTimeout(resolve, 1500));
		flushSync();
		expect(lockedCalls).toBe(callsAtCancel);
		expect(queryAll("[data-test=toast]")).toEqual([]);
		expect(query("[data-test=load-failed]")).toBeNull();
		expect(logEntries()).toEqual([]);
		expect(queryAll("[data-test=kpi-card]")).toHaveLength(5);
	});
	test("unlocking leaves no retry toast and logs nothing", async () => {
		const root = await open(
			"#/b4u/dashboard?preset=monthly-members&as=finance&pin=locked&view=money&month=2026-06",
		);
		const input = query<HTMLInputElement>("[data-test=pin-input]");
		if (!input) throw new Error("no PIN field");
		input.value = "1234";
		input.dispatchEvent(new Event("input", { bubbles: true }));
		flushSync();
		click("[data-test=pin-unlock]");
		await until(
			() =>
				!window.location.hash.includes("pin=") &&
				root.dataset.route === window.location.hash,
			"the books",
		);
		expect(textOf("[data-test=toasts]")).not.toContain("Retrying");
		expect(logEntries()).toEqual([]);
	});
});

describe("View as", () => {
	test("lists the rows, the viewer's own marked, the ones not held disabled", async () => {
		await open("#/har/dashboard");
		click("[data-test=view-as]");
		await until(
			() => queryAll("[data-test=view-as-option]").length === 6,
			"the rows",
		);
		expect(
			queryAll("[data-test=view-as-name]").map((name) =>
				name.textContent?.trim(),
			),
		).toEqual([
			"Owner",
			"Finance admin",
			"Admin (you)",
			"Governance",
			"Member",
			"Public",
		]);
		expect(
			queryAll("[data-test=view-as-option]")
				.filter((row) => (row as HTMLButtonElement).disabled)
				.map((row) => row.dataset.as),
		).toEqual(["owner", "finance", "governance"]);
		expect(
			query("[data-test=view-as-option][aria-selected=true]")?.dataset.as,
		).toBe("admin");
		expect(
			(query("[data-test=view-as-later]") as HTMLButtonElement).disabled,
		).toBe(true);
	});
	test("a row the audience's periods do not hold snaps the period, says so, and shows the preview banner", async () => {
		const root = await open("#/b4u/dashboard");
		click("[data-test=view-as]");
		await until(
			() => query("[data-test=view-as-option][data-as=public]") !== null,
			"the rows",
		);
		click("[data-test=view-as-option][data-as=public]");
		await until(
			() => root.dataset.route === window.location.hash,
			"the public document",
		);
		expect(window.location.hash).toBe(
			"#/b4u/dashboard?as=public&month=2024-01-01..2024-12-31",
		);
		expect(textOf("[data-test=view-as]")).toBe("View as Public");
		expect(textOf("[data-test=dash-period][aria-pressed=true]")).toBe("2024");
		await until(
			() => textOf("[data-test=toast-title]") !== "",
			"the period toast",
		);
		expect(textOf("[data-test=toast-title]")).toBe("Period changed to 2024");
		expect(textOf("[data-test=toast-detail]")).toBe("Public sees years");
		expect(textOf("[data-test=preview-banner]")).toBe(
			"Preview: this is what Public sees. You are Finance admin. Writes are off. Exit preview",
		);
		click("[data-test=preview-exit]");
		expect(window.location.hash).toBe(
			"#/b4u/dashboard?month=2024-01-01..2024-12-31",
		);
		expect(query("[data-test=preview-banner]")).toBeNull();
	});
	test("another audience's document loading never shows the one before under the new banner", async () => {
		let release: () => void = () => undefined;
		const publicHeld = new Promise<void>((resolve) => {
			release = resolve;
		});
		let publicAsked = 0;
		const root = await open("#/b4u/dashboard", {
			reader: (fixture) => ({
				...fixture,
				kpiDocument: async (asked) => {
					if (asked.audience === "public") {
						publicAsked += 1;
						await publicHeld;
					}
					return fixture.kpiDocument(asked);
				},
			}),
		});
		await until(() => publicAsked > 0, "Public's document read ahead");
		expect(queryAll("[data-test=kpi-card]")).toHaveLength(5);
		click("[data-test=view-as]");
		await until(
			() => query("[data-test=view-as-option][data-as=public]") !== null,
			"the rows",
		);
		click("[data-test=view-as-option][data-as=public]");
		try {
			for (let turn = 0; turn < 10; turn += 1) {
				await new Promise((resolve) => setTimeout(resolve, 5));
				flushSync();
				expect(textOf("[data-test=preview-banner]")).toContain(
					"Preview: this is what Public sees.",
				);
				expect(queryAll("[data-test=kpi-card]").length).toBe(0);
				expect(queryAll("[data-test=dash-period]").length).toBe(0);
				expect(query("[data-test=dash-loading]")).not.toBeNull();
				expect(root.dataset.route).not.toBe(window.location.hash);
			}
		} finally {
			release();
		}
		await until(
			() => root.dataset.route === window.location.hash,
			"the public document",
		);
		expect(query("[data-test=dash-loading]")).toBeNull();
		expect(textOf("[data-test=dash-period][aria-pressed=true]")).toBe("2024");
	});
	test("Admin's banner says whose books it shows", async () => {
		await open("#/b4u/dashboard?as=admin");
		expect(textOf("[data-test=preview-banner]")).toContain(
			"Their books follow their own membership: shown as Member.",
		);
		expect(textOf("[data-test=dash-period][aria-pressed=true]")).toBe(
			"Q2 2026",
		);
	});
});

describe("the period control under View as", () => {
	test("offers what the viewed audience may pick, and says why not", async () => {
		await open("#/b4u/dashboard?as=member");
		expect(query("[data-test=period-button]")?.getAttribute("aria-label")).toBe(
			"Period: Q2 2026",
		);
		click("[data-test=period-button]");
		await until(() => query("[data-test=period-note]") !== null, "the panel");
		expect(textOf("[data-test=period-note]")).toBe(
			"Previewing Member: quarters only. One period for Dashboard, Reports, Ledger and Members.",
		);
		const thisMonth = queryAll("[data-test=period-option]").find((option) =>
			option.textContent?.includes("This month"),
		) as HTMLButtonElement;
		expect(thisMonth.disabled).toBe(true);
		expect(thisMonth.title).toBe(
			"Governance and up see this: Members see quarters",
		);
		expect(thisMonth.textContent).toContain("—");
		expect(queryAll("[data-test=period-chip]")).toHaveLength(8);
		const q3 = query<HTMLButtonElement>(
			"[data-test=period-chip][data-period=2026-Q3]",
		);
		expect(q3?.disabled).toBe(true);
		expect(q3?.title).toBe("Published after 18 Nov 2026");
		expect(textOf("[data-test=period-custom-note]")).toBe(
			"Days show to finance admins and the owner. Members see quarters.",
		);
		expect(query("input[aria-label=From]")).toBeNull();
		expect(query<HTMLButtonElement>("[data-test=period-next]")?.disabled).toBe(
			true,
		);
		click("[data-test=period-chip][data-period=2025-Q4]");
		expect(window.location.hash).toBe(
			"#/b4u/dashboard?as=member&month=2025-10-01..2025-12-31",
		);
	});
	test("a live audience may pick any period and a custom range", async () => {
		await open("#/b4u/dashboard");
		click("[data-test=period-button]");
		await until(() => query("[data-test=period-note]") !== null, "the panel");
		expect(textOf("[data-test=period-note]")).toBe(
			"Finance admin: months and days, live. One period for Dashboard, Reports, Ledger and Members.",
		);
		expect(
			queryAll("[data-test=period-option]").every(
				(option) => !(option as HTMLButtonElement).disabled,
			),
		).toBe(true);
		expect(queryAll("[data-test=period-chip]")).toEqual([]);
		expect(query("input[aria-label=From]")).not.toBeNull();
	});
});

describe("the PIN prompt", () => {
	test("a wrong PIN stays at the field and empties it", async () => {
		await open(
			"#/b4u/dashboard?preset=monthly-members&as=governance&pin=locked&view=money&month=2026-06",
			{
				writer: (fixture) => ({
					...fixture,
					unlockBooks: async () => ({ unlocked: false, reason: "pin_wrong" }),
				}),
			},
		);
		const input = query<HTMLInputElement>("[data-test=pin-input]");
		if (!input) throw new Error("no PIN field");
		input.value = "1234";
		input.dispatchEvent(new Event("input", { bubbles: true }));
		flushSync();
		click("[data-test=pin-unlock]");
		await until(() => textOf("[data-test=inline-error]") !== "", "the refusal");
		expect(textOf("[data-test=inline-error]")).toBe(
			"That is not your family PIN. Try again.",
		);
		expect(input.value).toBe("");
		expect(input.getAttribute("aria-invalid")).toBe("true");
		expect(query("[data-test=pin-lock]")).not.toBeNull();
		expect(window.location.hash).toContain("pin=locked");
	});
	test("a failed check is a toast and its text at the field", async () => {
		await open(
			"#/b4u/dashboard?preset=monthly-members&as=governance&pin=locked&view=money&month=2026-06",
			{
				writer: (fixture) => ({
					...fixture,
					unlockBooks: () =>
						Promise.reject(
							new AdapterError("pin_locked", "locked", {
								retryAfterSeconds: 120,
							}),
						),
				}),
			},
		);
		const input = query<HTMLInputElement>("[data-test=pin-input]");
		if (!input) throw new Error("no PIN field");
		input.value = "1234";
		input.dispatchEvent(new Event("input", { bubbles: true }));
		flushSync();
		click("[data-test=pin-unlock]");
		await until(
			() => textOf("[data-test=toast-title]") !== "",
			"the failure toast",
		);
		expect(textOf("[data-test=toast-title]")).toBe("Too many PIN tries");
		expect(textOf("[data-test=inline-error]")).toBe(
			"Too many PIN tries. Wait 2 minutes, then try again.",
		);
	});
	test("unlocking opens the books with a toast", async () => {
		const unlocks: Array<[string, string]> = [];
		const root = await open(
			"#/b4u/dashboard?preset=monthly-members&as=finance&pin=locked&view=money&month=2026-06",
			{
				writer: (fixture) => ({
					...fixture,
					unlockBooks: (schoolId, pin) => {
						unlocks.push([schoolId, pin]);
						return fixture.unlockBooks(schoolId, pin);
					},
				}),
			},
		);
		const input = query<HTMLInputElement>("[data-test=pin-input]");
		if (!input) throw new Error("no PIN field");
		input.value = "1234";
		input.dispatchEvent(new Event("input", { bubbles: true }));
		flushSync();
		click("[data-test=pin-unlock]");
		await until(
			() =>
				!window.location.hash.includes("pin=") &&
				root.dataset.route === window.location.hash,
			"the books",
		);
		expect(unlocks).toEqual([["b4u", "1234"]]);
		expect(queryAll("[data-test=kpi-card]")).toHaveLength(5);
		await until(
			() => textOf("[data-test=toast-title]") !== "",
			"the success toast",
		);
		expect(textOf("[data-test=toast-title]")).toBe(
			"Books unlocked for this session.",
		);
	});
});

describe("All schools", () => {
	const cellOf = (school: string, column: string): string =>
		textOf(
			`[data-test=all-schools-row][data-school=${school}] [data-column=${column}]`,
		);
	test("shows each school's figures to the viewer they may show to, and totals per currency", async () => {
		await open("#/all/all");
		await until(() => cellOf("har", "income") !== "…Loading", "the figures");
		await until(
			() => !textOf("[data-test=all-schools]").includes("Loading"),
			"every figure",
		);
		expect(
			["vol", "b4u", "map", "nw", "har"].map((school) => [
				cellOf(school, "outstanding"),
				cellOf(school, "income"),
			]),
		).toEqual([
			["63 sessions", "$287.00"],
			["65 credits", "$90.00"],
			["25 classes", "C$85.00"],
			["0 classes", "$0.00"],
			["20 credits", "Finance admins and the owner see this"],
		]);
		expect(textOf("[data-test=all-schools-total] [data-column=income]")).toBe(
			"$377.00 + C$85.00 Leaves out schools whose income you do not see",
		);
		expect(textOf("[data-test=income-heading]")).toBe("Income · Nov 2026");
	});
	test("a school whose read fails says not available and toasts; the others show", async () => {
		await open("#/all/all", {
			reader: (fixture) => ({
				...fixture,
				membersSummary: (asked) =>
					asked.schoolId === "map"
						? Promise.reject(
								new AdapterError("not_found", "404", { status: 404 }),
							)
						: fixture.membersSummary(asked),
			}),
		});
		await until(
			() => !textOf("[data-test=all-schools]").includes("Loading"),
			"every figure",
		);
		expect(cellOf("map", "outstanding")).toBe(
			"Not available: Not found. This item is gone or was never here.",
		);
		expect(cellOf("vol", "outstanding")).toBe("63 sessions");
		expect(textOf("[data-test=toast-title]")).toBe("Not found");
		expect(textOf("[data-test=all-schools-total] [data-column=income]")).toBe(
			"$377.00 Leaves out schools that did not load and schools whose income you do not see",
		);
	});
	test("a school that did not load is the total's only reason when every other income shows", async () => {
		await open("#/all/all", {
			reader: (fixture) => ({
				...fixture,
				disclosure: (schoolId) =>
					schoolId === "har"
						? Promise.reject(
								new AdapterError("not_found", "404", { status: 404 }),
							)
						: fixture.disclosure(schoolId),
			}),
		});
		await until(
			() => !textOf("[data-test=all-schools]").includes("Loading"),
			"every figure",
		);
		expect(cellOf("har", "income")).toBe(
			"Not available: Not found. This item is gone or was never here.",
		);
		expect(textOf("[data-test=all-schools-total] [data-column=income]")).toBe(
			"$377.00 + C$85.00 Leaves out schools that did not load",
		);
	});
	test("the total's note names each reason a school is left out", () => {
		expect(leavesOutNote({ notLoaded: false, hidden: false }, true)).toBeNull();
		expect(leavesOutNote({ notLoaded: true, hidden: false }, true)).toBe(
			"Leaves out schools that did not load",
		);
		expect(leavesOutNote({ notLoaded: false, hidden: true }, true)).toBe(
			"Leaves out schools whose income you do not see",
		);
		expect(leavesOutNote({ notLoaded: true, hidden: true }, true)).toBe(
			"Leaves out schools that did not load and schools whose income you do not see",
		);
		expect(leavesOutNote({ notLoaded: true, hidden: true }, false)).toBe(
			"Not shown",
		);
	});
	test("every school failing the same way is one toast, and its Retry reads the table again", async () => {
		let failing = true;
		await open("#/all/all", {
			reader: (fixture) => ({
				...fixture,
				membersSummary: (asked) =>
					failing
						? Promise.reject(new AdapterError("network", "offline"))
						: fixture.membersSummary(asked),
			}),
		});
		await until(
			() => !textOf("[data-test=all-schools]").includes("Loading"),
			"every figure",
		);
		await until(
			() => textOf("[data-test=toast-action]") === "Retry",
			"the failure toast",
			1000,
		);
		expect(queryAll("[data-test=toast]")).toHaveLength(1);
		expect(textOf("[data-test=toast-title]")).toBe("No connection");
		expect(cellOf("har", "outstanding")).toStartWith("Not available");
		failing = false;
		click("[data-test=toast-action]");
		await until(
			() => cellOf("har", "outstanding") === "20 credits",
			"the retry",
		);
		await until(
			() => queryAll("[data-test=toast]").length === 0,
			"the toast to leave",
		);
	});
	test("the income follows the period", async () => {
		await open("#/all/all?month=2026-10");
		await until(
			() => !textOf("[data-test=all-schools]").includes("Loading"),
			"every figure",
		);
		expect(textOf("[data-test=income-heading]")).toBe("Income · Oct 2026");
		expect(cellOf("vol", "income")).toBe("$310.00");
		expect(cellOf("map", "income")).toBe("C$210.00");
	});
});

describe("the Dashboard's chunk", () => {
	test("failing to load shows its message with Retry and the route on screen; Retry loads it", async () => {
		const load = chunks.dashboard;
		let tries = 0;
		chunks.dashboard = () => {
			tries += 1;
			return tries === 1
				? Promise.reject(
						new TypeError("Failed to fetch dynamically imported module"),
					)
				: load();
		};
		try {
			const root = await open("#/vol/dashboard");
			expect(query("[data-test=load-failed]")).not.toBeNull();
			expect(root.dataset.route).toBe("#/vol/dashboard");
			click("[data-test=load-retry]");
			await until(
				() => queryAll("[data-test=kpi-card]").length === 5,
				"the cards",
			);
			expect(query("[data-test=load-failed]")).toBeNull();
			expect(tries).toBe(2);
		} finally {
			chunks.dashboard = load;
		}
	});
});
