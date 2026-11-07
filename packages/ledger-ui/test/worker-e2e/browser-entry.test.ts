import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { render } from "preact";
import { mountHttpApp } from "../../src/http/browser.ts";
import type { LedgerSchoolClaim } from "../../src/http/ledger-token.ts";
import {
	apiBase,
	fakeBuzzSchool,
	harness,
	harnessTimeoutMilliseconds,
	type LedgerHarness,
} from "./worker-harness.ts";

/**
 * The HTTP build's entry (`mountHttpApp`, what `VITE_LEDGER_SOURCE=http` mounts) on the real Worker: the browser's
 * `fetch` is stood in for by buzz-school's fake and the harness, and the entry is given the Worker's base as
 * `VITE_LEDGER_WORKER_BASE` would give it. Not the Vite bundle itself: building it and serving it on an `http:` page
 * (happy-dom refuses `http:` fetches from an `https:` page) costs more than it proves beyond this. The entry reads the
 * system clock once, at the mount; it is the harness's clock here, so the books open on the seeded data's month.
 */

const owned = "monthly-members";
const financeAdmin = "disputes";
let worker: LedgerHarness;
const skip = typeof harness === "string";

beforeAll(async () => {
	if (typeof harness === "string") return;
	worker = await harness.startLedgerWorker({ presets: [owned, financeAdmin] });
}, harnessTimeoutMilliseconds);
afterAll(async () => {
	await worker?.stop();
});

const macrotask = (): Promise<void> =>
	new Promise((resolve) => setTimeout(resolve, 0));
const renderAttempts = 800;
const digit = /\d/;

/** Mounts the HTTP build for `grants` on `#/<school>/<tab>`, as the browser would. */
async function mounted(grants: LedgerSchoolClaim[], school: string) {
	const buzzSchool = fakeBuzzSchool(worker, grants);
	const browserFetch = globalThis.fetch;
	globalThis.fetch = ((url: string, init: RequestInit) =>
		buzzSchool.fetch(String(url), init ?? {})) as typeof fetch;
	const root = document.createElement("div");
	root.id = "app";
	document.body.appendChild(root);
	window.location.hash = `#/${school}/dashboard`;
	const systemNow = Date.now;
	Date.now = () => Date.parse(worker.clock.now());
	try {
		mountHttpApp(root, { apiBase, workerBase: `${worker.url}/v1` });
	} finally {
		Date.now = systemNow;
	}
	/** Waits until the shell has put the tab's data on screen. */
	const shown = async (tab: string): Promise<void> => {
		const prefix = `#/${school}/${tab}`;
		for (
			let attempt = 0;
			attempt < renderAttempts && !root.dataset.route?.startsWith(prefix);
			attempt += 1
		)
			await macrotask();
		expect(root.dataset.route ?? "").toStartWith(prefix);
	};
	const open = async (tab: string): Promise<void> => {
		root.removeAttribute("data-route");
		window.location.hash = `#/${school}/${tab}`;
		window.dispatchEvent(new HashChangeEvent("hashchange"));
		await shown(tab);
	};
	const close = (): void => {
		render(null, root);
		root.remove();
		globalThis.fetch = browserFetch;
		window.location.hash = "";
	};
	return { root, buzzSchool, shown, open, close };
}

const kpiValues = (root: HTMLElement): string[] =>
	[...root.querySelectorAll("[data-test=kpi-card] [data-test=kpi-value]")].map(
		(value) => value.textContent?.trim() ?? "",
	);

describe.skipIf(skip)("the HTTP build's entry on the real Worker", () => {
	for (const [label, grant] of [
		["an owner", { id: owned, role: "owner", finance: true }],
		["a finance admin", { id: financeAdmin, role: "admin", finance: true }],
	] as const)
		test(`${label}: the Dashboard's KPI cells show figures and the Ledger lists rows`, async () => {
			const app = await mounted([grant], grant.id);
			try {
				await app.shown("dashboard");
				expect(app.buzzSchool.workerCalls).toContain("/v1/schools");
				expect(app.buzzSchool.workerCalls).toContain(
					`/v1/schools/${grant.id}/disclosure`,
				);
				// The switcher shows the school as buzz-school's ledger/school names it.
				expect(app.root.textContent ?? "").toContain(`School ${grant.id}`);
				const values = kpiValues(app.root);
				expect(values.length).toBeGreaterThan(0);
				expect(
					values.filter((value) => digit.test(value)).length,
				).toBeGreaterThan(0);
				await app.open("ledger");
				expect(
					app.root.querySelectorAll("[data-test=ledger-row]").length,
				).toBeGreaterThan(0);
				expect(app.root.querySelector("[data-test=lock-panel]")).toBeNull();
			} finally {
				app.close();
			}
		});

	test("an admin without the finance grant: the public document, the plan and books locks, and no finer read", async () => {
		const app = await mounted(
			[{ id: owned, role: "admin", finance: false }],
			owned,
		);
		try {
			await app.shown("dashboard");
			expect(kpiValues(app.root).length).toBeGreaterThan(0);
			// Every document the Dashboard read is the public one: the Worker serves this token nothing finer.
			const documents = app.buzzSchool.workerCalls.filter((call) =>
				call.startsWith(`/v1/schools/${owned}/kpi?`),
			);
			expect(documents.length).toBeGreaterThan(0);
			for (const call of documents)
				expect(new URL(call, worker.url).searchParams.get("audience")).toBe(
					"public",
				);
			expect(
				app.root.querySelector(
					"[data-test=lock-panel][data-surface=dashboard-plan]",
				),
			).not.toBeNull();
			await app.open("ledger");
			const lock = app.root.querySelector("[data-test=lock-panel]");
			expect(lock?.getAttribute("data-lock")).toBe("no_grant");
			expect(lock?.querySelector("[data-test=lock-title]")).not.toBeNull();
			expect(app.root.querySelector("[data-test=ledger-row]")).toBeNull();
			// No finance-only read was made: not the ledger, the statement, members' income or a member's money.
			for (const call of app.buzzSchool.workerCalls)
				expect(call).not.toMatch(
					/\/(ledger|income-statement|members-income|members\/[^/]+\/money)(\?|$)/,
				);
		} finally {
			app.close();
		}
	});
});
