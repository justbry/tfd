import { afterEach, describe, expect, test } from "bun:test";
import { createHttpAdapters } from "$contract/http/adapters.ts";
import { AdapterError, notAvailable } from "$contract/http/errors.ts";
import type { Fetch } from "$contract/http/transport.ts";
import { notConnectedWorker } from "$contract/http/worker-source.ts";
import {
	apiBase,
	fakeFetch,
	manualScheduler,
	memoryStore,
	sequentialKeys,
} from "../../../ledger-ui/test/s8e/helpers.ts";
import { ledgerTokenAnswer } from "../../../ledger-ui/test/s8e/recorded.ts";
import type { MountedApp } from "../../src/app/mount.ts";
import { until } from "../app-harness.ts";
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
} from "./support.ts";

/** The Bookings pane's states and writes that the golden file does not reach: the period, the groups, the lock, the
 * preview, a read that fails or is let go, a write that fails and is tried again with the same Idempotency-Key. */
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

describe("the period and the groups", () => {
	test("this week by default: four day groups, five rows, the chips count the rows", async () => {
		await open("#/vol/bookings?theme=light");
		expect(text("[data-test=booking-range-label]")).toBe("This week");
		expect(
			all("[data-test=booking-day]").map((day) => day.dataset.day),
		).toEqual(["2026-11-04", "2026-11-05", "2026-11-07", "2026-11-08"]);
		expect(all("[data-test=booking-row]")).toHaveLength(5);
		expect(
			all("[data-test=booking-filter]").map((chip) => chip.textContent?.trim()),
		).toEqual([
			"All",
			"Needs outcome (2)",
			"Waiting for approval (1)",
			"Inside cutoff (1)",
		]);
		expect(text("[data-test=booking-note]")).toContain(
			"Credits are reserved when a booking is made",
		);
	});
	test("today, with the overdue group first and its rows carrying their dates", async () => {
		await open("#/vol/bookings?range=day&theme=light");
		const heads = all("[data-test=booking-day]").map((day) =>
			day.textContent?.replace(/\s+/g, " ").trim(),
		);
		expect(heads[0]).toMatch(/^Overdue: needs an outcome \(2\)/);
		expect(heads[1]).toContain("Thu Nov 5 · Today · 1 booking");
		expect(
			text(
				"[data-test=booking-row][data-booking=bk_6qq] [data-test=booking-time]",
			),
		).toBe("Nov 4 10:00");
	});
	test("a day with nothing booked says so", async () => {
		await open("#/vol/bookings?range=day&offset=1&theme=light");
		expect(text("[data-test=booking-empty]")).toBe("Nothing booked on Nov 6.");
		// Only the overdue group has rows: nothing is booked on the day itself.
		expect(
			all("[data-test=booking-day]").map((day) => day.dataset.day),
		).toEqual(["overdue"]);
	});
	test("the top bar's period control is the Bookings one: a day or a week, and a step keeps the filter", async () => {
		await open("#/vol/bookings?filter=outcome&theme=light");
		await until(
			() => document.querySelector("[data-test=period-button]") !== null,
			"the control",
			800,
		);
		expect(text("[data-test=period-word]")).toBe("Week");
		await click("[data-test=period-button]");
		await click("[data-test=period-next]");
		expect(window.location.hash).toContain("offset=1");
		expect(window.location.hash).toContain("filter=outcome");
		expect(text("[data-test=booking-range-label]")).toBe("Next week");
		await click("[data-test=period-option]:nth-of-type(1)");
		expect(window.location.hash).toContain("range=day");
	});
});

describe("nothing is a 0", () => {
	test("while a read is on its way the chips carry no count and the table is not an empty list", async () => {
		const never = () => new Promise<never>(() => undefined);
		const pane = await open("#/vol/bookings?theme=light", {
			reader: readerWith({ bookings: never }),
			waitForRoute: false,
		});
		await settle(30);
		expect(
			all("[data-test=booking-filter]").map((chip) => chip.textContent?.trim()),
		).toEqual([
			"All",
			"Needs outcome",
			"Waiting for approval",
			"Inside cutoff",
		]);
		expect(all("[data-test=booking-empty]")).toHaveLength(0);
		expect(pane.root.textContent).not.toMatch(/\(0\)/);
	});
	test("a read that fails is the pane's message with Retry, never an empty table, and Retry reads again", async () => {
		let calls = 0;
		const pane = await open("#/vol/bookings?theme=light", {
			reader: readerWith({
				bookings: ((query: { from: string }) => {
					calls += 1;
					return calls <= 6
						? Promise.reject(new AdapterError("network", "offline"))
						: fixtureReader().bookings(query as never);
				}) as never,
			}),
		});
		await waitFor(
			() => all("[data-test=load-failed]").length === 1,
			"the message",
			1500,
		);
		expect(text("[data-test=load-failed]")).toContain("No connection");
		expect(all("[data-test=booking-row]")).toHaveLength(0);
		expect(all("[data-test=booking-empty]")).toHaveLength(0);
		expect(toastTitles(pane)).toContain("No connection");
		await click("[data-test=load-retry]");
		await waitFor(
			() => all("[data-test=booking-row]").length === 5,
			"the rows",
		);
		expect(all("[data-test=load-failed]")).toHaveLength(0);
	}, 20_000);
	test("a read the pane no longer wants makes no toast and no log entry", async () => {
		let reject: (error: unknown) => void = () => undefined;
		const pane = await open("#/vol/bookings?theme=light", {
			reader: readerWith({
				bookings: (() =>
					new Promise((_, fail) => {
						reject = fail;
					})) as never,
			}),
			waitForRoute: false,
		});
		await settle(30);
		await click("[data-test=tab][data-tab=plans]");
		reject(new AdapterError("network", "offline"));
		await new Promise((resolve) => setTimeout(resolve, 600));
		await settle();
		expect(pane.toasts()).toEqual([]);
		expect(pane.log.entries()).toEqual([]);
	});
});

describe("who sees the pane", () => {
	test.each(["governance", "member", "public"])(
		"as %s only the lock panel shows, and nothing is read",
		async (audience) => {
			let reads = 0;
			await open(`#/vol/bookings?as=${audience}&theme=light`, {
				reader: readerWith({
					bookings: ((query: never) => {
						reads += 1;
						return fixtureReader().bookings(query);
					}) as never,
				}),
			});
			expect(text("[data-test=lock-panel] [data-test=lock-who]")).toBe(
				"Owners and admins see bookings",
			);
			expect(all("[data-test=booking-row]")).toHaveLength(0);
			expect(reads).toBe(0);
		},
	);
	test("a preview switches every write off with its reason", async () => {
		await open("#/vol/bookings?as=admin&theme=light");
		const writes = all("[data-test=booking-action], [data-test=booking-bulk]");
		expect(writes.length).toBeGreaterThan(0);
		for (const write of writes) {
			expect((write as HTMLButtonElement).disabled).toBe(true);
			expect(write.title).toBe("Exit preview to act");
		}
	});
});

describe("writes through the Effect layer", () => {
	const failing = (error: AdapterError, succeedAfter: number) => {
		const calls: unknown[] = [];
		const writer = writerWith({
			recordOutcome: (async (request: unknown) => {
				calls.push(request);
				if (calls.length <= succeedAfter) throw error;
				return { creditEffect: "not_wired" };
			}) as never,
		});
		return { writer, calls };
	};
	test("a refused write is a toast without Retry, and the booking is offered again", async () => {
		const { writer, calls } = failing(new AdapterError("forbidden", "no"), 99);
		const pane = await open("#/vol/bookings?theme=light", { writer });
		await click(
			"[data-test=booking-action][data-action=confirm][data-booking=bk_6qq]",
		);
		await waitFor(() => toastTitles(pane).includes("Not allowed"), "the toast");
		expect(calls).toHaveLength(1);
		expect(all("[data-test=toast-action]")).toHaveLength(0);
		expect(all("[data-test=booking-action][data-booking=bk_6qq]")).toHaveLength(
			2,
		);
	});
	test("a write that cannot be reached offers Retry, and Retry sends the same request", async () => {
		const { writer, calls } = failing(
			new AdapterError("unavailable", "catching up", { status: 503 }),
			3,
		);
		const pane = await open("#/vol/bookings?theme=light", { writer });
		await click(
			"[data-test=booking-action][data-action=confirm][data-booking=bk_6qq]",
		);
		await waitFor(
			() => all("[data-test=toast-action]").length === 1,
			"the Retry action",
			1500,
		);
		// Three tries in all, then the toast, and the booking is offered again.
		expect(calls).toHaveLength(3);
		expect(toastTitles(pane)).toContain("The ledger is catching up");
		expect(all("[data-test=booking-action][data-booking=bk_6qq]")).toHaveLength(
			2,
		);
		(document.querySelector("[data-test=toast-action]") as HTMLElement).click();
		await waitFor(
			() =>
				text(
					"[data-test=booking-row][data-booking=bk_6qq] [data-test=booking-status]",
				).includes("pending"),
			"the pending row",
		);
		await waitFor(
			() => toastTitles(pane).includes("Attendance confirmed for Ana P."),
			"the success toast",
		);
		expect(calls).toHaveLength(4);
		expect(new Set(calls.map((request) => JSON.stringify(request))).size).toBe(
			1,
		);
		expect(toastTitles(pane)).not.toContain("The ledger is catching up");
	}, 20_000);
	test("the same Idempotency-Key goes with every try of one action, the toast's Retry included", async () => {
		// The real HTTP writer over a fetch that refuses the outcome route (503) until the server "comes back".
		const http = fakeFetch();
		http.always("POST", /\/school-admin\/ledger-token$/, {
			status: 200,
			body: ledgerTokenAnswer(),
		});
		const outcomeKeys: string[] = [];
		let healthy = false;
		const fetch: Fetch = async (url, init) => {
			if (!url.endsWith("/outcome")) return http.fetch(url, init);
			outcomeKeys.push(
				((init.headers ?? {}) as Record<string, string>)["idempotency-key"] ??
					"",
			);
			return healthy
				? new Response(
						JSON.stringify({
							booking: "bk_6qq",
							state: "attended",
							recordedAt: 1,
							creditEffect: "not_wired",
						}),
						{
							status: 200,
							headers: { "content-type": "application/json" },
						},
					)
				: new Response(JSON.stringify({ error: "school_api_unavailable" }), {
						status: 503,
						headers: { "content-type": "application/json" },
					});
		};
		const built = createHttpAdapters({
			fetch,
			apiBase,
			scheduler: manualScheduler(),
			storage: memoryStore(),
			newKey: sequentialKeys(),
			worker: () => notConnectedWorker(),
			files: { save: async () => undefined },
		});
		const pane = await open("#/vol/bookings?theme=light", {
			writer: built.writer,
		});
		await click(
			"[data-test=booking-action][data-action=confirm][data-booking=bk_6qq]",
		);
		await waitFor(
			() => all("[data-test=toast-action]").length === 1,
			"the Retry action",
			1800,
		);
		const first = [...outcomeKeys];
		expect(first.length).toBeGreaterThanOrEqual(3);
		expect(new Set(first).size).toBe(1);
		expect(first[0]).not.toBe("");
		expect(toastTitles(pane)).toContain("The ledger is catching up");
		healthy = true;
		(document.querySelector("[data-test=toast-action]") as HTMLElement).click();
		await waitFor(
			() => toastTitles(pane).includes("Attendance confirmed for Ana P."),
			"the success toast",
			1800,
		);
		expect(new Set(outcomeKeys).size).toBe(1);
		expect(outcomeKeys.length).toBeGreaterThan(first.length);
		expect(toastTitles(pane)).not.toContain("The ledger is catching up");
	}, 20_000);
	test("Remind host is not built: the toast says so, nothing claims a reminder was sent", async () => {
		const writer = writerWith({
			remindHost: (async () => {
				throw notAvailable("remindHost", "no route");
			}) as never,
		});
		const pane = await open("#/vol/bookings?theme=light", { writer });
		await click("[data-test=booking-action][data-action=remind]");
		await waitFor(
			() => toastTitles(pane).includes("Not available yet"),
			"the toast",
		);
		expect(
			toastTitles(pane).some((title) => title.startsWith("Reminder sent")),
		).toBe(false);
		expect(pane.toasts()[0]?.tone).toBe("warning");
		expect(all("[data-test=toast-action]")).toHaveLength(0);
	});
	test("a bulk confirm writes once per booking, in row order, and toasts once when all have answered", async () => {
		const pane = await open("#/vol/bookings?theme=light");
		await click("[data-test=booking-bulk][data-day='2026-11-04']");
		await waitFor(
			() => toastTitles(pane).includes("Attendance confirmed for 2 bookings."),
			"the toast",
		);
		expect(
			toastTitles(pane).filter((title) =>
				title.startsWith("Attendance confirmed"),
			),
		).toHaveLength(1);
	});
});
