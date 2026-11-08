import { afterEach, describe, expect, test } from "bun:test";
import { flushSync } from "svelte";
import type { KpiQuery } from "$contract/data/kpi-document.ts";
import { AdapterError } from "$contract/http/errors.ts";
import type { MountedApp } from "../../src/app/mount.ts";
import {
	all,
	click,
	fixtureReader,
	openPane,
	readerWith,
	settle,
	text,
	waitFor,
	writerWith,
} from "../s9-2/support.ts";

/**
 * The member portal's state matrix and effects (S9-plan section 5), beside the Preact golden file S6 (golden-s6.test.ts):
 * what a portal shows when it cannot be read (not available, a failure with Retry), that the School books card reads its
 * figures apart from the portal (a failure there is the card's message, never a figure made up), that a preview of another
 * audience writes nothing, that a change the member asks for is a write through the Effect layer (sent for the school and
 * the person of the click, never aborted, its success after leaving silent, its failure an actionable toast that resends the
 * same request), and that a person with no portal leaves the Members tab on screen.
 */
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
	await settle(30);
	return pane;
};
const base = fixtureReader();
const notAvailable = () =>
	new AdapterError("not_available", "no source", { code: "not_available" });
const unavailable = () =>
	new AdapterError("unavailable", "catching up", { status: 503 });
const count = (selector: string): number => all(selector).length;
const portalRoute = "#/b4u/members?portal=s_21&theme=light";

describe("a portal that cannot be read", () => {
	test("a build with no member-scoped read says so in the table's words, with Check again and a way back, and no write is offered", async () => {
		const { toasts } = await open(portalRoute, {
			reader: readerWith({
				memberPortal: (() => Promise.reject(notAvailable())) as never,
			}),
		});
		await waitFor(
			() => count("[data-test=portal-not-available]") === 1,
			"the message",
			2000,
		);
		expect(text("[data-test=portal-not-available]")).toContain(
			"Not available yet",
		);
		expect(text("[data-test=portal-not-available]")).toContain(
			"The member portal is not available from the ledger yet",
		);
		expect(count("[data-test=portal]")).toBe(0);
		expect(count("[data-test=portal-action]")).toBe(0);
		expect(text("body")).not.toMatch(/\bNaN\b|\bundefined\b|\[object|\$0\.00/);
		await click("[data-test=portal-back]");
		await waitFor(
			() =>
				window.location.hash.startsWith("#/b4u/members") &&
				!window.location.hash.includes("portal="),
			"the Members tab",
		);
		await waitFor(() => count("[data-test=member-row]") > 0, "the roster");
		expect(
			toasts().filter(({ tone }) => tone === "error").length,
		).toBeLessThanOrEqual(1);
	});
	test("a portal that fails is the pane's message with Retry; Retry reads it again and the portal shows", async () => {
		let reads = 0;
		const { toasts } = await open(portalRoute, {
			reader: readerWith({
				memberPortal: ((query: never) => {
					reads += 1;
					return reads <= 3
						? Promise.reject(unavailable())
						: base.memberPortal(query);
				}) as never,
			}),
		});
		await waitFor(
			() => count("[data-test=load-failed]") === 1,
			"the message",
			3000,
		);
		expect(text("[data-test=load-failed]")).toContain(
			"The ledger is catching up",
		);
		await waitFor(
			() => toasts().some(({ title }) => title === "The ledger is catching up"),
			"the toast",
		);
		(document.querySelector("[data-test=load-retry]") as HTMLElement).click();
		await waitFor(
			() => count("[data-test=portal]") === 1,
			"the portal after Retry",
			1000,
		);
		expect(count("[data-test=load-failed]")).toBe(0);
		expect(
			toasts().filter(({ tone }) => tone === "error" || tone === "warning"),
		).toEqual([]);
	}, 20_000);
	test("a person with no portal leaves the Members tab on screen", async () => {
		await open("#/b4u/members?portal=s_99&theme=light");
		await waitFor(() => count("[data-test=member-row]") > 0, "the roster");
		expect(count("[data-test=portal]")).toBe(0);
	});
	test("an audience that does not see the roster gets its lock panel and no portal read", async () => {
		const reads: string[] = [];
		await open("#/b4u/members?portal=s_21&as=public&theme=light", {
			reader: readerWith({
				memberPortal: ((query: never) => {
					reads.push("read");
					return base.memberPortal(query);
				}) as never,
			}),
		});
		await waitFor(
			() => count("[data-test=lock-panel]") === 1,
			"the lock panel",
		);
		expect(count("[data-test=portal]")).toBe(0);
		expect(reads).toEqual([]);
	});
});

describe("the School books card reads its figures apart from the portal", () => {
	test("figures asked for the member's audience (public and member documents, the first preset), and nothing else", async () => {
		const asked: KpiQuery[] = [];
		await open(portalRoute, {
			reader: readerWith({
				kpiDocument: ((query: KpiQuery) => {
					asked.push(query);
					return base.kpiDocument(query);
				}) as never,
			}),
		});
		await waitFor(
			() => count("[data-test=books-card] [data-kpi]") === 2,
			"the figures",
		);
		expect(asked.map(({ audience }) => audience).sort()).toEqual([
			"member",
			"public",
		]);
		expect(new Set(asked.map(({ school }) => school))).toEqual(
			new Set(["b4u"]),
		);
	});
	test("a document that cannot be read is the card's message with Retry, the portal stays, and no figure is made up", async () => {
		let reads = 0;
		const { toasts } = await open(portalRoute, {
			reader: readerWith({
				kpiDocument: ((query: KpiQuery) => {
					reads += 1;
					return reads <= 3
						? Promise.reject(unavailable())
						: base.kpiDocument(query);
				}) as never,
			}),
		});
		await waitFor(
			() => count("[data-test=books-figures-failed]") === 1,
			"the card's message",
			3000,
		);
		expect(count("[data-test=portal]")).toBe(1);
		expect(count("[data-test=books-card] [data-kpi]")).toBe(0);
		expect(text("[data-test=books-text]")).not.toMatch(
			/Q\d 20\d\d: |collected/,
		);
		expect(
			toasts().some(({ title }) => title === "The ledger is catching up"),
		).toBe(true);
		await click("[data-test=books-figures-retry]");
		await waitFor(
			() => count("[data-test=books-card] [data-kpi]") === 2,
			"the figures after Retry",
			1500,
		);
		expect(count("[data-test=books-figures-failed]")).toBe(0);
	}, 20_000);
});

describe("a preview of another audience writes nothing", () => {
	test("every write button is off with the preview's title and a click reaches no Writer", async () => {
		const writer = writerWith({});
		await open("#/vol/members?portal=m_204&as=finance&theme=light", { writer });
		await waitFor(() => count("[data-test=portal]") === 1, "the portal");
		const writes = all("[data-test=portal-action]").filter(
			(button) => button.dataset.action !== "books",
		);
		expect(writes.length).toBeGreaterThan(2);
		for (const button of writes) {
			expect((button as HTMLButtonElement).disabled).toBe(true);
			expect(button.title).toBe("Exit preview to act");
			button.click();
		}
		await settle(10);
		expect(writer.calls).toEqual([]);
		expect(count("[data-test=dialog]")).toBe(0);
	});
});

describe("a change the member asks for is a write through the Effect layer", () => {
	const askQuantity = async () => {
		await click("[data-test=portal-action][data-action=quantity]");
		const select = document.querySelector(
			"[data-test=quantity-select]",
		) as HTMLSelectElement;
		select.value = "1";
		select.dispatchEvent(new Event("input", { bubbles: true }));
		flushSync();
		await click("[data-test=dialog-confirm]");
	};
	test("a failure is a toast with Retry that sends the same request; the card is no longer waiting while it is failed, and shows the change once it ships", async () => {
		const requests: string[] = [];
		let tries = 0;
		const writer = writerWith({
			portalChangeQuantity: ((request: unknown) => {
				requests.push(JSON.stringify(request));
				tries += 1;
				return tries <= 3
					? Promise.reject(unavailable())
					: writerWith({}).portalChangeQuantity(request as never);
			}) as never,
		});
		const { toasts } = await open(portalRoute, { writer });
		await waitFor(() => count("[data-test=portal]") === 1, "the portal");
		await askQuantity();
		await waitFor(
			() =>
				toasts().some(
					({ title, tone }) =>
						title === "The ledger is catching up" && tone === "error",
				),
			"the failure toast",
			4000,
		);
		await settle(10);
		expect(count("[data-test=portal-plan-note]")).toBe(0);
		expect(
			(
				document.querySelector(
					"[data-test=portal-action][data-action=quantity]",
				) as HTMLButtonElement
			).disabled,
		).toBe(false);
		await click("[data-test=toast-action]");
		await waitFor(
			() =>
				text("[data-test=portal-plan-note]").includes("Switches to Shine ×1"),
			"the change",
			3000,
		);
		expect(new Set(requests).size).toBe(1);
		expect(JSON.parse(requests[0] ?? "{}")).toEqual({
			school: "b4u",
			profileId: "s_21",
			quantity: 1,
		});
	}, 20_000);
	test("sent for the school and the person of the click, never aborted by leaving; its success after leaving toasts nothing", async () => {
		const writer = writerWith({}, "hold");
		const { toasts } = await open(portalRoute, { writer });
		await waitFor(() => count("[data-test=portal]") === 1, "the portal");
		await askQuantity();
		expect(writer.calls).toEqual([
			{
				method: "portalChangeQuantity",
				args: [{ school: "b4u", profileId: "s_21", quantity: 1 }],
			},
		]);
		await click("[data-test=portal-exit]");
		window.location.hash = "#/vol/members";
		window.dispatchEvent(new Event("hashchange"));
		await settle(20);
		writer.release();
		await settle(30);
		expect(toasts().filter(({ tone }) => tone === "success")).toEqual([]);
		expect(writer.calls.length).toBe(1);
	});
	test("a booking's cancel on its way shows waiting to ship, and a failure takes it back to the button", async () => {
		const writer = writerWith({
			portalCancelBooking: (() =>
				Promise.reject(
					new AdapterError("forbidden", "no", { status: 403 }),
				)) as never,
		});
		const { toasts } = await open(
			"#/b4u/members?portal=s_22&portalTab=bookings&theme=light",
			{ writer },
		);
		await waitFor(
			() => count("[data-test=portal-booking]") > 0,
			"the bookings",
		);
		await click("[data-test=portal-action][data-action=cancel-booking]");
		await waitFor(
			() => toasts().some(({ title }) => title === "Not allowed"),
			"the refusal",
			2000,
		);
		expect(count("[data-test=portal-action][data-action=cancel-booking]")).toBe(
			1,
		);
		expect(text("[data-test=portal-booking-status]")).not.toBe(
			"waiting to ship",
		);
		expect(toasts().filter(({ tone }) => tone === "success")).toEqual([]);
	});
});
