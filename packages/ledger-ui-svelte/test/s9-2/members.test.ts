import { afterEach, describe, expect, test } from "bun:test";
import type { Capabilities } from "$contract/data/members.ts";
import { AdapterError, notAvailable } from "$contract/http/errors.ts";
import type { MountedApp } from "../../src/app/mount.ts";
import { until } from "../app-harness.ts";
import {
	all,
	click,
	fill,
	fixtureReader,
	openPane,
	readerWith,
	settle,
	text,
	waitFor,
	writerWith,
} from "./support.ts";

/** The Members tab's states and writes that the golden file does not reach: the list and its numbers, the calls the
 * HTTP layer answers `not_available` (shown as that state, never a 0 or a made-up value, the action off with its
 * reason), a read let go with the pane, and a write that fails and is tried again. */
let mounted: MountedApp | undefined;
afterEach(async () => {
	await mounted?.unmount();
	mounted = undefined;
	document.body.innerHTML = "";
});
const open = async (
	hash: string,
	options: Parameters<typeof openPane>[1] = {},
) => {
	const pane = await openPane(hash, options);
	mounted = pane.app;
	return pane;
};
const toastTitles = (pane: Awaited<ReturnType<typeof open>>): string[] =>
	pane.toasts().map((toast) => toast.title);
const unbuilt = (call: string) =>
	(async () => {
		throw notAvailable(call, "no route yet");
	}) as never;

describe("the list and its numbers", () => {
	test("people sort by attention, then role, then name; the stat strip counts them", async () => {
		await open("#/vol/members?theme=light");
		expect(
			all("[data-test=member-name]").map((name) => name.textContent?.trim()),
		).toEqual([
			"Mia R.",
			"Ana P.",
			"Ivy N.",
			"Jon K.",
			"Kim R.",
			"Ravi S.",
			"Lee T.",
			"Sam O.",
		]);
		expect(
			text(
				"[data-test=members-stat][data-stat=outstanding] [data-test=stat-value]",
			),
		).toBe("63");
		expect(
			text(
				"[data-test=members-stat][data-stat=attention] [data-test=stat-value]",
			),
		).toBe("4");
		expect(
			text("[data-test=members-stat][data-stat=income] [data-test=stat-label]"),
		).toBe("income · Nov 2026");
		expect(
			text("[data-test=members-stat][data-stat=income] [data-test=stat-value]"),
		).toBe("$287.00");
	});
	test("each plan row draws three bar segments whose counts add up; a row with no plan says so, never 0", async () => {
		await open("#/vol/members?theme=light");
		const row = '[data-test=member-row][data-id="m_012"]';
		const segments = all(`${row} [data-test=bar-segment]`).map((segment) => [
			segment.dataset.segment,
			segment.dataset.count,
		]);
		expect(segments).toEqual([
			["used", "10"],
			["held", "2"],
			["available", "20"],
		]);
		expect(text(`${row} [data-test=member-available]`)).toBe("20/32 +2 held");
		const noPlan = '[data-test=member-row][data-id="u_kim"]';
		expect(text(`${noPlan} [data-test=member-plan]`)).toBe("No plan");
		expect(text(`${noPlan} [data-test=member-available]`)).toBe("no plan");
		expect(all(`${noPlan} [data-test=balance-bar]`)).toHaveLength(0);
	});
	test("a school with no currency shows its money as a dash, never $0.00", async () => {
		const pane = await open("#/vol/members?member=m_012&theme=light", {
			reader: readerWith({
				schools: (async () =>
					(await fixtureReader().schools()).map((school) => ({
						...school,
						currency: null,
					}))) as never,
			}),
		});
		await waitFor(
			() => all("[data-test=payment-row]").length > 0,
			"the payments",
		);
		for (const row of all("[data-test=payment-row]"))
			expect(row.textContent).not.toContain("$0.00");
		expect(pane.root.textContent).not.toContain("NaN");
	});
});

describe("what the HTTP layer does not build", () => {
	test("people and the summary: the roster is the message, with no row, no strip and no 0", async () => {
		const pane = await open("#/vol/members?theme=light", {
			reader: readerWith({
				people: unbuilt("people"),
				membersSummary: unbuilt("membersSummary"),
			}),
		});
		const failures = all("[data-test=load-failed]");
		expect(failures).toHaveLength(2);
		for (const failure of failures) {
			expect(failure.dataset.kind).toBe("not_available");
			expect(failure.textContent).toContain("Not available yet");
		}
		expect(all("[data-test=member-row]")).toHaveLength(0);
		expect(all("[data-test=members-stat]")).toHaveLength(0);
		expect(all("[data-test=load-retry]")).toHaveLength(0);
		expect(pane.toasts().map((toast) => toast.tone)).toEqual([
			"warning",
			"warning",
		]);
		expect(all("[data-test=toast-action]")).toHaveLength(0);
	});
	test("the income: the stat says it is not available instead of a figure", async () => {
		await open("#/vol/members?theme=light", {
			reader: readerWith({ membersIncome: unbuilt("membersIncome") }),
		});
		const income = text(
			"[data-test=members-stat][data-stat=income] [data-test=stat-value]",
		);
		expect(income).toBe("— Not available");
		expect(income).not.toMatch(/\d/);
		expect(all("[data-test=member-row]")).toHaveLength(8);
	});
	test("a person's lists: the drawer says so where they would be, and what needs them is off with its reason", async () => {
		await open("#/vol/members?member=m_012&theme=light", {
			reader: readerWith({ memberDetail: unbuilt("memberDetail") }),
		});
		await waitFor(
			() =>
				all("[data-test=member-drawer] [data-test=load-failed]").length === 1,
			"the message",
		);
		expect(text("[data-test=member-drawer] [data-test=load-failed]")).toContain(
			"Not available yet",
		);
		expect(all("[data-test=payment-row]")).toHaveLength(0);
		expect(all("[data-test=history-item]")).toHaveLength(0);
		expect(all("[data-test=history-empty]")).toHaveLength(0);
		await click("[data-test=member-drawer] [data-test=member-menu-button]");
		for (const action of ["release", "csv", "stripe"]) {
			const item = document.querySelector<HTMLButtonElement>(
				`[data-test=member-menu-item][data-action=${action}]`,
			);
			expect(item?.getAttribute("aria-disabled")).toBe("true");
			expect(item?.title).toBe("Not available yet");
		}
	});
	test("an action the capabilities call not built is off with the words 'Not available yet'", async () => {
		const fixture = fixtureReader();
		await open("#/vol/members?theme=light", {
			reader: readerWith({
				capabilities: (async (query: never) => {
					const capabilities: Capabilities = await fixture.capabilities(query);
					const actions = Object.fromEntries(
						Object.keys(capabilities.actions).map((name) => [
							name,
							{ allowed: false, reason: "not_built" },
						]),
					);
					return { ...capabilities, actions };
				}) as never,
			}),
		});
		await click(
			'[data-test=member-row][data-id="m_012"] [data-test=member-menu-button]',
		);
		for (const action of [
			"invoice",
			"adjust",
			"refund",
			"switch",
			"cancel",
			"audit",
			"receipt",
		]) {
			const item = document.querySelector<HTMLButtonElement>(
				`[data-test=member-menu-item][data-action=${action}]`,
			);
			expect({
				action,
				disabled: item?.getAttribute("aria-disabled") === "true",
				title: item?.title,
			}).toEqual({
				action,
				disabled: true,
				title: "Not available yet",
			});
		}
	});
	test("a role change the server cannot make: the toast says so and the modal stays, ready to be closed", async () => {
		const writer = writerWith({ changeRole: unbuilt("changeRole") });
		const pane = await open("#/vol/members?theme=light", { writer });
		await click(
			'[data-test=member-row][data-id="m_093"] [data-test=member-menu-button]',
		);
		await click("[data-test=member-menu-item][data-action=remove-admin]");
		await click("[data-test=modal-confirm]");
		await waitFor(
			() => toastTitles(pane).includes("Not available yet"),
			"the toast",
		);
		expect(document.querySelector("[data-test=modal]")).not.toBeNull();
		const confirm = document.querySelector<HTMLButtonElement>(
			"[data-test=modal-confirm]",
		);
		expect(confirm?.getAttribute("aria-busy")).toBeNull();
		expect(confirm?.disabled).toBe(false);
		expect(all("[data-test=history-item][data-pending]")).toHaveLength(0);
		await click("[data-test=modal-cancel]");
		expect(document.querySelector("[data-test=modal]")).toBeNull();
		// The write was sent: closing the modal does not take its toast down.
		expect(toastTitles(pane)).toContain("Not available yet");
	});
	test("the audit: the modal gives the message, not a verdict", async () => {
		await open("#/vol/members?theme=light", {
			reader: readerWith({ auditMember: unbuilt("auditMember") }),
		});
		await click(
			'[data-test=member-row][data-id="m_012"] [data-test=member-menu-button]',
		);
		await click("[data-test=member-menu-item][data-action=audit]");
		await waitFor(
			() => all("[data-test=modal] [data-test=load-failed]").length === 1,
			"the message",
		);
		expect(text("[data-test=modal] [data-test=load-failed]")).toContain(
			"Not available yet",
		);
		expect(all("[data-test=modal-preview]")).toHaveLength(0);
		expect(all("[data-test=audit-loading]")).toHaveLength(0);
	});
	test("an unreadable plans list keeps the Switch modal from offering an empty choice", async () => {
		await open("#/vol/members?theme=light", {
			reader: readerWith({ switchTiers: unbuilt("switchTiers") }),
		});
		await click(
			'[data-test=member-row][data-id="m_012"] [data-test=member-menu-button]',
		);
		await click("[data-test=member-menu-item][data-action=switch]");
		expect(text("[data-test=modal] [data-test=load-failed]")).toContain(
			"Not available yet",
		);
		expect(all("[data-test=modal-confirm]")).toHaveLength(0);
		expect(all("[data-test=modal-field]")).toHaveLength(0);
	});
});

describe("a read the pane no longer wants", () => {
	test("leaving Members while a person's lists are read: a late failure makes no toast and no log entry", async () => {
		let reject: (error: unknown) => void = () => undefined;
		const pane = await open("#/vol/members?member=m_012&theme=light", {
			reader: readerWith({
				memberDetail: (() =>
					new Promise((_, fail) => {
						reject = fail;
					})) as never,
			}),
			waitForRoute: false,
		});
		await until(
			() => all("[data-test=member-row]").length === 8,
			"the roster",
			800,
		);
		await settle(10);
		await click("[data-test=tab][data-tab=plans]");
		reject(new AdapterError("network", "offline"));
		await new Promise((resolve) => setTimeout(resolve, 600));
		await settle();
		expect(pane.toasts()).toEqual([]);
		expect(pane.log.entries()).toEqual([]);
	});
});

describe("writes through the Effect layer", () => {
	test("an adjustment that cannot be reached keeps the modal open with Retry, and Retry sends the same request", async () => {
		const calls: unknown[] = [];
		const writer = writerWith({
			adjustCredits: (async (request: unknown) => {
				calls.push(request);
				if (calls.length <= 3)
					throw new AdapterError("unavailable", "catching up", { status: 503 });
				return { accepted: true };
			}) as never,
		});
		const pane = await open("#/vol/members?theme=light", { writer });
		await click(
			'[data-test=member-row][data-id="m_012"] [data-test=member-menu-button]',
		);
		await click("[data-test=member-menu-item][data-action=adjust]");
		await fill(
			"[data-test=modal-field][data-field=note]",
			"Make-up for a cancelled class",
		);
		await click("[data-test=modal-confirm]");
		expect(
			document
				.querySelector<HTMLButtonElement>("[data-test=modal-confirm]")
				?.getAttribute("aria-busy"),
		).toBe("true");
		await waitFor(
			() => all("[data-test=toast-action]").length === 1,
			"the Retry action",
			1800,
		);
		expect(calls).toHaveLength(3);
		expect(document.querySelector("[data-test=modal]")).not.toBeNull();
		expect(
			document.querySelector<HTMLButtonElement>("[data-test=modal-confirm]")
				?.disabled,
		).toBe(false);
		(document.querySelector("[data-test=toast-action]") as HTMLElement).click();
		await waitFor(
			() => document.querySelector("[data-test=modal]") === null,
			"the modal to close",
			1800,
		);
		expect(calls).toHaveLength(4);
		expect(new Set(calls.map((request) => JSON.stringify(request))).size).toBe(
			1,
		);
		expect(toastTitles(pane)).toEqual([
			"Sent. It shows as pending, then in the ledger after the next ship (≤5 min).",
		]);
		expect(
			text('[data-test=member-row][data-id="m_012"] [data-test=pending-badge]'),
		).toContain("→ 22");
	}, 20_000);
	test("a refused adjustment names why and offers no Retry; Cancel leaves its toast", async () => {
		const writer = writerWith({
			adjustCredits: (async () => {
				throw new AdapterError("forbidden", "owner only", {
					status: 403,
					code: "owner_only",
				});
			}) as never,
		});
		const pane = await open("#/vol/members?theme=light", { writer });
		await click(
			'[data-test=member-row][data-id="m_012"] [data-test=member-menu-button]',
		);
		await click("[data-test=member-menu-item][data-action=adjust]");
		await fill(
			"[data-test=modal-field][data-field=note]",
			"Make-up for a cancelled class",
		);
		await click("[data-test=modal-confirm]");
		await waitFor(() => toastTitles(pane).includes("Owners only"), "the toast");
		expect(all("[data-test=toast-action]")).toHaveLength(0);
		await click("[data-test=modal-cancel]");
		await settle();
		expect(toastTitles(pane)).toContain("Owners only");
	});
	test("a drawer booking button waits while its call is on its way, and is ready again after a failure", async () => {
		const writer = writerWith({
			recordOutcome: (async () => {
				throw new AdapterError("forbidden", "no", { status: 403 });
			}) as never,
		});
		const pane = await open("#/vol/members?member=m_204&theme=light", {
			writer,
		});
		await click(
			"[data-test=member-drawer] [data-test=booking-action][data-action=confirm]",
		);
		await waitFor(() => toastTitles(pane).includes("Not allowed"), "the toast");
		const button = document.querySelector<HTMLButtonElement>(
			"[data-test=member-drawer] [data-test=booking-action][data-action=confirm]",
		);
		expect(button?.disabled).toBe(false);
		expect(button?.getAttribute("aria-busy")).toBeNull();
	});
});
