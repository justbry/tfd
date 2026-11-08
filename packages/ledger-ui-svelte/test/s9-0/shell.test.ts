import { afterEach, describe, expect, test } from "bun:test";
import { flushSync } from "svelte";
import { schoolTabs } from "$contract/app/route.ts";
import { AdapterError } from "$contract/http/errors.ts";
import type { MountedApp } from "../../src/app/mount.ts";
import {
	click,
	openApp,
	query,
	queryAll,
	textOf,
	until,
} from "../app-harness.ts";

let mounted: MountedApp | undefined;
afterEach(async () => {
	await mounted?.unmount();
	mounted = undefined;
});
const open = async (hash: string, options?: Parameters<typeof openApp>[1]) => {
	const opened = await openApp(hash, options);
	mounted = opened.app;
	return opened;
};

describe("the shell", () => {
	test("an unknown school and tab open the first school's Plans", async () => {
		const { root } = await open("#/nowhere/nothing");
		expect(window.location.hash).toBe("#/vol/plans");
		expect(root.dataset.route).toBe("#/vol/plans");
		expect(root.classList.contains("app")).toBe(true);
	});
	test("brand, switcher and the seven tabs in the mockup's order", async () => {
		await open("#/vol/plans");
		expect(textOf("[data-test=brand]")).toBe("atm");
		expect(textOf("[data-test=school-name]")).toBe("Vibes of Light");
		expect(queryAll("[data-test=tab]").map((tab) => tab.dataset.tab)).toEqual([
			...schoolTabs,
		]);
		expect(
			queryAll("[data-test=tab]").map((tab) =>
				tab.textContent?.replace(/\s+/g, " ").trim(),
			),
		).toEqual([
			"Plans draft",
			"Dashboard",
			"Members",
			"Bookings 2",
			"Promos 1",
			"Ledger",
			"Reports",
		]);
		expect(query("[data-tab=plans]")?.getAttribute("aria-selected")).toBe(
			"true",
		);
		expect(query("[data-tab=bookings]")?.getAttribute("aria-label")).toBe(
			"Bookings: 2 overdue bookings",
		);
	});
	test("each tab is a routed pane", async () => {
		await open("#/vol/plans");
		for (const tab of schoolTabs) {
			click(`[data-tab=${tab}]`);
			expect(window.location.hash).toBe(`#/vol/${tab}`);
			expect(query("[data-test=pane] [data-pane]")?.dataset.pane).toBe(tab);
		}
	});
	test("a tab opened by the hash is selected", async () => {
		await open("#/b4u/ledger");
		expect(query("[data-tab=ledger]")?.getAttribute("aria-selected")).toBe(
			"true",
		);
		expect(textOf("[data-test=tab-badge]")).toBe("1");
	});
	test("a stale school shows the banner", async () => {
		await open("#/map/plans");
		expect(textOf("[data-test=stale-banner]")).toBe(
			"Data is 26 min behind: the shipper may be stuck. Recent events can be missing.",
		);
	});
	test("All schools has no tabs and lists every school", async () => {
		await open("#/all/all");
		expect(queryAll("[data-test=tab]")).toEqual([]);
		expect(
			queryAll("[data-test=all-schools] th").map((cell) =>
				cell.textContent?.trim(),
			),
		).toEqual([
			"School",
			"Outstanding",
			"Income · Nov 2026",
			"Needs attention",
			"Data",
		]);
		expect(queryAll("[data-test=all-schools-row]")).toHaveLength(5);
		expect(textOf("[data-test=all-schools-total] td:first-child")).toBe(
			"Total",
		);
		expect(textOf("[data-test=all-schools-total] td:nth-child(4)")).toBe("7");
		for (const column of [2, 3])
			expect(
				textOf(
					`[data-test=all-schools-total] td:nth-child(${column}) .sr-only`,
				),
			).toBe("Not shown yet: it arrives with the Dashboard (S9.1).");
		expect(
			textOf("[data-test=all-schools-row][data-school=map] td:last-child"),
		).toBe("26 min · stale");
		expect(
			textOf(
				"[data-test=all-schools-row][data-school=vol] td:nth-child(2) .sr-only",
			),
		).toBe("Not shown yet: it arrives with the Dashboard (S9.1).");
		expect(textOf("[data-test=school-name]")).toBe("All schools");
	});
	test("a school opened from All schools goes to its Plans", async () => {
		await open("#/all/all");
		click("[data-test=all-schools-row][data-school=har] button");
		expect(window.location.hash).toBe("#/har/plans");
	});
	test("the period follows the route, and B4 Uni opens on Jun", async () => {
		await open("#/b4u/plans");
		expect(query("[data-test=period-button]")?.getAttribute("aria-label")).toBe(
			"Period: Jun 2026",
		);
		await open("#/vol/ledger?month=2026-09");
		expect(query("[data-test=period-button]")?.getAttribute("aria-label")).toBe(
			"Period: Sep 2026",
		);
		expect(textOf("[data-test=period-word]")).toBe("Month");
	});
	test("the period panel carries the viewer's audience note and lets the end pass today", async () => {
		await open("#/vol/plans");
		click("[data-test=period-button]");
		await until(
			() => query("[data-test=period-note]") !== null,
			"the period note",
		);
		expect(textOf("[data-test=period-note]")).toBe(
			"Owner: months and days, live. One period for Dashboard, Reports, Ledger and Members.",
		);
		expect(query("input[aria-label=To]")?.hasAttribute("max")).toBe(false);
	});
	test("the theme comes from the route and sits on <html>", async () => {
		await open("#/vol/plans?theme=dark");
		expect(document.documentElement.className).toBe("dark");
		await open("#/vol/plans");
		expect(document.documentElement.className).toBe("system");
	});
	test("the settings sheet sets the theme", async () => {
		await open("#/vol/plans");
		click("[data-test=settings-button]");
		await until(
			() => query("[data-theme=dark]") !== null,
			"the settings sheet",
		);
		expect(textOf("[data-test=settings] [data-slot=sheet-description]")).toBe(
			"You and Vibes of Light",
		);
		click("[data-theme=dark]");
		expect(window.location.hash).toBe("#/vol/plans?theme=dark");
		await until(
			() => document.documentElement.className === "dark",
			"the dark theme",
		);
		click("[data-theme=system]");
		expect(window.location.hash).toBe("#/vol/plans");
	});
	test("the switcher lists All schools and every school, and opens one", async () => {
		await open("#/vol/plans");
		click("[data-test=school-switcher]");
		await until(
			() => queryAll("[data-test=school-option]").length > 0,
			"the switcher",
		);
		expect(
			queryAll("[data-test=school-option]").map((option) =>
				option.getAttribute("aria-label"),
			),
		).toEqual([
			"All schools, 5 schools",
			"Vibes of Light, 4 need attention",
			"B4 Uni, 2 need attention",
			"Maple Pilates, stale, 1 need attention",
			"Lotus Lane Yoga",
			"Harbor Arts Academy",
		]);
		click("[data-test=school-option][data-school=map]");
		expect(window.location.hash).toBe("#/map/plans");
	});
	test("a search that matches nothing says so; Enter opens the first match", async () => {
		await open("#/vol/plans");
		click("[data-test=school-switcher]");
		await until(() => query("input[type=search]") !== null, "the switcher");
		const search = query<HTMLInputElement>("input[type=search]");
		if (!search) throw new Error("no search field");
		const type = (text: string): void => {
			search.value = text;
			search.dispatchEvent(new Event("input", { bubbles: true }));
			flushSync();
		};
		expect(query("[data-test=school-none]")?.getAttribute("role")).toBe(
			"status",
		);
		expect(textOf("[data-test=school-none]")).toBe("");
		type("zzz");
		expect(queryAll("[data-test=school-option]")).toEqual([]);
		expect(queryAll("[data-test=school-panel] hr")).toEqual([]);
		expect(textOf("[data-test=school-none]")).toBe("No school matches “zzz”");
		type("lotus");
		expect(queryAll("[data-test=school-panel] hr")).toEqual([]);
		search.dispatchEvent(
			new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
		);
		flushSync();
		expect(window.location.hash).toBe("#/nw/plans");
	});
	test("the active tab is underlined in the primary colour in both themes", async () => {
		await open("#/vol/plans?theme=dark");
		const active = query("[data-tab=plans]");
		expect(active?.getAttribute("data-state")).toBe("active");
		/** Every class that colours the border while the tab is active, whatever its theme or group variant. */
		const activeBorderColours = (active?.className.split(/\s+/) ?? []).filter(
			(name) => {
				const variants = name.split(":");
				const utility = variants.pop() ?? "";
				return (
					variants.some((variant) => variant.endsWith("data-active")) &&
					/^border-(?!\d|[xytblr]-|0$)[a-z]/.test(utility)
				);
			},
		);
		expect(activeBorderColours.length).toBeGreaterThan(0);
		expect(
			new Set(activeBorderColours.map((name) => name.split(":").pop())),
		).toEqual(new Set(["border-primary"]));
		expect(activeBorderColours).toContain("dark:data-active:border-primary");
	});
	test("another school keeps only the theme", async () => {
		await open("#/vol/ledger?theme=dark&month=2026-09");
		click("[data-test=school-switcher]");
		await until(
			() => queryAll("[data-test=school-option]").length > 0,
			"the switcher",
		);
		click("[data-test=school-option][data-school=nw]");
		expect(window.location.hash).toBe("#/nw/plans?theme=dark");
	});
});

describe("a failed disclosure read", () => {
	test("leaves with its school: the toast goes, and its Retry can no longer run", async () => {
		let volCalls = 0;
		const { app } = await open("#/vol/plans", {
			reader: (fixture) => ({
				...fixture,
				disclosure: (schoolId) => {
					if (schoolId !== "vol") return fixture.disclosure(schoolId);
					volCalls += 1;
					return Promise.reject(new AdapterError("network", "offline"));
				},
			}),
		});
		await until(
			() => query("[data-test=toast-action]") !== null,
			"the failure toast",
			1000,
		);
		const callsBefore = volCalls;
		const oldRetry = app.toasts.state.visible[0]?.action?.run;
		expect(oldRetry).toBeDefined();
		click("[data-test=school-switcher]");
		await until(
			() => queryAll("[data-test=school-option]").length > 0,
			"the switcher",
		);
		click("[data-test=school-option][data-school=b4u]");
		await until(
			() => queryAll("[data-test=toast]").length === 0,
			"the old school's toast to leave",
		);
		oldRetry?.();
		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(volCalls).toBe(callsBefore);
		expect(queryAll("[data-test=toast]")).toEqual([]);
	});
	test("is retried, then toasts with Retry; the retry fills the period line and takes the toast down", async () => {
		let calls = 0;
		const triesBeforeTheToast = 3;
		await open("#/vol/plans", {
			reader: (fixture) => ({
				...fixture,
				disclosure: (schoolId) => {
					calls += 1;
					return calls <= triesBeforeTheToast
						? Promise.reject(new AdapterError("network", "offline"))
						: fixture.disclosure(schoolId);
				},
			}),
		});
		await until(
			() => query("[data-test=toast-action]") !== null,
			"the failure toast",
			1000,
		);
		expect(calls).toBe(triesBeforeTheToast);
		expect(textOf("[data-test=toast-title]")).toBe("No connection");
		expect(textOf("[data-test=toast-action]")).toBe("Retry");
		click("[data-test=toast-action]");
		await until(
			() =>
				calls === triesBeforeTheToast + 1 &&
				queryAll("[data-test=toast]").length === 0,
			"the retry",
		);
		click("[data-test=period-button]");
		await until(
			() => query("[data-test=period-note]") !== null,
			"the period note",
		);
		expect(textOf("[data-test=period-note]")).toStartWith("Owner:");
	});
});

describe("a failed schools read", () => {
	test("failing the same way again keeps one toast, its count up and announced", async () => {
		let calls = 0;
		await open("#/vol/plans", {
			waitForRoute: false,
			reader: (fixture) => ({
				...fixture,
				schools: () => {
					calls += 1;
					return calls <= 2
						? Promise.reject(
								new AdapterError("not_found", "404", { status: 404 }),
							)
						: fixture.schools();
				},
			}),
		});
		await until(() => query("[data-test=load-failed]") !== null, "the failure");
		click("[data-test=load-retry]");
		await until(
			() => calls === 2 && query("[data-test=toast-count]") !== null,
			"the second failure",
		);
		await new Promise((resolve) => setTimeout(resolve, 20));
		flushSync();
		expect(queryAll("[data-test=toast]")).toHaveLength(1);
		expect(textOf("[data-test=toast-count] .sr-only")).toBe("2 times");
		expect(textOf("[data-test=toasts-assertive]")).toContain("2 times");
		expect(query("[data-test=load-failed]")).not.toBeNull();
	});
	test("a toast's Retry while the read is still on its way loses nothing", async () => {
		let calls = 0;
		const triesBeforeTheToast = 3;
		let release = (): void => undefined;
		const held = new Promise<void>((resolve) => {
			release = resolve;
		});
		const { root } = await open("#/vol/plans", {
			waitForRoute: false,
			reader: (fixture) => ({
				...fixture,
				schools: () => {
					calls += 1;
					return calls <= triesBeforeTheToast
						? Promise.reject(new AdapterError("network", "offline"))
						: held.then(() => fixture.schools());
				},
			}),
		});
		await until(
			() => query("[data-test=toast-action]") !== null,
			"the failure toast",
			1000,
		);
		click("[data-test=toast-action]");
		click("[data-test=toast-action]");
		expect(calls).toBe(triesBeforeTheToast + 1);
		expect(textOf("[data-test=toast-title]")).toBe("No connection");
		release();
		await until(() => root.dataset.route === "#/vol/plans", "the retried read");
		await until(
			() => queryAll("[data-test=toast]").length === 0,
			"the toast to leave",
		);
	});
	test("shows the message in place and in an alert toast, and Retry reads again", async () => {
		let calls = 0;
		let release = (): void => undefined;
		const held = new Promise<void>((resolve) => {
			release = resolve;
		});
		const { root } = await open("#/vol/plans", {
			waitForRoute: false,
			reader: (fixture) => ({
				...fixture,
				schools: () => {
					calls += 1;
					return calls === 1
						? Promise.reject(
								new AdapterError("not_found", "404", { status: 404 }),
							)
						: held.then(() => fixture.schools());
				},
			}),
		});
		await until(() => query("[data-test=load-failed]") !== null, "the failure");
		expect(textOf("[data-test=load-failed]")).toContain("Not found");
		expect(textOf("[data-test=toasts-assertive]")).toContain("Not found");
		expect(textOf("[data-test=toast-title]")).toBe("Not found");
		expect(textOf("[data-test=toast-action]")).toBe("Reload");
		click("[data-test=load-retry]");
		// While the retry is on its way the failure stays on screen, its Retry busy.
		expect(query("[data-test=load-failed]")).not.toBeNull();
		expect(textOf("[data-test=load-retry]")).toBe("Retrying…");
		expect(query<HTMLButtonElement>("[data-test=load-retry]")?.disabled).toBe(
			true,
		);
		release();
		await until(() => root.dataset.route === "#/vol/plans", "the retried read");
		expect(query("[data-test=load-failed]")).toBeNull();
		expect(calls).toBe(2);
		// The failure is fixed, so its toast leaves with it.
		await until(
			() => queryAll("[data-test=toast]").length === 0,
			"the toast to leave",
		);
		expect(textOf("[data-test=toasts-assertive]")).toBe("");
	});
});
