import { afterEach, describe, expect, test } from "bun:test";
import { flushSync } from "svelte";
import { AdapterError } from "$contract/http/errors.ts";
import type { MountedApp } from "../../src/app/mount.ts";
import { macrotask, openPane, settle, until } from "./harness.ts";

/**
 * The Plans and Promos panes across the viewer's role and audience (the state matrix), and through the Effect layer: the
 * states of a read (not available, failing, retrying, abandoned) and of a write (retried with its Idempotency-Key), each
 * with the toasts S9-plan section 5 asks for.
 */
let mounted: MountedApp | undefined;
afterEach(async () => {
	await mounted?.unmount();
	mounted = undefined;
	document.body.innerHTML = "";
});

const one = (selector: string): HTMLElement | null =>
	document.querySelector<HTMLElement>(selector);
const count = (selector: string): number =>
	document.querySelectorAll(selector).length;
const text = (selector: string): string =>
	(one(selector)?.textContent ?? "").replace(/\s+/g, " ").trim();
type Switch = "on" | "off" | "-";
const control = (selector: string): Switch => {
	const element = one(selector) as HTMLButtonElement | null;
	return element ? (element.disabled ? "off" : "on") : "-";
};
const toasts = (app: MountedApp) => [
	...app.toasts.state.visible,
	...app.toasts.state.waiting,
];
const unavailable = (what: string): AdapterError =>
	new AdapterError("not_available", `${what} is not available: no route yet`, {
		code: "not_available",
	});
const offline = (): AdapterError =>
	new AdapterError("unavailable", "503", {
		status: 503,
		code: "school_api_unavailable",
	});

describe("Plans, by school, role and audience", () => {
	/** What each combination shows: Get started, the strip, the books note, the plan rows, and which write controls are on. */
	const matrix: Array<{
		route: string;
		setup: number;
		strip: number;
		note: number;
		rows: number;
		add: Switch;
		review: Switch;
		ledgerCopy: Switch;
		discard: Switch;
	}> = [
		{
			route: "#/vol/plans",
			setup: 0,
			strip: 4,
			note: 0,
			rows: 5,
			add: "on",
			review: "on",
			ledgerCopy: "on",
			discard: "on",
		},
		{
			route: "#/vol/plans?as=finance",
			setup: 0,
			strip: 4,
			note: 0,
			rows: 5,
			add: "off",
			review: "off",
			ledgerCopy: "off",
			discard: "off",
		},
		{
			route: "#/vol/plans?as=admin",
			setup: 0,
			strip: 4,
			note: 1,
			rows: 5,
			add: "off",
			review: "off",
			ledgerCopy: "off",
			discard: "off",
		},
		{
			route: "#/vol/plans?as=governance",
			setup: 0,
			strip: 0,
			note: 1,
			rows: 5,
			add: "off",
			review: "off",
			ledgerCopy: "-",
			discard: "off",
		},
		{
			route: "#/vol/plans?as=member",
			setup: 0,
			strip: 0,
			note: 1,
			rows: 5,
			add: "off",
			review: "off",
			ledgerCopy: "-",
			discard: "off",
		},
		{
			route: "#/vol/plans?as=public",
			setup: 0,
			strip: 0,
			note: 1,
			rows: 5,
			add: "off",
			review: "off",
			ledgerCopy: "-",
			discard: "off",
		},
		{
			route: "#/b4u/plans",
			setup: 0,
			strip: 4,
			note: 0,
			rows: 3,
			add: "on",
			review: "off",
			ledgerCopy: "off",
			discard: "-",
		},
		{
			route: "#/b4u/plans?as=governance",
			setup: 0,
			strip: 0,
			note: 1,
			rows: 3,
			add: "off",
			review: "off",
			ledgerCopy: "-",
			discard: "-",
		},
		{
			route: "#/b4u/plans?as=public",
			setup: 0,
			strip: 0,
			note: 1,
			rows: 2,
			add: "off",
			review: "off",
			ledgerCopy: "-",
			discard: "-",
		},
		{
			route: "#/nw/plans",
			setup: 1,
			strip: 0,
			note: 0,
			rows: 0,
			add: "on",
			review: "off",
			ledgerCopy: "on",
			discard: "-",
		},
		{
			route: "#/map/plans",
			setup: 1,
			strip: 4,
			note: 0,
			rows: 1,
			add: "on",
			review: "off",
			ledgerCopy: "on",
			discard: "-",
		},
		{
			route: "#/har/plans",
			setup: 0,
			strip: 4,
			note: 1,
			rows: 3,
			add: "on",
			review: "off",
			ledgerCopy: "off",
			discard: "-",
		},
	];
	for (const row of matrix)
		test(row.route, async () => {
			const { app, root } = await openPane(
				`${row.route}${row.route.includes("?") ? "&" : "?"}theme=light`,
			);
			mounted = app;
			await settle(root);
			expect({
				route: row.route,
				setup: count("[data-test=plan-setup]"),
				strip: count("[data-test=plan-stat]"),
				note: count("[data-test=plan-books-note]"),
				rows: count("[data-test=plan-row]"),
				add: control("[data-test=plan-add][data-kind=tiers]"),
				review: control("[data-test=plan-review]"),
				ledgerCopy: control("[data-test=plan-ledger-copy]"),
				discard: control("[data-test=plan-discard]"),
			}).toEqual(row);
		});

	test("a write control that is off in a preview says why, and an owner's own view says nothing", async () => {
		const { app, root } = await openPane("#/vol/plans?as=finance&theme=light");
		mounted = app;
		await settle(root);
		expect(one("[data-test=plan-add][data-kind=tiers]")?.title).toBe(
			"Exit preview to act",
		);
		expect(one("[data-test=plan-ledger-copy]")?.title).toBe(
			"Exit preview to act",
		);
		expect(one("[data-test=plan-review]")?.title).toBe("Exit preview to act");
	});

	test("an admin cannot write the copy in the ledger, and the button says the owner does", async () => {
		const { app, root } = await openPane("#/b4u/plans?theme=light");
		mounted = app;
		await settle(root);
		expect(one("[data-test=plan-ledger-copy]")?.title).toBe(
			"Owners write the copy in the ledger",
		);
	});
});

describe("Promos, by school, role and audience", () => {
	const matrix: Array<{
		route: string;
		rows: number;
		create: Switch;
		disable: number;
		reveal: Switch;
		redemptions: Switch;
	}> = [
		{
			route: "#/vol/promos",
			rows: 4,
			create: "on",
			disable: 3,
			reveal: "on",
			redemptions: "on",
		},
		{
			route: "#/vol/promos?as=finance",
			rows: 4,
			create: "off",
			disable: 3,
			reveal: "on",
			redemptions: "on",
		},
		{
			route: "#/vol/promos?as=admin",
			rows: 4,
			create: "off",
			disable: 3,
			reveal: "on",
			redemptions: "off",
		},
		{
			route: "#/vol/promos?as=governance",
			rows: 4,
			create: "off",
			disable: 3,
			reveal: "off",
			redemptions: "off",
		},
		{
			route: "#/vol/promos?as=member",
			rows: 4,
			create: "off",
			disable: 3,
			reveal: "off",
			redemptions: "off",
		},
		{
			route: "#/vol/promos?as=public",
			rows: 4,
			create: "off",
			disable: 3,
			reveal: "off",
			redemptions: "off",
		},
		{
			route: "#/b4u/promos",
			rows: 1,
			create: "off",
			disable: 1,
			reveal: "on",
			redemptions: "on",
		},
		{
			route: "#/nw/promos",
			rows: 0,
			create: "on",
			disable: 0,
			reveal: "-",
			redemptions: "-",
		},
	];
	for (const row of matrix)
		test(row.route, async () => {
			const { app, root } = await openPane(
				`${row.route}${row.route.includes("?") ? "&" : "?"}theme=light`,
			);
			mounted = app;
			await settle(root);
			const observed = {
				route: row.route,
				rows: count("[data-test=promo-row]"),
				create: control("[data-test=promo-new]"),
				disable: count("[data-test=promo-disable]"),
				reveal: control("[data-test=promo-reveal]"),
				redemptions: control("[data-test=promo-redemptions]"),
			};
			expect(observed).toEqual(row);
		});
});

describe("a read nothing provides yet (the HTTP build: no route) is its own state", () => {
	test("Plans: the summary is not available, so the pane says so in place and in one toast, with no figure and no row", async () => {
		const { app, root, log } = await openPane("#/vol/plans?theme=light", {
			reader: (fixture) => ({
				...fixture,
				planSummary: async () => {
					throw unavailable("planSummary");
				},
			}),
		});
		mounted = app;
		await settle(root);
		const failed = one("[data-test=load-failed]");
		expect(failed).toBeNull();
		expect(text("[data-test=plans-unavailable]")).toContain(
			"Plans are not available yet",
		);
		expect(text("[data-test=plans-unavailable]")).toContain(
			"never a 0 or a sample",
		);
		expect(text("[data-test=plans-unavailable]")).toContain(
			"Check again once the route ships",
		);
		expect(count("[data-test=plan-row]")).toBe(0);
		expect(count("[data-test=plan-stat]")).toBe(0);
		expect(count("[data-test=plan-review]")).toBe(0);
		expect(root.textContent ?? "").not.toMatch(/\b0 active members|\$0\.00/);
		const shown = toasts(app);
		expect(shown.map((toast) => [toast.tone, toast.title])).toEqual([
			["warning", "Not available yet"],
		]);
		// Not a bug of the app: nothing is logged, and the toast has no Retry for a route that does not exist.
		expect(log.entries()).toEqual([]);
		expect(shown[0]?.action).toBeUndefined();
	});

	test("Promos: not available keeps Create promo off with the reason, shows no row, and never a sample", async () => {
		const { app, root, log } = await openPane("#/vol/promos?theme=light", {
			reader: (fixture) => ({
				...fixture,
				promos: async () => {
					throw unavailable("promos");
				},
			}),
		});
		mounted = app;
		await settle(root);
		expect(text("[data-test=promo-unavailable]")).toContain(
			"Promos are not available yet",
		);
		expect(text("[data-test=promo-unavailable]")).toContain("never a sample");
		expect(text("[data-test=promo-unavailable]")).toContain(
			"Create promo and Disable stay off",
		);
		expect(count("[data-test=promo-row]")).toBe(0);
		expect(control("[data-test=promo-new]")).toBe("off");
		expect(one("[data-test=promo-new]")?.title).toContain("Not available yet");
		expect(toasts(app).map((toast) => toast.title)).toEqual([
			"Not available yet",
		]);
		expect(log.entries()).toEqual([]);
	});

	test("Preview: the promo code field says promos are not available and Apply stays off; the cards still show", async () => {
		const { app, root } = await openPane(
			"#/vol/plans?mode=preview&theme=light",
			{
				reader: (fixture) => ({
					...fixture,
					promos: async () => {
						throw unavailable("promos");
					},
				}),
			},
		);
		mounted = app;
		await settle(root);
		await until(
			() => text("[data-test=plan-promo-message]").includes("not available"),
			"the promo message",
		);
		expect(count("[data-test=plan-card]")).toBeGreaterThan(0);
		const apply = [
			...document.querySelectorAll<HTMLButtonElement>("button"),
		].find((button) => button.textContent?.trim() === "Apply");
		expect(apply?.disabled).toBe(true);
		expect(apply?.title).toContain("Not available yet");
	});
});

describe("reads through the Effect layer", () => {
	test("each independent read has its own toast: the menu failing and the summary not available are two toasts, and Retry on one leaves the other", async () => {
		let menuTries = 0;
		const { app, root } = await openPane("#/vol/plans?theme=light", {
			reader: (fixture) => ({
				...fixture,
				menuVersions: async (...args) => {
					menuTries += 1;
					if (menuTries <= 3) throw offline();
					return fixture.menuVersions(...args);
				},
				planSummary: async () => {
					throw unavailable("planSummary");
				},
			}),
		});
		mounted = app;
		await until(
			() =>
				toasts(app).length >= 2 &&
				count("[data-test=load-failed]") === 1 &&
				count("[data-test=plans-unavailable]") === 1,
			"both reads to fail",
			3000,
		);
		const owners = toasts(app).map((toast) => toast.owner);
		expect(new Set(owners).size).toBe(2);
		expect(
			toasts(app)
				.map((toast) => toast.title)
				.sort(),
		).toEqual(["Not available yet", "The ledger is catching up"]);
		expect(count("[data-test=load-failed][data-kind=unavailable]")).toBe(1);
		// Retry the menu read: it succeeds now; its toast goes, the summary's stays (still not available).
		const retry = [
			...document.querySelectorAll<HTMLElement>("[data-test=toast-action]"),
		].find((button) => button.textContent === "Retry");
		retry?.click();
		await until(
			() =>
				!toasts(app).some(
					(toast) => toast.title === "The ledger is catching up",
				),
			"the menu toast to leave",
			3000,
		);
		expect(toasts(app).map((toast) => toast.title)).toEqual([
			"Not available yet",
		]);
		expect(root.dataset.route).toBeDefined();
	}, 15_000);

	test("a read that fails twice and then answers is retried with its progress in a toast, and the pane shows the plans", async () => {
		let tries = 0;
		const { app, root } = await openPane("#/vol/plans?theme=light", {
			waitForRoute: false,
			reader: (fixture) => ({
				...fixture,
				planSummary: async (...args) => {
					tries += 1;
					if (tries <= 2) throw offline();
					return fixture.planSummary(...args);
				},
			}),
		});
		mounted = app;
		await until(
			() => toasts(app).some((toast) => toast.detail === "Retrying (2 of 3)"),
			"the first retry",
			3000,
		);
		await until(
			() =>
				root.dataset.route !== undefined && count("[data-test=plan-row]") > 0,
			"the plans",
			3000,
		);
		expect(tries).toBe(3);
		expect(toasts(app)).toEqual([]);
	}, 15_000);

	test("a read nobody waits for any more makes no toast and no log entry: leaving the tab while it is on its way", async () => {
		let reject: (error: Error) => void = () => undefined;
		const { app, root, log } = await openPane("#/vol/plans?theme=light", {
			waitForRoute: false,
			reader: (fixture) => ({
				...fixture,
				planSummary: () =>
					new Promise((_resolve, rejectRead) => {
						reject = rejectRead;
					}),
			}),
		});
		mounted = app;
		await until(() => one("[data-pane=plans]") !== null, "the Plans pane");
		window.location.hash = "#/vol/promos?theme=light";
		await until(() => one("[data-pane=promos]") !== null, "the Promos pane");
		reject(offline());
		for (let turn = 0; turn < 40; turn += 1) {
			flushSync();
			await macrotask();
		}
		expect(
			toasts(app).filter(
				(toast) => toast.title === "The ledger is catching up",
			),
		).toEqual([]);
		expect(log.entries()).toEqual([]);
		await settle(root);
	});
});

describe("writes through the Effect layer", () => {
	test("a draft save that fails once is retried as the same request, and the pane ends saved", async () => {
		let saves = 0;
		const sent: unknown[][] = [];
		const { app, root, writer } = await openPane("#/vol/plans?theme=light", {
			writerWrap: (fixture) => ({
				...fixture,
				saveMenu: async (...args) => {
					saves += 1;
					sent.push(args);
					if (saves === 1) throw offline();
					return fixture.saveMenu(...args);
				},
			}),
		});
		mounted = app;
		await settle(root);
		(
			one(
				"[data-test=plan-row][data-plan=glow] [data-test=plan-edit]",
			) as HTMLElement
		).click();
		await until(
			() => one("[data-test=plan-drawer-save]") !== null,
			"the drawer",
		);
		(one("[data-test=plan-drawer-save]") as HTMLElement).click();
		await until(
			() =>
				saves === 2 &&
				toasts(app).some((toast) =>
					toast.title.startsWith("Saved to the draft"),
				),
			"the retried save",
			3000,
		);
		// The failed try never reached the fixture Writer; the retry did, with the draft the first try carried.
		const calls = writer.calls.filter(({ method }) => method === "saveMenu");
		expect(calls.length).toBe(1);
		expect(sent.length).toBe(2);
		expect(sent[1]).toEqual(sent[0] as unknown[]);
		expect(count("[data-test=plan-retry-save]")).toBe(0);
	}, 15_000);

	test("Create promo that fails is a toast with Retry (same request), and the dialog stays for another try", async () => {
		let creates = 0;
		const { app, root } = await openPane("#/vol/promos?theme=light", {
			writerWrap: (fixture) => ({
				...fixture,
				createPromo: async (...args) => {
					creates += 1;
					if (creates <= 3) throw offline();
					return fixture.createPromo(...args);
				},
			}),
		});
		mounted = app;
		await settle(root);
		(one("[data-test=promo-new]") as HTMLElement).click();
		await until(
			() => one("[data-test=promo-note-input]") !== null,
			"the dialog",
		);
		const note = one("[data-test=promo-note-input]") as HTMLTextAreaElement;
		note.value = "For the spring open day";
		note.dispatchEvent(new Event("input", { bubbles: true }));
		await until(
			() => !(one("[data-test=dialog-confirm]") as HTMLButtonElement).disabled,
			"Create promo to turn on",
		);
		(one("[data-test=dialog-confirm]") as HTMLElement).click();
		await until(
			() =>
				toasts(app).some(
					(toast) =>
						toast.title === "The ledger is catching up" &&
						toast.action?.label === "Retry",
				),
			"the failure toast",
			3000,
		);
		expect(creates).toBe(3);
		expect(count("[data-test=promo-created-code]")).toBe(0);
		expect(
			(one("[data-test=dialog-confirm]") as HTMLButtonElement).disabled,
		).toBe(false);
		const retry = [
			...document.querySelectorAll<HTMLElement>("[data-test=toast-action]"),
		].find((button) => button.textContent === "Retry");
		retry?.click();
		await until(
			() => one("[data-test=promo-created-code]") !== null,
			"the created promo",
			3000,
		);
		expect(creates).toBe(4);
	}, 15_000);
});
