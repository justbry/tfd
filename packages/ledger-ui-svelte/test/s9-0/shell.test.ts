import { afterEach, describe, expect, test } from "bun:test";
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
		expect(textOf("[data-test=all-schools-total]")).toBe("Total 7");
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

describe("a failed schools read", () => {
	test("shows the message in place and in an alert toast, and Retry reads again", async () => {
		let calls = 0;
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
						: fixture.schools();
				},
			}),
		});
		await until(() => query("[data-test=load-failed]") !== null, "the failure");
		expect(textOf("[data-test=load-failed]")).toContain("Not found");
		const alert = query("[data-test=toast]");
		expect(alert?.getAttribute("role")).toBe("alert");
		expect(textOf("[data-test=toast-title]")).toBe("Not found");
		expect(textOf("[data-test=toast-action]")).toBe("Reload");
		click("[data-test=load-retry]");
		await until(() => root.dataset.route === "#/vol/plans", "the retried read");
		expect(calls).toBe(2);
	});
});
