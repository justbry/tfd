import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { IncomeStatement, LedgerQuery } from "$contract/data/ledger.ts";
import type { Reader } from "$contract/data/reader.ts";
import { AdapterError } from "$contract/http/errors.ts";
import type { MountedApp } from "../../src/app/mount.ts";
import { chunks } from "../../src/app/Shell.svelte";
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
} from "../s9-2/support.ts";

/**
 * The Ledger and Reports tabs' state matrix and their effects (S9-plan section 5), beside the Preact golden file run in
 * golden-s5.test.ts: what each audience, PIN state and period shows, that every figure is the Reader's (a statement no
 * fixture produces), that a read that fails is the pane's message in the message table's words with Retry where the table
 * has one (never an empty table or a 0), that every independent read has its own toast owner, that a read abandoned by
 * leaving makes no toast and no log entry, and that a download is a write through the Effect layer: sent for the school
 * and the rows of the click, never aborted, its success after leaving silent, its failure an actionable toast.
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
	await settle();
	return pane;
};
const goTo = async (hash: string): Promise<void> => {
	window.location.hash = hash;
	window.dispatchEvent(new Event("hashchange"));
	await settle(20);
};
const unavailable = () =>
	new AdapterError("unavailable", "catching up", { status: 503 });
const notAvailable = () =>
	new AdapterError("not_available", "no source", { code: "not_available" });
const base = fixtureReader();
const count = (selector: string): number => all(selector).length;
/** Vibes of Light as a school with no currency (no published menu, no Stripe account): the Reader's `currency` is null. */
const noCurrencySchools = async () =>
	(await base.schools()).map((school) =>
		school.id === "vol" ? { ...school, currency: null } : school,
	);

// ---- The Ledger

describe("the Ledger: what each audience and route shows", () => {
	test("it asks the Reader for the route's period, type, drill-down and promo, and nothing else", async () => {
		const queries: LedgerQuery[] = [];
		const reader = readerWith({
			ledger: ((query: LedgerQuery) => {
				queries.push(query);
				return base.ledger(query);
			}) as never,
		});
		await open(
			"#/vol/ledger?month=2026-10&type=credit&drill=refund&promo=c_01&theme=light",
			{ reader },
		);
		expect(queries).toEqual([
			{
				school: "vol",
				from: "2026-10-01",
				to: "2026-10-31",
				type: "credit",
				drill: "refund",
				promo: "c_01",
			},
		]);
		expect(text("[data-test=ledger-filter]")).toContain("Filter: Refunds ×");
	});
	test("an unknown type or drill-down is ignored", async () => {
		await open("#/vol/ledger?type=everything&drill=nonsense&theme=light");
		expect(count("[data-test=ledger-filter]")).toBe(0);
		expect(
			count('[data-test=ledger-type][data-type=all][aria-pressed="true"]'),
		).toBe(1);
	});
	test("an audience without the grant gets the lock panel and no read; an admin is pointed to Members", async () => {
		for (const audience of ["public", "member", "governance", "admin"]) {
			let reads = 0;
			const reader = readerWith({
				ledger: ((query: LedgerQuery) => {
					reads += 1;
					return base.ledger(query);
				}) as never,
			});
			const pane = await open(`#/vol/ledger?as=${audience}&theme=light`, {
				reader,
			});
			expect(count("[data-test=lock-panel]")).toBe(1);
			expect(reads).toBe(0);
			if (audience === "admin")
				expect(text("[data-test=lock-body]")).toContain(
					"see the roster, balances and bookings in Members",
				);
			else
				expect(text("[data-test=lock-body]")).toContain(
					`sees totals in Reports and the Dashboard.`,
				);
			await pane.app.unmount();
			document.body.innerHTML = "";
			mounted = undefined;
		}
	});
	test("a PIN-locked view shows the prompt, reads nothing, and the rows come back once four digits unlock it", async () => {
		let reads = 0;
		const reader = readerWith({
			ledger: ((query: LedgerQuery) => {
				reads += 1;
				return base.ledger(query);
			}) as never,
		});
		const pane = await open(
			"#/b4u/ledger?month=2026-11&pin=locked&theme=light",
			{ reader },
		);
		expect(reads).toBe(0);
		expect(
			(document.querySelector("[data-test=pin-unlock]") as HTMLButtonElement)
				.disabled,
		).toBe(true);
		await fill("[data-test=pin-input]", "1234");
		await click("[data-test=pin-unlock]");
		await waitFor(() => count("[data-test=ledger-row]") === 5, "the rows");
		expect(window.location.hash).toBe("#/b4u/ledger?month=2026-11&theme=light");
		expect(pane.toasts().map((toast) => toast.title)).toContain(
			"Books unlocked for this session.",
		);
	});
	test("a count of one reads event, not events, and the credit column is named after the unit", async () => {
		await open("#/vol/ledger?type=payout&theme=light");
		expect(text("[data-test=ledger-count]")).toBe("1 event · America/Denver");
		expect(text("[data-test=ledger-credit-head]")).toBe("Sessions");
	});
	test("Details opens a row's line and closes it again, from the button and from the row", async () => {
		await open("#/vol/ledger?theme=light");
		const row = "[data-test=ledger-row][data-event=vol-e5]";
		expect(
			document.querySelector(`${row} button`)?.getAttribute("aria-expanded"),
		).toBe("false");
		await click(`${row} button`);
		expect(text("[data-test=ledger-details]")).toContain(
			"payment.succeeded · source stripe",
		);
		expect(text("[data-test=ledger-details]")).toContain('"kind":"gift"');
		expect(
			document.querySelector(`${row} button`)?.getAttribute("aria-expanded"),
		).toBe("true");
		await click(row);
		expect(count("[data-test=ledger-details]")).toBe(0);
	});
	test("a write the outbox has not shipped is listed first under Waiting to ship, with a pending badge", async () => {
		const reader = readerWith({
			ledger: (async (query: LedgerQuery) => {
				const page = await base.ledger(query);
				const first = page.days[0]?.entries[0];
				if (!first) throw new Error("no rows");
				return {
					...page,
					pending: [{ ...first, pending: true }],
					days: page.days.map((day, index) => ({
						...day,
						entries: index === 0 ? day.entries.slice(1) : day.entries,
					})),
				};
			}) as never,
		});
		await open("#/vol/ledger?theme=light", { reader });
		expect(text("[data-test=ledger-pending]")).toBe(
			"Waiting to ship (1) · each ships within 5 min",
		);
		expect(
			text("[data-test=ledger-row][data-event=vol-e0] [data-test=ledger-time]"),
		).toBe("just now");
		expect(
			text(
				"[data-test=ledger-row][data-event=vol-e0] [data-test=ledger-event]",
			),
		).toBe("Sessions held pending");
		expect(
			document
				.querySelector("[data-test=ledger-row]")
				?.getAttribute("data-event"),
		).toBe("vol-e0");
	});
	test("a school with no currency reads — for a day's amount, never $0.00", async () => {
		const reader = readerWith({
			schools: noCurrencySchools as never,
			ledger: (async (query: LedgerQuery) => ({
				...(await base.ledger(query)),
				currency: null,
			})) as never,
		});
		await open("#/vol/ledger?theme=light", { reader });
		expect(text("[data-test=ledger-day-amount]")).toBe("—");
		expect(text("body")).not.toContain("$0.00");
	});
});

describe("the Ledger: reads that fail", () => {
	test("a page that cannot load is the pane's message with Retry, and Retry reads it again", async () => {
		let reads = 0;
		const reader = readerWith({
			ledger: ((query: LedgerQuery) => {
				reads += 1;
				if (reads <= 3) return Promise.reject(unavailable());
				return base.ledger(query);
			}) as never,
		});
		const pane = await open("#/vol/ledger?theme=light", { reader });
		await waitFor(
			() => count("[data-test=load-failed]") === 1,
			"the message",
			3000,
		);
		expect(text("[data-test=load-failed]")).toContain(
			"The ledger is catching up",
		);
		expect(count("[data-test=ledger-row]")).toBe(0);
		expect(count("[data-test=ledger-count]")).toBe(0);
		await waitFor(
			() =>
				pane
					.toasts()
					.some((toast) => toast.title === "The ledger is catching up"),
			"the toast",
		);
		(document.querySelector("[data-test=load-retry]") as HTMLElement).click();
		await waitFor(
			() => count("[data-test=ledger-row]") === 15,
			"the rows after Retry",
			1000,
		);
		expect(count("[data-test=load-failed]")).toBe(0);
		expect(
			pane
				.toasts()
				.filter((toast) => toast.tone === "error" || toast.tone === "warning"),
		).toEqual([]);
	}, 20_000);
	test("a read nothing provides yet says so in the table's words, with no Retry and no empty table", async () => {
		const reader = readerWith({
			ledger: (() => Promise.reject(notAvailable())) as never,
		});
		await open("#/vol/ledger?theme=light", { reader });
		await waitFor(() => count("[data-test=load-failed]") === 1, "the message");
		expect(text("[data-test=load-failed]")).toContain("Not available yet");
		expect(count("[data-test=load-retry]")).toBe(0);
		expect(count("table")).toBe(0);
		expect(text("body")).not.toMatch(/\b0 events\b/);
	});
	test("the route is on screen with the message (root.dataset.route is set)", async () => {
		const reader = readerWith({
			ledger: (() => Promise.reject(notAvailable())) as never,
		});
		const pane = await open("#/vol/ledger?theme=light", { reader });
		await waitFor(
			() => pane.root.dataset.route === window.location.hash,
			"the route",
		);
	});
	test("a promo that cannot be named leaves the rows and its chip on the promo's id, with its own toast", async () => {
		const reader = readerWith({
			promos: (() => Promise.reject(notAvailable())) as never,
		});
		const pane = await open(
			"#/vol/ledger?month=2026-01-01..2026-11-05&promo=c_01&theme=light",
			{ reader },
		);
		await waitFor(() => count("[data-test=ledger-row]") === 1, "the rows");
		expect(text("[data-test=ledger-filter]")).toBe("Promo c_01 ×");
		await waitFor(() => pane.toasts().length === 1, "the toast");
		expect(pane.toasts()[0]?.title).toBe("Not available yet");
	});
	test("a read abandoned by leaving makes no toast and no log entry", async () => {
		let release: (() => void) | undefined;
		const reader = readerWith({
			ledger: (() =>
				new Promise((_, reject) => {
					release = () => reject(unavailable());
				})) as never,
		});
		const pane = await open("#/vol/ledger?theme=light", {
			reader,
			waitForRoute: false,
		});
		await settle(10);
		await goTo("#/vol/plans?theme=light");
		release?.();
		await settle(40);
		expect(pane.toasts()).toEqual([]);
		expect(pane.log.entries()).toEqual([]);
	});
});

describe("the Ledger's download is a write through the Effect layer", () => {
	test("it sends the file of the click through the Writer, busy until the Writer answers, then counts the rows", async () => {
		const writer = fixtureWriter("hold");
		const pane = await open("#/vol/ledger?theme=light", { writer });
		(document.querySelector("[data-test=ledger-csv]") as HTMLElement).click();
		await settle();
		expect(
			document
				.querySelector("[data-test=ledger-csv]")
				?.getAttribute("aria-busy"),
		).toBe("true");
		expect(pane.toasts()).toEqual([]);
		writer.release();
		await waitFor(() => pane.toasts().length === 1, "the toast");
		expect(pane.toasts()[0]?.title).toBe("Downloaded 15 rows");
		expect(writer.calls[0]?.method).toBe("download");
		expect((writer.calls[0]?.args[0] as { name: string }).name).toBe(
			"ledger-2026-11-01_2026-11-30.csv",
		);
	});
	test("a pending row is in the file as Pending", async () => {
		const reader = readerWith({
			ledger: (async (query: LedgerQuery) => {
				const page = await base.ledger(query);
				const first = page.days[0]?.entries[0];
				if (!first) throw new Error("no rows");
				return {
					...page,
					pending: [{ ...first, pending: true }],
					days: page.days.slice(1),
				};
			}) as never,
		});
		const writer = fixtureWriter("instant");
		await open("#/vol/ledger?theme=light", { reader, writer });
		await click("[data-test=ledger-csv]");
		const file = writer.calls[0]?.args[0] as { text: string };
		expect(file.text.split("\r\n")[1]).toContain(",Pending,");
	});
	test("a download that fails is a toast from the message table with Retry, the button comes back, and Retry sends the same request", async () => {
		const files: unknown[] = [];
		const writer = writerWith({
			download: (async (file: unknown) => {
				files.push(file);
				if (files.length <= 3) throw unavailable();
			}) as never,
		});
		const pane = await open("#/vol/ledger?theme=light", { writer });
		await click("[data-test=ledger-csv]");
		await waitFor(
			() => all("[data-test=toast-action]").length === 1,
			"the Retry toast",
			3000,
		);
		expect(pane.toasts().map((toast) => toast.title)).toContain(
			"The ledger is catching up",
		);
		expect(
			document
				.querySelector("[data-test=ledger-csv]")
				?.hasAttribute("disabled"),
		).toBe(false);
		(document.querySelector("[data-test=toast-action]") as HTMLElement).click();
		await waitFor(() => files.length === 4, "the retry");
		expect(new Set(files.map((file) => JSON.stringify(file))).size).toBe(1);
		await waitFor(
			() => pane.toasts().some((toast) => toast.title === "Downloaded 15 rows"),
			"the success",
		);
	}, 20_000);
	test("a Writer that refuses without a way back is a toast with no Retry, and the failure is not swallowed", async () => {
		const writer = writerWith({
			download: (() =>
				Promise.reject(
					new AdapterError("forbidden", "no", { status: 403 }),
				)) as never,
		});
		const pane = await open("#/vol/ledger?theme=light", { writer });
		await click("[data-test=ledger-csv]");
		await waitFor(() => pane.toasts().length === 1, "the toast");
		expect(pane.toasts()[0]?.title).toBe("Not allowed");
		expect(all("[data-test=toast-action]").length).toBe(0);
	});
	test("succeeding after the person left says nothing; the file was the click's", async () => {
		const writer = fixtureWriter("hold");
		const pane = await open("#/vol/ledger?theme=light", { writer });
		await click("[data-test=ledger-csv]");
		await goTo("#/vol/plans?theme=light");
		writer.release();
		await settle(30);
		expect(pane.toasts()).toEqual([]);
		expect(pane.log.entries()).toEqual([]);
		expect(writer.calls.length).toBe(1);
	});
	test("a school change after the click keeps the file of the click and says nothing at the end", async () => {
		const writer = fixtureWriter("hold");
		const pane = await open("#/vol/ledger?theme=light", { writer });
		await click("[data-test=ledger-csv]");
		await goTo("#/b4u/ledger?month=2026-11&theme=light");
		await settle(20);
		writer.release();
		await settle(30);
		expect(pane.toasts()).toEqual([]);
		expect((writer.calls[0]?.args[0] as { text: string }).text).toContain(
			"Massage 90",
		);
	});
});

// ---- Reports

const amounts = {
	memberships: 700_000,
	bookings: 30_000,
	discounts: -5000,
	income: 725_000,
	refunds: -12_300,
	fees: -4500,
	net: 708_200,
	giftsSold: 2500,
	paidOut: 650_000,
};
/** A statement no school fixture produces, so a pane that works anything out itself is caught. */
const statementOf = (change: Partial<IncomeStatement>): IncomeStatement => ({
	school: "vol",
	from: "2026-11-01",
	to: "2026-11-30",
	currency: "USD",
	unit: { one: "session", other: "sessions" },
	basis: { kind: "cash" },
	matchesStripe: true,
	counts: { payments: 1, refunds: 1, payouts: 1 },
	amounts,
	giftsOutstanding: { amountCents: 1000, credits: 1, count: 1 },
	income: {
		step: "day",
		points: [{ start: "2026-11-01", amountCents: 100 }],
		through: "2026-11-05",
		totalCents: 123_456,
		peak: { start: "2026-11-01", amountCents: 7700 },
	},
	previous: null,
	...change,
});
const statementReader = (statement: IncomeStatement): Reader =>
	readerWith({ incomeStatement: (async () => statement) as never });
const kpi = (item: string, part: string): string =>
	text(
		`[data-test=report-kpi][data-item=${item}] [data-test=report-kpi-${part}]`,
	);

describe("Reports: every figure is the Reader's", () => {
	test("nothing on the statement is worked out in the pane", async () => {
		await open("#/vol/reports?theme=light", {
			reader: statementReader(statementOf({})),
		});
		expect(kpi("income", "value")).toBe("$7,250.00");
		expect(
			text(
				"[data-test=report-line][data-line=net] [data-test=report-line-amount]",
			),
		).toBe("$7,082.00");
		expect(
			text(
				"[data-test=report-line][data-line=discounts] [data-test=report-line-amount]",
			),
		).toBe("−$50.00");
		expect(text("[data-test=report-spark-summary]")).toBe(
			"$1,234.56 · peak $77.00 (Nov 1)",
		);
		expect(text("[data-test=report-status]")).toBe(
			"Matches Stripe · 1 payment, 1 refund, 1 payout Cash basis",
		);
		expect(kpi("gifts", "value")).toBe("$10.00 + 1 session");
		expect(kpi("gifts", "change")).toBe("1 unredeemed gift (a liability)");
	});
	test("a partial month and a deferred basis are said as the Reader says them", async () => {
		await open("#/vol/reports?month=2026-11-01..2026-11-20&theme=light", {
			reader: statementReader(
				statementOf({
					matchesStripe: false,
					basis: { kind: "deferred", from: "2026-12-01" },
					income: {
						step: "week",
						points: [
							{ start: "2026-11-01", amountCents: 100 },
							{ start: "2026-11-08", amountCents: 300 },
						],
						through: "2026-11-05",
						totalCents: 400,
						peak: { start: "2026-11-08", amountCents: 300 },
					},
				}),
			),
		});
		expect(text("[data-test=report-status]")).toBe(
			"Partial month: summed from daily totals. The hledger report and the Stripe match run on whole months. Deferred from Dec 1",
		);
		expect(text("[data-test=report-spark-title]")).toBe("Weekly income");
		expect(text("[data-test=report-spark-summary]")).toBe(
			"$4.00 · peak $3.00 (week of Nov 8)",
		);
		expect(count("[data-test=report-spark-point]")).toBe(2);
	});
	test("a statement not checked against Stripe says so, and a period with no series draws no points", async () => {
		await open("#/vol/reports?theme=light", {
			reader: statementReader(
				statementOf({
					matchesStripe: null,
					income: {
						step: "day",
						points: [],
						through: "2026-11-05",
						totalCents: 0,
						peak: null,
					},
				}),
			),
		});
		expect(text("[data-test=report-stripe-unchecked]")).toBe(
			"Not checked against Stripe yet.",
		);
		expect(text("[data-test=report-spark]")).toContain(
			"No data yet for this period.",
		);
		expect(count("[data-test=report-spark-point]")).toBe(0);
	});
	test("a figure the source does not record is — or Not available yet, never 0", async () => {
		await open("#/vol/reports?theme=light", {
			reader: statementReader(
				statementOf({
					amounts: { ...amounts, discounts: null, giftsSold: null },
					giftsOutstanding: null,
				}),
			),
		});
		expect(
			text(
				"[data-test=report-line][data-line=discounts] [data-test=report-line-amount]",
			),
		).toBe("—");
		expect(text("[data-test=report-line][data-line=gifts]")).toContain(
			"gift certificates sold: not available yet",
		);
		expect(kpi("gifts", "value")).toBe("—");
		expect(kpi("gifts", "change")).toBe("Not available yet");
	});
	test("a school with no currency reads — for every money figure", async () => {
		const reader = readerWith({
			schools: noCurrencySchools as never,
			incomeStatement: (async () => statementOf({ currency: null })) as never,
		});
		await open("#/vol/reports?theme=light", { reader });
		expect(kpi("income", "value")).toBe("—");
		expect(text("[data-test=report-spark-summary]")).toContain("—");
	});
	test("compare reads the change from the server and draws the previous period dashed", async () => {
		const previous = statementOf({}).income;
		await open("#/vol/reports?compare=1&theme=light", {
			reader: statementReader(
				statementOf({
					previous: {
						from: "2026-10-01",
						to: "2026-10-31",
						amounts: { ...amounts, income: 800_000 },
						changes: {
							...amounts,
							memberships: 0,
							bookings: 0,
							discounts: 0,
							income: -75_000,
							refunds: 0,
							fees: 0,
							net: 0,
							giftsSold: 0,
							paidOut: 50_000,
						},
						income: previous,
					},
				}),
			),
		});
		expect(kpi("income", "change")).toBe("▼ $750.00 vs Oct 2026");
		expect(kpi("payout", "change")).toBe("▲ $500.00 vs Oct 2026");
		expect(count("[data-test=report-spark] polyline[stroke-dasharray]")).toBe(
			1,
		);
	});
	test("the Reader is asked for the route's period, and the Download file carries it and the statement's lines", async () => {
		const asked: unknown[] = [];
		const reader = readerWith({
			incomeStatement: ((query: unknown) => {
				asked.push(query);
				return base.incomeStatement(query as never);
			}) as never,
		});
		const writer = fixtureWriter("instant");
		await open(
			"#/vol/reports?month=2026-01-01..2026-11-05&compare=1&theme=light",
			{ reader, writer },
		);
		expect(asked).toEqual([
			{ school: "vol", from: "2026-01-01", to: "2026-11-05", compare: true },
		]);
		await click("[data-test=report-download]");
		expect(writer.calls[0]?.args[0]).toMatchObject({
			name: "income-statement-2026-01-01_2026-11-05.csv",
		});
	});
	test("a line opens its events from a real button; Net opens nothing; the gift line opens the gift events", async () => {
		await open("#/vol/reports?theme=light");
		const line = document.querySelector(
			"[data-test=report-line][data-line=memberships]",
		);
		expect(line?.hasAttribute("tabindex")).toBe(false);
		await click(
			"[data-test=report-line][data-line=memberships] [data-test=report-line-label] button",
		);
		expect(window.location.hash).toContain("#/vol/ledger?");
		expect(window.location.hash).toContain("drill=memb");
		await goTo("#/vol/reports?theme=light");
		expect(
			document
				.querySelector("[data-test=report-line][data-line=net]")
				?.hasAttribute("title"),
		).toBe(false);
		await click("[data-test=report-line][data-line=gifts] button");
		expect(window.location.hash).toContain("drill=gift");
	});
	test("Edit in school settings is for an admin of a real school, and says where it goes", async () => {
		const pane = await open("#/vol/reports?theme=light");
		expect(count("[data-test=report-rules-edit]")).toBe(1);
		await click("[data-test=report-rules-edit]");
		expect(pane.toasts().map((toast) => toast.title)).toContain(
			"Opening school settings in buzz-school…",
		);
		await goTo("#/vol/reports?as=governance&theme=light");
		expect(count("[data-test=report-rules-edit]")).toBe(0);
	});
});

describe("Reports: each audience's document", () => {
	test("below finance the Reader is asked for the audience's document and the statement is never read", async () => {
		const asked: unknown[] = [];
		let statementReads = 0;
		const reader = readerWith({
			incomeStatement: ((query: unknown) => {
				statementReads += 1;
				return base.incomeStatement(query as never);
			}) as never,
			audienceReport: ((query: unknown) => {
				asked.push(query);
				return base.audienceReport(query as never);
			}) as never,
		});
		await open("#/b4u/reports?as=member&month=2026-06&theme=light", { reader });
		expect(asked).toEqual([
			{
				school: "b4u",
				audience: "member",
				from: "2026-06-01",
				to: "2026-06-30",
			},
		]);
		expect(statementReads).toBe(0);
		expect(text("[data-test=report-status]")).toContain(
			"Member document · Q2 2026",
		);
	});
	test("Public Reports at Vibes of Light says <10 payments and — for the money; its delayed periods say when they publish", async () => {
		await open("#/vol/reports?as=public&theme=light");
		expect(text("[data-test=report-status]")).toContain(
			"Public document · 2024: <10 payments",
		);
		expect(text("[data-line=income] [data-test=report-line-amount]")).toBe("—");
		expect(count('[data-line=memberships] [data-figure="suppressed"]')).toBe(1);
		expect(text("[data-test=report-period][data-current] b")).toBe("—");
		const waiting = all(
			"[data-test=report-period][data-waiting] [data-hid=embargoed]",
		);
		expect(waiting.length).toBe(2);
		expect(waiting[0]?.textContent).toBe("Published after 7 Jan 2027");
	});
	test("the document's Download is its six figures, hidden ones named, and its file is named for the audience and period", async () => {
		const writer = fixtureWriter("instant");
		const pane = await open("#/b4u/reports?as=public&theme=light", { writer });
		await click("[data-test=report-download]");
		const file = writer.calls[0]?.args[0] as { name: string; text: string };
		expect(file.name).toBe("books-public-2024.csv");
		expect(file.text.split("\r\n")).toEqual([
			"﻿line,kpi,value,hidden,audience,period",
			'Income,gross_collected,"$4,200",,public,2024',
			"Refunds,refunds,,Members see this,public,2024",
			"Stripe fees,stripe_fees,,Members see this,public,2024",
			"Net,net_income,,Members see this,public,2024",
			"Paid out,payouts,,Governance and up see this,public,2024",
			"Payments,payments_count,156,,public,2024",
			"",
		]);
		await waitFor(
			() => pane.toasts().some((toast) => toast.title === "Downloaded 6 rows"),
			"the toast",
		);
	});
	test("a PIN-locked view shows the prompt and reads nothing", async () => {
		let reads = 0;
		const reader = readerWith({
			incomeStatement: ((query: unknown) => {
				reads += 1;
				return base.incomeStatement(query as never);
			}) as never,
		});
		await open("#/vol/reports?pin=locked&theme=light", { reader });
		expect(count("[data-test=pin-lock]")).toBe(1);
		expect(reads).toBe(0);
		expect(count("[data-test=report-kpi]")).toBe(0);
	});
});

describe("Reports: the donors card", () => {
	test("the owner sees an anonymous donor's name with a badge; the finance admin gets the Reader's Anonymous", async () => {
		const reader = readerWith({
			donors: (async ({ audience }: { audience: string }) => ({
				kind: "identified",
				year: 2026,
				donorCount: 1,
				payerCount: 0,
				rows: [
					{
						id: "d_1",
						name: audience === "owner" ? "Rae Quill" : "Anonymous",
						kind: "donor",
						fund: null,
						payments: 1,
						totalCents: 250_000,
						lastPaymentOn: "2026-02-02",
						anonymous: true,
					},
				],
			})) as never,
		});
		await open("#/vol/reports?theme=light", { reader });
		expect(text("[data-test=donor-name]")).toBe(
			"Rae Quill Anonymous to finance",
		);
		expect(text("[data-test=donors-title]")).toBe(
			"Donors and payers 2026 to date · 1 donor, 0 member payers",
		);
		await goTo("#/vol/reports?as=finance&theme=light");
		expect(text("[data-test=donor-name]")).toBe(
			"Anonymous name with the owner only",
		);
	});
	test("fewer than five donors shows no spread, only the reason", async () => {
		const reader = readerWith({
			donors: (async () => ({
				kind: "spread",
				through: "2026-09",
				donors: { lt: 10 },
				buckets: [],
				medianCents: {
					hidden: "suppressed",
					text: "Hidden: fewer than 5 donors",
				},
			})) as never,
		});
		await open("#/vol/reports?as=governance&theme=light", { reader });
		expect(text("[data-test=donors]")).toContain("<10 donors");
		expect(text("[data-test=donors]")).toContain(
			"Fewer than 5 donors so far, so no spread is shown.",
		);
	});
	test("public and member get a lock panel inside the card", async () => {
		await open("#/vol/reports?as=member&theme=light");
		expect(count("[data-test=donors] [data-test=lock-panel]")).toBe(1);
	});
});

describe("Reports: reads that fail", () => {
	test("a statement that cannot load is the pane's message with Retry; the rules and donors cards wait for it", async () => {
		let reads = 0;
		const reader = readerWith({
			incomeStatement: ((query: unknown) => {
				reads += 1;
				if (reads <= 3) return Promise.reject(unavailable());
				return base.incomeStatement(query as never);
			}) as never,
		});
		const pane = await open("#/vol/reports?theme=light", { reader });
		await waitFor(
			() => count("[data-test=load-failed]") === 1,
			"the message",
			3000,
		);
		expect(text("[data-test=load-failed]")).toContain(
			"The ledger is catching up",
		);
		expect(count("[data-test=report-kpi]")).toBe(0);
		expect(count("[data-test=report-download]")).toBe(0);
		await waitFor(
			() =>
				pane
					.toasts()
					.some((toast) => toast.title === "The ledger is catching up"),
			"the toast",
		);
		(document.querySelector("[data-test=load-retry]") as HTMLElement).click();
		await waitFor(
			() => count("[data-test=report-kpi]") === 5,
			"the report after Retry",
			1000,
		);
		expect(count("[data-test=load-failed]")).toBe(0);
	}, 20_000);
	test("donors nothing provides yet leave the card with the message, and the rest of the report as it is", async () => {
		const reader = readerWith({
			donors: (() => Promise.reject(notAvailable())) as never,
		});
		const pane = await open("#/vol/reports?theme=light", { reader });
		expect(count("[data-test=report-kpi]")).toBe(5);
		expect(text("[data-test=donors] [data-test=load-failed]")).toContain(
			"Not available yet",
		);
		expect(count("[data-test=donor-row]")).toBe(0);
		expect(text("[data-test=donors]")).not.toMatch(/\b0 donors?\b/);
		await waitFor(() => pane.toasts().length === 1, "the toast");
	});
	test("rules that cannot load leave their card with the message; each failing read has its own toast, never merged", async () => {
		const reader = readerWith({
			schoolRules: (() => Promise.reject(notAvailable())) as never,
			donors: (() => Promise.reject(notAvailable())) as never,
		});
		const pane = await open("#/vol/reports?theme=light", { reader });
		expect(text("[data-test=report-rules] [data-test=load-failed]")).toContain(
			"Not available yet",
		);
		expect(count("[data-test=report-kpi]")).toBe(5);
		await waitFor(() => pane.toasts().length === 2, "two toasts");
		expect(new Set(pane.toasts().map((toast) => toast.owner)).size).toBe(2);
	});
	test("a read abandoned by leaving makes no toast and no log entry", async () => {
		const pending: Array<() => void> = [];
		const hold = () =>
			new Promise((_, reject) => {
				pending.push(() => reject(unavailable()));
			});
		const reader = readerWith({
			incomeStatement: hold as never,
			schoolRules: hold as never,
			donors: hold as never,
		});
		const pane = await open("#/vol/reports?theme=light", {
			reader,
			waitForRoute: false,
		});
		await settle(10);
		await goTo("#/vol/plans?theme=light");
		for (const release of pending) release();
		await settle(40);
		expect(pending.length).toBe(3);
		expect(pane.toasts()).toEqual([]);
		expect(pane.log.entries()).toEqual([]);
	});
});

describe("Reports: the downloads are writes", () => {
	test("the donors CSV is busy while the Writer works and counts its rows when it answers", async () => {
		const writer = fixtureWriter("hold");
		const pane = await open("#/vol/reports?theme=light", { writer });
		(document.querySelector("[data-test=donors-csv]") as HTMLElement).click();
		await settle();
		expect(
			document
				.querySelector("[data-test=donors-csv]")
				?.getAttribute("aria-busy"),
		).toBe("true");
		expect(
			document
				.querySelector("[data-test=donors-csv]")
				?.hasAttribute("disabled"),
		).toBe(true);
		writer.release();
		await waitFor(() => pane.toasts().length === 1, "the toast");
		expect(pane.toasts()[0]?.title).toMatch(/^Downloaded \d+ rows$/);
	});
	test("a statement download that fails is an actionable toast and the button is offered again", async () => {
		const writer = writerWith({
			download: (() => Promise.reject(unavailable())) as never,
		});
		const pane = await open("#/vol/reports?theme=light", { writer });
		await click("[data-test=report-download]");
		await waitFor(
			() => all("[data-test=toast-action]").length === 1,
			"the Retry toast",
			3000,
		);
		expect(pane.toasts().map((toast) => toast.title)).toContain(
			"The ledger is catching up",
		);
		expect(
			document
				.querySelector("[data-test=report-download]")
				?.hasAttribute("disabled"),
		).toBe(false);
	}, 20_000);
	test("succeeding after the person left says nothing", async () => {
		const writer = fixtureWriter("hold");
		const pane = await open("#/vol/reports?theme=light", { writer });
		await click("[data-test=report-download]");
		await goTo("#/vol/plans?theme=light");
		writer.release();
		await settle(30);
		expect(pane.toasts()).toEqual([]);
		expect(pane.log.entries()).toEqual([]);
	});
});

describe("each tab is its own chunk", () => {
	for (const [tab, rendered] of [
		["ledger", "[data-test=ledger-type]"],
		["reports", "[data-test=report-kpi]"],
	] as const)
		test(`${tab}: a chunk that fails to load shows its message with Retry and the route on screen; Retry loads it`, async () => {
			const load = chunks[tab];
			let tries = 0;
			chunks[tab] = () => {
				tries += 1;
				return tries === 1
					? Promise.reject(
							new TypeError("Failed to fetch dynamically imported module"),
						)
					: load();
			};
			try {
				const pane = await open(`#/vol/${tab}?theme=light`);
				expect(count("[data-test=load-failed]")).toBe(1);
				expect(pane.root.dataset.route).toBe(`#/vol/${tab}?theme=light`);
				await click("[data-test=load-retry]");
				await waitFor(() => count(rendered) > 0, "the tab");
				expect(count("[data-test=load-failed]")).toBe(0);
				expect(tries).toBe(2);
			} finally {
				chunks[tab] = load;
			}
		});
	test("the Ledger and Reports chunks are two, loaded apart from the shell's first load", () => {
		const loaders = readFileSync(
			join(import.meta.dir, "../../src/app/panes/loaders.ts"),
			"utf8",
		);
		expect(loaders).toContain(
			'ledger: () => import("../ledger/Ledger.svelte")',
		);
		expect(loaders).toContain(
			'reports: () => import("../reports/Reports.svelte")',
		);
	});
});
