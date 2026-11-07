import { afterAll, beforeAll, describe, expect, test } from "bun:test";
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
 * (happy-dom refuses `http:` fetches from an `https:` page) costs more than it proves beyond this.
 */

const school = "monthly-members";
const grants: LedgerSchoolClaim[] = [
	{ id: school, role: "owner", finance: true },
];
let worker: LedgerHarness;
const skip = typeof harness === "string";

beforeAll(async () => {
	if (typeof harness === "string") return;
	worker = await harness.startLedgerWorker({ presets: [school] });
}, harnessTimeoutMilliseconds);
afterAll(async () => {
	await worker?.stop();
});

const macrotask = (): Promise<void> =>
	new Promise((resolve) => setTimeout(resolve, 0));

describe.skipIf(skip)("the HTTP build's entry on the real Worker", () => {
	test("reads the schools through the Worker at VITE_LEDGER_WORKER_BASE; the books wait on the View as copy", async () => {
		const buzzSchool = fakeBuzzSchool(worker, grants);
		const browserFetch = globalThis.fetch;
		globalThis.fetch = ((url: string, init: RequestInit) =>
			buzzSchool.fetch(String(url), init ?? {})) as typeof fetch;
		const root = document.createElement("div");
		root.id = "app";
		document.body.appendChild(root);
		window.location.hash = "";
		try {
			mountHttpApp(root, { apiBase, workerBase: `${worker.url}/v1` });
			for (let attempt = 0; attempt < 400 && !root.dataset.route; attempt += 1)
				await macrotask();
			for (let attempt = 0; attempt < 20; attempt += 1) await macrotask();
			expect(buzzSchool.minted.length).toBeGreaterThan(0);
			expect(buzzSchool.workerCalls).toContain("/v1/schools");
			// The switcher shows the school as buzz-school's ledger/school names it, with the Worker's lag.
			expect(root.textContent ?? "").toContain(`School ${school}`);
			// The disclosure's View as copy and the viewer's name have no source yet (src/http/disclosure.ts): the books
			// pane stays empty rather than show anything made up.
			expect(buzzSchool.workerCalls).toContain(
				`/v1/schools/${school}/disclosure`,
			);
			expect(root.querySelector("[data-test=kpi-card]")).toBeNull();
		} finally {
			globalThis.fetch = browserFetch;
			root.remove();
			window.location.hash = "";
		}
	});
});
