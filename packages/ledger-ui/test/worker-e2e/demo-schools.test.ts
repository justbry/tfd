import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { render } from "preact";
import { mountHttpApp } from "../../src/http/browser.ts";
import type { LedgerSchoolClaim } from "../../src/http/ledger-token.ts";
import {
	apiBase,
	fakeBuzzSchool,
	harness,
	harnessTimeoutMilliseconds,
	httpAdaptersOn,
	type LedgerHarness,
} from "./worker-harness.ts";

/**
 * The demo schools (S8-contract section 11 "Demo schools") through the real path: the harness seeds two of atm's school
 * presets as `demo-<preset>` with `LEDGER_DEMO_SCHOOLS=on`, the Worker serves them to anyone, and the HTTP adapters
 * show them after the person's own schools, or alone under the large alert when no one is signed in. Their reads
 * never ask buzz-school, and their writes are refused before any request.
 */

const real = "tiny-school";
const demos = ["demo-free-only", "demo-monthly-members"];
let worker: LedgerHarness;
const skip = typeof harness === "string";

beforeAll(async () => {
	if (typeof harness === "string") return;
	worker = await harness.startLedgerWorker({
		presets: [real],
		demoPresets: ["monthly-members", "free-only"],
	});
}, harnessTimeoutMilliseconds);
afterAll(async () => {
	await worker?.stop();
});

const owner: LedgerSchoolClaim = { id: real, role: "owner", finance: true };
const macrotask = (): Promise<void> =>
	new Promise((resolve) => setTimeout(resolve, 0));
const renderAttempts = 800;
const digit = /\d/;

/** Mounts the HTTP build on `#/<school>/<tab>` as the browser would, signed in with `grants` or signed out. */
async function mounted(
	grants: LedgerSchoolClaim[],
	hash: string,
	options: { signedOut?: boolean } = {},
) {
	const buzzSchool = fakeBuzzSchool(worker, grants, options);
	const browserFetch = globalThis.fetch;
	globalThis.fetch = ((url: string, init: RequestInit) =>
		buzzSchool.fetch(String(url), init ?? {})) as typeof fetch;
	const root = document.createElement("div");
	document.body.appendChild(root);
	window.location.hash = hash;
	const systemNow = Date.now;
	Date.now = () => Date.parse(worker.clock.now());
	try {
		mountHttpApp(root, {
			apiBase,
			workerBase: `${worker.url}/v1`,
			webBase: "https://staging.b4uni.com",
		});
	} finally {
		Date.now = systemNow;
	}
	const shown = async (prefix: string): Promise<void> => {
		for (
			let attempt = 0;
			attempt < renderAttempts && !root.dataset.route?.startsWith(prefix);
			attempt += 1
		)
			await macrotask();
		expect(root.dataset.route ?? "").toStartWith(prefix);
	};
	const close = (): void => {
		render(null, root);
		root.remove();
		globalThis.fetch = browserFetch;
		window.location.hash = "";
	};
	return { root, buzzSchool, shown, close };
}

/** The switcher's school rows, "All schools" aside, and whether each sits in the "Demo" group. */
const switcherRows = (root: HTMLElement) =>
	[...root.querySelectorAll<HTMLElement>("[data-test=school-option]")]
		.filter((option) => option.dataset.school !== "all")
		.map((option) => ({
			id: option.dataset.school,
			demo: option.closest("[data-test=demo-schools]") !== null,
		}));

const openSwitcher = async (root: HTMLElement): Promise<void> => {
	root.querySelector<HTMLElement>("[data-test=school-switcher]")?.click();
	for (
		let attempt = 0;
		attempt < renderAttempts &&
		!root.querySelector("[data-test=school-option]");
		attempt += 1
	)
		await macrotask();
};

describe.skipIf(skip)("demo schools on the real Worker", () => {
	test("signed out: the Worker's demo schools under the large alert, with figures from the Worker", async () => {
		const app = await mounted([], "#/demo-monthly-members/dashboard", {
			signedOut: true,
		});
		try {
			await app.shown("#/demo-monthly-members/dashboard");
			const alert = app.root.querySelector("[data-test=demo-banner]");
			expect(alert?.textContent).toContain("Demo data");
			expect(alert?.textContent).toContain("demo scenarios");
			expect(alert?.textContent).toContain("read-only");
			expect(
				app.root.querySelector<HTMLAnchorElement>("[data-test=sign-in]")?.href,
			).toBe("https://staging.b4uni.com/signin");
			// The schools came from the Worker with no bearer, and buzz-school was asked for the token alone.
			expect(app.buzzSchool.workerCalls).toContain("/v1/schools");
			expect(
				app.buzzSchool.apiCalls.every(
					(path) => path === "/school-admin/ledger-token",
				),
			).toBe(true);
			expect(app.root.textContent ?? "").toContain("Demo · Monthly members");
			const values = [
				...app.root.querySelectorAll(
					"[data-test=kpi-card] [data-test=kpi-value]",
				),
			].map((value) => value.textContent ?? "");
			expect(
				values.filter((value) => digit.test(value)).length,
			).toBeGreaterThan(0);
			expect(app.root.querySelector("[data-test=stale-banner]")).toBeNull();
			await openSwitcher(app.root);
			expect(switcherRows(app.root)).toEqual(
				demos.map((id) => ({ id, demo: true })),
			);
			expect(
				app.root.querySelector("[data-test=demo-schools]")?.textContent,
			).toStartWith("Demo");
		} finally {
			app.close();
		}
	});

	test("signed out, the Ledger of a demo school lists rows named from the Worker's keys", async () => {
		const app = await mounted([], "#/demo-monthly-members/ledger", {
			signedOut: true,
		});
		try {
			await app.shown("#/demo-monthly-members/ledger");
			expect(
				app.root.querySelectorAll("[data-test=ledger-row]").length,
			).toBeGreaterThan(0);
			expect(app.root.textContent ?? "").toContain("Family ");
			expect(
				app.buzzSchool.apiCalls.filter(
					(path) => path !== "/school-admin/ledger-token",
				),
			).toEqual([]);
		} finally {
			app.close();
		}
	});

	test("signed in: the person's school first, then the demo schools, and the default route is their own", async () => {
		const adapters = httpAdaptersOn(worker, [owner]);
		const schools = await adapters.reader.schools();
		expect(schools.map((school) => [school.id, school.demo])).toEqual([
			[real, false],
			...demos.map((id) => [id, true]),
		]);
		expect(schools[1]?.name).toBe("Demo · Free only");
		expect(adapters.reader.session()).toBe("signed_in");
		const app = await mounted([owner], "#/");
		try {
			// An unknown route opens the first school: the person's own, not a demo school.
			for (
				let attempt = 0;
				attempt < renderAttempts && window.location.hash === "#/";
				attempt += 1
			)
				await macrotask();
			expect(window.location.hash).toStartWith(`#/${real}/`);
			expect(app.root.querySelector("[data-test=demo-banner]")).toBeNull();
			await openSwitcher(app.root);
			expect(switcherRows(app.root)).toEqual([
				{ id: real, demo: false },
				...demos.map((id) => ({ id, demo: true })),
			]);
		} finally {
			app.close();
		}
	});

	test("a demo school's buzz-school reads ask nothing of buzz-school, and its capabilities are all refused as demo", async () => {
		const adapters = httpAdaptersOn(worker, [owner]);
		await adapters.reader.schools();
		const before = adapters.buzzSchool.apiCalls.length;
		const school = "demo-monthly-members";
		const capabilities = await adapters.reader.capabilities({
			schoolId: school,
		});
		expect(
			Object.values(capabilities.actions).every(
				(capability) =>
					!capability.allowed &&
					"reason" in capability &&
					capability.reason === "demo",
			),
		).toBe(true);
		for (const read of [
			() => adapters.reader.members({ schoolId: school }),
			() =>
				adapters.reader.bookings({
					school,
					from: "2026-03-01",
					to: "2026-03-31",
				}),
			() => adapters.reader.menuVersions(school),
			() => adapters.reader.menuVersion(school, 1),
			() => adapters.reader.financeGrants({ schoolId: school }),
			() => adapters.reader.invoiceItems({ schoolId: school }),
			() => adapters.reader.switchTiers({ schoolId: school }),
		])
			await expect(read()).rejects.toMatchObject({ kind: "not_available" });
		const disclosure = await adapters.reader.disclosure(school);
		expect(disclosure.viewer.role).toBe("owner");
		expect(adapters.buzzSchool.apiCalls.length).toBe(before);
	});

	test("every write on a demo school is refused before a request, with the demo words", async () => {
		const adapters = httpAdaptersOn(worker, [owner]);
		const school = "demo-monthly-members";
		const before = adapters.buzzSchool.apiCalls.length;
		const writes: Array<() => Promise<unknown>> = [
			() => adapters.writer.publishMenu(school, "1234"),
			() => adapters.writer.saveMenu(school, {} as never),
			() =>
				adapters.writer.recordOutcome({
					school,
					bookingId: "b1",
					state: "attended",
				} as never),
			() =>
				adapters.writer.refund({
					schoolId: school,
					paymentIntentId: "pi_1",
					amountCents: 100,
				} as never),
			() =>
				adapters.writer.createKey({ school, kind: "pk", label: "x" } as never),
			() => adapters.writer.saveDisclosure({ school } as never),
		];
		for (const write of writes)
			await expect(write()).rejects.toMatchObject({
				kind: "read_only",
				message: expect.stringContaining("Demo school: read-only"),
			});
		expect(await adapters.writer.unlockBooks(school, "0000")).toEqual({
			unlocked: true,
		});
		expect(adapters.buzzSchool.apiCalls.length).toBe(before);
		expect(adapters.pending.forSchool(school)).toEqual([]);
	});
});
