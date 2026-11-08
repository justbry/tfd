import { afterEach, describe, expect, test } from "bun:test";
import { AdapterError } from "$contract/http/errors.ts";
import type { MountedApp } from "../../src/app/mount.ts";
import { until } from "../app-harness.ts";
import {
	all,
	click,
	fill,
	fixtureReader,
	fixtureWriter,
	openPane,
	readerWith,
	settle,
	text,
	waitFor,
	writerWith,
} from "./support.ts";

/** The review round's fixes, each with a test that fails without it: a second quick write does not cancel the first;
 * a write that was sent is never aborted, is made for the school of the click, and tells nobody once they left; a
 * partly confirmed batch says so; the menu's reasons reach assistive technology; focus goes back where it was;
 * what is still being read is not shown as empty. */
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
const titles = (pane: Awaited<ReturnType<typeof open>>): string[] =>
	pane.toasts().map((toast) => toast.title);
const goTo = async (hash: string): Promise<void> => {
	window.location.hash = hash;
	window.dispatchEvent(new Event("hashchange"));
	await settle(20);
};
const unavailable = () =>
	new AdapterError("unavailable", "catching up", { status: 503 });

describe("a second quick write of the drawer", () => {
	test("does not cancel the first: both go out and both show their pending effect", async () => {
		const writer = fixtureWriter("hold");
		await open("#/vol/members?member=m_093&theme=light", { writer });
		await click(
			"[data-test=member-drawer] [data-test=booking-action][data-action=confirm][data-booking=bk_6qq]",
		);
		await click(
			"[data-test=member-drawer] [data-test=booking-action][data-action=release][data-booking=bk_9ab]",
		);
		expect(writer.calls.map((call) => call.method)).toEqual([
			"recordOutcome",
			"cancelBooking",
		]);
		writer.release();
		await waitFor(
			() =>
				all("[data-test=member-drawer] [data-test=drawer-booking]").every(
					(row) =>
						row.querySelectorAll("[data-test=booking-action]").length === 0,
				),
			"both bookings waiting to ship",
		);
		expect(text("[data-test=member-drawer]")).not.toContain("Confirm attended");
	});
});

describe("a write that was sent", () => {
	test("is sent to the school of the click when its toast's Retry runs after the school changed", async () => {
		const calls: Array<{ school: string; bookingId: string }> = [];
		const writer = writerWith({
			recordOutcome: (async (request: {
				school: string;
				bookingId: string;
			}) => {
				calls.push(request);
				if (calls.length <= 3) throw unavailable();
				return { creditEffect: "not_wired" };
			}) as never,
		});
		const pane = await open("#/vol/bookings?theme=light", { writer });
		await click(
			"[data-test=booking-action][data-action=confirm][data-booking=bk_6qq]",
		);
		await goTo("#/b4u/bookings?theme=light");
		await waitFor(
			() => all("[data-test=toast-action]").length === 1,
			"the Retry toast",
			1800,
		);
		(document.querySelector("[data-test=toast-action]") as HTMLElement).click();
		await waitFor(() => calls.length === 4, "the retry");
		expect(
			new Set(calls.map((call) => `${call.school}/${call.bookingId}`)),
		).toEqual(new Set(["vol/bk_6qq"]));
		// It worked, and the person is looking at another school: no toast, and the failure toast went.
		await waitFor(() => pane.toasts().length === 0, "the toasts to go");
		// The pending change is Vibes of Light's: it shows when they come back, and B4 Uni's rows are untouched.
		await goTo("#/vol/bookings?theme=light");
		await waitFor(
			() =>
				text(
					"[data-test=booking-row][data-booking=bk_6qq] [data-test=booking-status]",
				).includes("pending"),
			"the pending row",
		);
	}, 20_000);
	test("succeeding after the person left says nothing and logs nothing, but the change is kept", async () => {
		const writer = fixtureWriter("hold");
		const pane = await open("#/vol/bookings?theme=light", { writer });
		await click(
			"[data-test=booking-action][data-action=confirm][data-booking=bk_6qq]",
		);
		await click("[data-test=tab][data-tab=plans]");
		writer.release();
		await settle(30);
		expect(pane.toasts()).toEqual([]);
		expect(pane.log.entries()).toEqual([]);
		await click("[data-test=tab][data-tab=bookings]");
		await waitFor(
			() =>
				text(
					"[data-test=booking-row][data-booking=bk_6qq] [data-test=booking-status]",
				).includes("pending"),
			"the pending row",
		);
	});
	test("failing after the person left keeps an actionable toast, and Retry sends the same request", async () => {
		const calls: unknown[] = [];
		const writer = writerWith({
			recordOutcome: (async (request: unknown) => {
				calls.push(request);
				if (calls.length <= 3) throw unavailable();
				return { creditEffect: "not_wired" };
			}) as never,
		});
		const pane = await open("#/vol/bookings?theme=light", { writer });
		await click(
			"[data-test=booking-action][data-action=confirm][data-booking=bk_6qq]",
		);
		await click("[data-test=tab][data-tab=plans]");
		await waitFor(
			() => all("[data-test=toast-action]").length === 1,
			"the Retry toast",
			1800,
		);
		expect(titles(pane)).toContain("The ledger is catching up");
		(document.querySelector("[data-test=toast-action]") as HTMLElement).click();
		await waitFor(() => calls.length === 4, "the retry");
		expect(new Set(calls.map((request) => JSON.stringify(request))).size).toBe(
			1,
		);
	}, 20_000);
	test("a modal's write is not aborted when the person leaves: its change is kept", async () => {
		const writer = fixtureWriter("hold");
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
		await click("[data-test=tab][data-tab=plans]");
		writer.release();
		await settle(30);
		expect(pane.toasts()).toEqual([]);
		await click("[data-test=tab][data-tab=members]");
		await waitFor(
			() =>
				text(
					'[data-test=member-row][data-id="m_012"] [data-test=pending-badge]',
				).includes("→ 22"),
			"the pending adjustment",
		);
	});
});

describe("a bulk confirm that goes through in part", () => {
	test("says how many were confirmed, and offers again the one that was not", async () => {
		const writer = writerWith({
			recordOutcome: (async (request: { bookingId: string }) => {
				if (request.bookingId === "bk_8zz")
					throw new AdapterError("forbidden", "no", { status: 403 });
				return { creditEffect: "not_wired" };
			}) as never,
		});
		const pane = await open("#/vol/bookings?theme=light", { writer });
		await click("[data-test=booking-bulk][data-day='2026-11-04']");
		await waitFor(
			() => titles(pane).includes("Attendance confirmed for 1 of 2 bookings."),
			"the partial toast",
		);
		expect(titles(pane)).toContain("Not allowed");
		expect(all("[data-test=booking-action][data-booking=bk_8zz]")).toHaveLength(
			2,
		);
		expect(
			text(
				"[data-test=booking-row][data-booking=bk_6qq] [data-test=booking-status]",
			),
		).toContain("pending");
	});
});

describe("accessibility and focus", () => {
	test("a menu item that is off stays focusable and its reason is text it is described by", async () => {
		await open("#/vol/members?theme=light");
		await click(
			'[data-test=member-row][data-id="u_kim"] [data-test=member-menu-button]',
		);
		const item = document.querySelector<HTMLElement>(
			"[data-test=member-menu-item][data-action=csv]",
		);
		expect(item?.getAttribute("aria-disabled")).toBe("true");
		expect((item as HTMLButtonElement).disabled).toBe(false);
		const described = document.getElementById(
			item?.getAttribute("aria-describedby") ?? "",
		);
		expect(described?.textContent).toBe("No plan, so no payment history");
		expect(described?.closest("[aria-hidden=true]")).toBeNull();
		item?.click();
		await settle();
		expect(document.querySelector("[data-test=modal]")).toBeNull();
		expect(document.querySelector("[data-test=member-menu]")).not.toBeNull();
	});
	test("the arrows walk the items that are off too", async () => {
		await open("#/vol/members?theme=light");
		await click(
			'[data-test=member-row][data-id="u_kim"] [data-test=member-menu-button]',
		);
		const menu = document.querySelector(
			"[data-test=member-menu]",
		) as HTMLElement;
		const off = menu.querySelector<HTMLElement>(
			"[aria-disabled=true]",
		) as HTMLElement;
		off.focus();
		expect(document.activeElement).toBe(off);
		off.dispatchEvent(
			new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
		);
		expect(document.activeElement).not.toBe(off);
	});
	test("the balance bar is an image with its numbers as its name", async () => {
		await open("#/vol/members?theme=light");
		const bar = document.querySelector(
			'[data-test=member-row][data-id="m_012"] [data-test=balance-bar]',
		);
		expect(bar?.getAttribute("role")).toBe("img");
		expect(bar?.getAttribute("aria-label")).toBe(
			"Balance: used 10, held 2, available 20",
		);
	});
	test("choosing a period option sends focus back to the period button", async () => {
		await open("#/vol/bookings?theme=light");
		await until(
			() => document.querySelector("[data-test=period-button]") !== null,
			"the control",
			800,
		);
		await click("[data-test=period-button]");
		await click("[data-test=period-option]:nth-of-type(2)");
		expect((document.activeElement as HTMLElement | null)?.id).toBe("pb");
	});
	test("after the no-show dialog, focus is on the booking's row, not on nothing", async () => {
		await open("#/vol/bookings?theme=light");
		await click(
			"[data-test=booking-action][data-action=noshow][data-booking=bk_6qq]",
		);
		await click("[data-test=dialog-confirm]");
		await waitFor(
			() =>
				(document.activeElement as HTMLElement | null)?.dataset.booking ===
				"bk_6qq",
			"focus on the row",
		);
	});
	test("after a modal closes, focus goes back to the ⋯ button it came from", async () => {
		await open("#/vol/members?theme=light");
		const button =
			'[data-test=member-row][data-id="m_012"] [data-test=member-menu-button]';
		await click(button);
		await click("[data-test=member-menu-item][data-action=adjust]");
		await click("[data-test=modal-cancel]");
		await waitFor(
			() => document.activeElement === document.querySelector(button),
			"focus on the ⋯ button",
		);
	});
});

describe("what is still being read is not shown as empty", () => {
	test("the invoice modal says it is loading, then offers the items", async () => {
		let resolve: (
			items: Awaited<
				ReturnType<ReturnType<typeof fixtureReader>["invoiceItems"]>
			>,
		) => void = () => undefined;
		const reader = readerWith({
			invoiceItems: (() =>
				new Promise((done) => {
					resolve = done as typeof resolve;
				})) as never,
		});
		await open("#/vol/members?theme=light", { reader });
		await click(
			'[data-test=member-row][data-id="m_012"] [data-test=member-menu-button]',
		);
		await click("[data-test=member-menu-item][data-action=invoice]");
		expect(text("[data-test=modal-loading]")).toBe("Loading the items…");
		expect(text("[data-test=modal]")).not.toContain(
			"There is nothing to invoice",
		);
		expect(
			(document.querySelector("[data-test=modal-confirm]") as HTMLButtonElement)
				.disabled,
		).toBe(true);
		resolve(await fixtureReader().invoiceItems({ schoolId: "vol" }));
		await waitFor(
			() =>
				document.querySelector("[data-test=modal-field][data-field=item]") !==
				null,
			"the items",
		);
		expect(document.querySelector("[data-test=modal-loading]")).toBeNull();
	});
	test("the switch modal says it is loading too", async () => {
		const reader = readerWith({
			switchTiers: (() => new Promise(() => undefined)) as never,
		});
		await open("#/vol/members?theme=light", { reader });
		await click(
			'[data-test=member-row][data-id="m_012"] [data-test=member-menu-button]',
		);
		await click("[data-test=member-menu-item][data-action=switch]");
		expect(text("[data-test=modal-loading]")).toBe("Loading the plans…");
		expect(text("[data-test=modal]")).not.toContain("no other plan");
	});
});

describe("smaller fixes", () => {
	test("a refund Stripe refused has its own message, not 'check the fields'", async () => {
		const writer = writerWith({
			refund: (async () => ({
				refundId: "re_1",
				status: "failed",
				refundedCents: 0,
				remainingCents: 100,
			})) as never,
		});
		const pane = await open("#/vol/members?theme=light", { writer });
		await click(
			'[data-test=member-row][data-id="m_012"] [data-test=member-menu-button]',
		);
		await click("[data-test=member-menu-item][data-action=refund]");
		await fill(
			"[data-test=modal-field][data-field=typed]",
			String(
				Number.parseFloat(
					(
						document.querySelector(
							"[data-test=modal-field][data-field=amount]",
						) as HTMLInputElement
					).value,
				).toFixed(2),
			),
		);
		await fill("[data-test=modal-field][data-field=note]", "Duplicate charge");
		await click("[data-test=modal-confirm]");
		await waitFor(
			() => titles(pane).includes("Stripe refused the refund"),
			"the toast",
		);
		expect(titles(pane)).not.toContain("The request was refused");
	});
	test("the adjust preview counts what is already pending, and the field takes whole numbers", async () => {
		await open("#/vol/members?theme=light");
		const button =
			'[data-test=member-row][data-id="m_012"] [data-test=member-menu-button]';
		await click(button);
		await click("[data-test=member-menu-item][data-action=adjust]");
		expect(
			(
				document.querySelector(
					"[data-test=modal-field][data-field=delta]",
				) as HTMLInputElement
			).step,
		).toBe("1");
		await fill(
			"[data-test=modal-field][data-field=note]",
			"Make-up for a cancelled class",
		);
		await click("[data-test=modal-confirm]");
		await waitFor(
			() => document.querySelector("[data-test=modal]") === null,
			"the modal to close",
		);
		await click(button);
		await click("[data-test=member-menu-item][data-action=adjust]");
		expect(text("[data-test=modal-preview]")).toContain("22 → 24");
	});
});
