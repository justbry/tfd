// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "bun:test";
import {
	type AgingBucket,
	agingBucket,
	BOARD_CSV_HEADER,
	type BoardReport,
	type BoardRow,
	boardReport,
	boardReportCsv,
	type PortfolioNote,
	portfolio,
} from "../src/portfolio";
import type { Role } from "../src/types";

type Fields = Record<string, unknown>;

/*
 * Every note here has rate 0, so a payoff is the principal less what the view counts as paid, and one installment is
 * the whole principal. Dates are fixed so each day count is plain calendar counting.
 */
const terms = (
	principal: string,
	firstDue: string,
	currency = "USD",
	exponent = 2,
): Fields => ({
	currency,
	exponent,
	principal_minor: principal,
	issue_date: "2026-02-01",
	annual_rate: "0",
	day_count: "actual/365",
	rounding: "half-up",
	timezone: "America/Denver",
	schedule: {
		type: "amortized",
		frequency: "monthly",
		count: 1,
		first_due: firstDue,
	},
});

const make = (
	seq: number,
	type: string,
	enteredBy: Role,
	fields: Fields = {},
): Fields => ({
	schema: "tfd.note-event.v1",
	id: `evt-${seq}`,
	note_id: "n",
	seq,
	entered_at: `2026-02-${String(seq + 1).padStart(2, "0")}T10:00:00Z`,
	entered_by: enteredBy,
	type,
	...fields,
});

const created = (t: Fields): Fields =>
	make(1, "note.created", "lender", { terms: t });

const oneInstallment = (
	id: string,
	firstDue: string,
	role: Role = "lender",
	extra: Fields[] = [],
	principal = "10000",
): PortfolioNote => ({
	note_id: id,
	role,
	events: [created(terms(principal, firstDue)), ...extra],
});

const payment = (
	seq: number,
	by: Role,
	amount: string,
	value: string,
): Fields =>
	make(seq, "payment.recorded", by, {
		kind: "payment",
		amount_minor: amount,
		value_date: value,
	});

describe("agingBucket", () => {
	const cases: [number, AgingBucket][] = [
		[-3, "current"],
		[0, "current"],
		[1, "1-30"],
		[30, "1-30"],
		[31, "31-60"],
		[60, "31-60"],
		[61, "61+"],
		[400, "61+"],
	];
	for (const [days, bucket] of cases) {
		it(`${days} days is ${bucket}`, () => {
			expect(agingBucket(days)).toBe(bucket);
		});
	}
});

describe("aging on a real statement", () => {
	// One installment of 10,000 due 2026-03-01, nothing paid. Days overdue is the plain count from 2026-03-01.
	const cases: [string, number, AgingBucket][] = [
		["2026-03-01", 0, "current"],
		["2026-03-02", 1, "1-30"],
		["2026-03-31", 30, "1-30"],
		["2026-04-01", 31, "31-60"],
		["2026-04-30", 60, "31-60"],
		["2026-05-01", 61, "61+"],
	];
	for (const [asOf, days, bucket] of cases) {
		it(`${asOf} is ${days} days overdue: ${bucket}`, () => {
			const { rows } = portfolio([oneInstallment("a", "2026-03-01")], asOf);
			expect(rows).toHaveLength(1);
			expect(rows[0]?.days_overdue).toBe(days);
			expect(rows[0]?.aging).toBe(bucket);
			expect(rows[0]?.overdue_minor).toBe("10000");
		});
	}

	it("is current and not overdue before the due date", () => {
		const { rows } = portfolio(
			[oneInstallment("a", "2026-03-01")],
			"2026-02-20",
		);
		expect(rows[0]).toMatchObject({
			overdue_minor: "0",
			days_overdue: 0,
			aging: "current",
			next_due: "2026-03-01",
		});
	});
});

describe("rows", () => {
	it("sorts by days overdue, most first, then by note id", () => {
		const { rows } = portfolio(
			[
				oneInstallment("b", "2026-03-01"),
				oneInstallment("c", "2026-04-01"),
				oneInstallment("a", "2026-03-01"),
				oneInstallment("d", "2026-06-01"),
			],
			"2026-05-01",
		);
		expect(rows.map((row) => [row.note_id, row.days_overdue])).toEqual([
			["a", 61],
			["b", 61],
			["c", 30],
			["d", 0],
		]);
	});

	it("reports a paid-off view as current with nothing overdue and no next due", () => {
		const { rows } = portfolio(
			[
				oneInstallment("a", "2026-03-01", "lender", [
					payment(2, "lender", "10000", "2026-03-01"),
				]),
			],
			"2026-05-01",
		);
		expect(rows[0]).toMatchObject({
			payoff_minor: "0",
			overdue_minor: "0",
			days_overdue: 0,
			aging: "current",
			next_due: null,
		});
	});

	it("reports a closed note as current and never overdue, and leaves it out of outstanding", () => {
		const closed = oneInstallment("a", "2026-03-01", "lender", [
			make(2, "release.drafted", "lender"),
			make(3, "release.confirmed", "lender", { target: "evt-2" }),
		]);
		const result = portfolio(
			[closed, oneInstallment("b", "2026-03-01")],
			"2026-05-01",
		);
		const row = result.rows.find((entry) => entry.note_id === "a");
		expect(row).toMatchObject({
			closed: true,
			overdue_minor: "0",
			days_overdue: 0,
			aging: "current",
			next_due: null,
			payoff_minor: "10000",
		});
		expect(result.totals).toHaveLength(1);
		expect(result.totals[0]).toMatchObject({
			notes: 2,
			outstanding_payoff_minor: "10000",
			overdue_minor: "10000",
			buckets: { current: 1, "1-30": 0, "31-60": 0, "61+": 1 },
		});
	});

	it("reads the chosen role's view of the same events", () => {
		// The borrower says 10,000 was paid on the due date; the lender has not answered.
		const events = [
			created(terms("10000", "2026-03-01")),
			payment(2, "borrower", "10000", "2026-03-01"),
		];
		const asLender = portfolio(
			[{ note_id: "a", role: "lender", events }],
			"2026-04-01",
		).rows[0];
		const asBorrower = portfolio(
			[{ note_id: "a", role: "borrower", events }],
			"2026-04-01",
		).rows[0];
		expect(asLender).toMatchObject({
			payoff_minor: "10000",
			overdue_minor: "10000",
			days_overdue: 31,
		});
		expect(asBorrower).toMatchObject({
			payoff_minor: "0",
			overdue_minor: "0",
			days_overdue: 0,
		});
		expect(asLender?.awaiting_confirmation).toBe(1);
		expect(asBorrower?.awaiting_confirmation).toBe(1);
	});

	it("counts awaiting-confirmation and disputed items separately", () => {
		const events = [
			created(terms("10000", "2026-03-01")),
			payment(2, "borrower", "1000", "2026-02-10"),
			payment(3, "lender", "2000", "2026-02-11"),
			make(4, "payment.confirmed", "borrower", { target: "evt-3" }),
			payment(5, "borrower", "3000", "2026-02-12"),
			make(6, "payment.disputed", "lender", {
				target: "evt-5",
				counter_amount_minor: "2500",
				reason: "I got 25",
			}),
			payment(7, "lender", "500", "2026-02-13"),
		];
		// evt-2 claimed by borrower (awaiting), evt-3 confirmed (agreed, no difference), evt-5 disputed,
		// evt-7 lender-recorded so it counts in both views (no difference).
		const [row] = portfolio(
			[{ note_id: "a", role: "lender", events }],
			"2026-02-20",
		).rows;
		expect(row).toMatchObject({ awaiting_confirmation: 1, disputed: 1 });
	});

	it("reports the terms state", () => {
		const accepted = oneInstallment("a", "2026-03-01", "lender", [
			make(2, "terms.accepted", "borrower"),
		]);
		const declined = oneInstallment("b", "2026-03-01", "lender", [
			make(2, "terms.declined", "borrower"),
		]);
		const proposed = oneInstallment("c", "2026-03-01");
		const { rows, totals } = portfolio(
			[accepted, declined, proposed],
			"2026-03-01",
		);
		expect(
			Object.fromEntries(rows.map((row) => [row.note_id, row.terms])),
		).toEqual({
			a: "accepted",
			b: "declined",
			c: "proposed",
		});
		expect(totals[0]?.terms_pending).toBe(1);
	});

	it("gives the next installment date the view has not covered", () => {
		// Two installments (10,000 each is not available for amortized count 2 at rate 0: 20,000 splits 10,000 each).
		const t: Fields = {
			...terms("20000", "2026-03-01"),
			schedule: {
				type: "amortized",
				frequency: "monthly",
				count: 2,
				first_due: "2026-03-01",
			},
		};
		const events = [created(t), payment(2, "lender", "10000", "2026-03-01")];
		// On 2026-03-15: paid 10,000 covers the first row only; the next uncovered row is due 2026-04-01.
		expect(
			portfolio([{ note_id: "a", role: "lender", events }], "2026-03-15")
				.rows[0]?.next_due,
		).toBe("2026-04-01");
		// With 20,000 paid nothing is left to come.
		const paid = [created(t), payment(2, "lender", "20000", "2026-03-01")];
		expect(
			portfolio([{ note_id: "a", role: "lender", events: paid }], "2026-03-15")
				.rows[0]?.next_due,
		).toBeNull();
	});
});

describe("a note whose terms were declined", () => {
	// One installment of 10,000 due 2026-03-01; on 2026-05-01 the accepted note is 61 days overdue (bucket 61+).
	const AS_OF = "2026-05-01";
	const accepted = oneInstallment("accepted", "2026-03-01", "lender", [
		make(2, "terms.accepted", "borrower"),
	]);
	const declined = oneInstallment("declined", "2026-03-01", "lender", [
		make(2, "terms.declined", "borrower"),
	]);

	it("is shown as current, nothing overdue and no next due, flagged declined", () => {
		const { rows } = portfolio([declined], AS_OF);
		expect(rows[0]).toMatchObject({
			note_id: "declined",
			terms: "declined",
			declined: true,
			overdue_minor: "0",
			days_overdue: 0,
			aging: "current",
			next_due: null,
		});
		expect(rows[0]?.payoff_minor).toBe("10000");
	});

	it("is flagged only when the latest decision is a decline", () => {
		const reaccepted = oneInstallment("again", "2026-03-01", "lender", [
			make(2, "terms.declined", "borrower"),
			make(3, "terms.accepted", "borrower"),
		]);
		const { rows } = portfolio([reaccepted, accepted, declined], AS_OF);
		expect(
			Object.fromEntries(rows.map((row) => [row.note_id, row.declined])),
		).toEqual({ again: false, accepted: false, declined: true });
		expect(rows.find((row) => row.note_id === "again")?.days_overdue).toBe(61);
	});

	it("is left out of the outstanding payoff, overdue and the buckets, and counted as declined", () => {
		const { totals } = portfolio([accepted, declined], AS_OF);
		expect(totals).toEqual([
			{
				currency: "USD",
				exponent: 2,
				notes: 2,
				outstanding_payoff_minor: "10000",
				overdue_minor: "10000",
				buckets: { current: 0, "1-30": 0, "31-60": 0, "61+": 1 },
				awaiting_confirmation: 0,
				disputed: 0,
				terms_pending: 0,
				declined: 1,
			},
		]);
	});

	it("counts declined per currency and carries the count into the board report and CSV", () => {
		const euro: PortfolioNote = {
			note_id: "euro",
			role: "lender",
			events: [
				created(terms("5000", "2026-03-01", "EUR")),
				make(2, "terms.accepted", "borrower"),
			],
		};
		const result = portfolio([accepted, declined, euro], AS_OF);
		expect(
			Object.fromEntries(
				result.totals.map((total) => [total.currency, total.declined]),
			),
		).toEqual({ EUR: 0, USD: 1 });
		const report = boardReport(result, AS_OF);
		expect(report.totals.map((total) => total.declined)).toEqual([0, 1]);
		expect(
			Object.fromEntries(report.rows.map((row) => [row.note_id, row.declined])),
		).toEqual({ accepted: false, declined: true, euro: false });
		const lines = boardReportCsv(report).split("\n");
		expect(lines[0]).toContain(",terms,declined,closed,next_due");
		expect(lines.find((line) => line.startsWith("declined,"))).toBe(
			"declined,USD,2,lender,10000,0,0,current,0,0,declined,true,false,",
		);
	});
});

describe("totals", () => {
	it("never add across currencies", () => {
		const usdOne = oneInstallment("u1", "2026-03-01");
		const usdTwo = oneInstallment("u2", "2026-04-01", "lender", [], "5000");
		const euro: PortfolioNote = {
			note_id: "e1",
			role: "lender",
			events: [created(terms("7000", "2026-03-01", "EUR"))],
		};
		const yen: PortfolioNote = {
			note_id: "j1",
			role: "lender",
			events: [created(terms("900", "2026-03-01", "JPY", 0))],
		};
		const { totals } = portfolio([euro, usdOne, yen, usdTwo], "2026-05-01");
		expect(
			totals.map((total) => [
				total.currency,
				total.exponent,
				total.notes,
				total.outstanding_payoff_minor,
				total.overdue_minor,
			]),
		).toEqual([
			["EUR", 2, 1, "7000", "7000"],
			["JPY", 0, 1, "900", "900"],
			["USD", 2, 2, "15000", "15000"],
		]);
		expect(totals[2]?.buckets).toEqual({
			current: 0,
			"1-30": 1,
			"31-60": 0,
			"61+": 1,
		});
	});

	it("keeps two exponents of one currency apart", () => {
		const two: PortfolioNote = {
			note_id: "a",
			role: "lender",
			events: [created(terms("100", "2026-03-01", "XTS", 2))],
		};
		const zero: PortfolioNote = {
			note_id: "b",
			role: "lender",
			events: [created(terms("100", "2026-03-01", "XTS", 0))],
		};
		expect(
			portfolio([two, zero], "2026-03-01").totals.map(
				(total) => total.exponent,
			),
		).toEqual([0, 2]);
	});

	it("is empty for an empty portfolio", () => {
		expect(portfolio([], "2026-03-01")).toEqual({
			as_of: "2026-03-01",
			rows: [],
			totals: [],
			invalid: [],
		});
	});
});

describe("invalid notes", () => {
	it("lands in invalid and does not stop the others", () => {
		const bad: PortfolioNote = {
			note_id: "bad",
			role: "lender",
			events: [
				created(terms("10000", "2026-03-01")),
				payment(2, "lender", "12.5", "2026-03-01"),
			],
		};
		const result = portfolio(
			[bad, oneInstallment("good", "2026-03-01")],
			"2026-03-01",
		);
		expect(result.rows.map((row) => row.note_id)).toEqual(["good"]);
		expect(result.invalid).toHaveLength(1);
		expect(result.invalid[0]?.note_id).toBe("bad");
		expect(result.invalid[0]?.error).toContain("events[1]");
	});

	it("reports an empty stream and an as-of date before issue as invalid", () => {
		const empty: PortfolioNote = {
			note_id: "empty",
			role: "borrower",
			events: [],
		};
		const result = portfolio(
			[empty, oneInstallment("early", "2026-03-01")],
			"2026-01-01",
		);
		expect(result.rows).toEqual([]);
		expect(result.invalid.map((entry) => entry.note_id)).toEqual([
			"empty",
			"early",
		]);
		expect(result.invalid[0]?.error).toBe(
			"stream: must contain at least one event",
		);
	});

	it("never mutates the input", () => {
		const notes = [
			oneInstallment("a", "2026-03-01", "lender", [
				payment(2, "borrower", "1000", "2026-03-01"),
			]),
		];
		const before = JSON.stringify(notes);
		portfolio(notes, "2026-04-01");
		expect(JSON.stringify(notes)).toBe(before);
	});
});

const BANNED_KEY =
	/reason|text|agent|annotation|notice|dispute_|event_id|^id$|_id$/;
const ALLOWED_ID_KEYS = new Set(["note_id"]);

/** Every key of every nested object and array, so a banned field cannot hide anywhere. */
const keysOf = (value: unknown, found: string[] = []): string[] => {
	if (Array.isArray(value)) {
		for (const item of value) keysOf(item, found);
	} else if (typeof value === "object" && value !== null) {
		for (const [key, child] of Object.entries(value)) {
			found.push(key);
			keysOf(child, found);
		}
	}
	return found;
};

describe("board report", () => {
	const noisy = (): PortfolioNote[] => [
		oneInstallment("a", "2026-03-01", "lender", [
			{
				...payment(2, "borrower", "1000", "2026-02-10"),
				agent_ref: "agent-secret-1",
			},
			make(3, "payment.disputed", "lender", {
				target: "evt-2",
				counter_amount_minor: "0",
				reason: "dispute reason text",
				agent_ref: "agent-secret-2",
			}),
			make(4, "annotation.added", "lender", {
				text: "annotation free text",
				target: "evt-2",
			}),
			make(5, "notice.sent", "lender", {
				kind: "default",
				cure_days: 30,
				agent_ref: "agent-secret-3",
			}),
		]),
	];

	it("carries no banned key anywhere", () => {
		const report = boardReport(portfolio(noisy(), "2026-04-01"), "2026-04-01");
		const banned = keysOf(report).filter(
			(key) => BANNED_KEY.test(key) && !ALLOWED_ID_KEYS.has(key),
		);
		expect(banned).toEqual([]);
	});

	it("carries none of the free text, agent refs or event ids as a value", () => {
		const report = boardReport(portfolio(noisy(), "2026-04-01"), "2026-04-01");
		const json = JSON.stringify(report);
		for (const secret of [
			"dispute reason",
			"annotation free",
			"agent-secret",
			"evt-",
			"cure_days",
			"default",
		]) {
			expect(json).not.toContain(secret);
		}
		expect(boardReportCsv(report)).not.toContain("secret");
	});

	it("lists exactly the safe row fields and counts notes it could not compute", () => {
		const bad: PortfolioNote = { note_id: "bad", role: "lender", events: [] };
		const report = boardReport(
			portfolio([...noisy(), bad], "2026-04-01"),
			"2026-04-01",
		);
		expect(report.generated_for).toBe("2026-04-01");
		expect(report.not_computed).toBe(1);
		expect(Object.keys(report.rows[0] ?? {})).toEqual([...BOARD_CSV_HEADER]);
		expect(Object.keys(report).sort()).toEqual([
			"generated_for",
			"not_computed",
			"rows",
			"totals",
		]);
		expect(JSON.stringify(report)).not.toContain("empty");
	});
});

describe("board report CSV", () => {
	const row = (overrides: Partial<BoardRow> = {}): BoardRow => ({
		note_id: "loan-1",
		currency: "USD",
		exponent: 2,
		role: "lender",
		payoff_minor: "12345",
		overdue_minor: "0",
		days_overdue: 0,
		aging: "current",
		awaiting_confirmation: 0,
		disputed: 0,
		terms: "accepted",
		declined: false,
		closed: false,
		next_due: null,
		...overrides,
	});
	const report = (...rows: BoardRow[]): BoardReport => ({
		generated_for: "2026-06-30",
		totals: [],
		rows,
		not_computed: 0,
	});
	const HEADER =
		"note_id,currency,exponent,role,payoff_minor,overdue_minor,days_overdue,aging,awaiting_confirmation,disputed,terms,declined,closed,next_due";

	it("writes the fixed header and \\n line ends", () => {
		expect(boardReportCsv(report())).toBe(`${HEADER}\n`);
		expect(
			boardReportCsv(
				report(row(), row({ note_id: "loan-2", next_due: "2026-07-15" })),
			),
		).toBe(
			`${HEADER}\nloan-1,USD,2,lender,12345,0,0,current,0,0,accepted,false,false,\nloan-2,USD,2,lender,12345,0,0,current,0,0,accepted,false,false,2026-07-15\n`,
		);
		expect(boardReportCsv(report(row()))).not.toContain("\r");
	});

	const quoting: [string, string, string][] = [
		["a comma", "a,b", '"a,b"'],
		["a double quote", 'say "hi"', '"say ""hi"""'],
		["a newline", "a\nb", '"a\nb"'],
		["a carriage return", "a\rb", '"a\rb"'],
		["nothing special", "plain id", "plain id"],
	];
	for (const [label, id, cell] of quoting) {
		it(`quotes a cell with ${label} (RFC 4180)`, () => {
			const line = boardReportCsv(report(row({ note_id: id }))).slice(
				HEADER.length + 1,
			);
			expect(line.startsWith(`${cell},USD,`)).toBe(true);
		});
	}

	const injections: [string, string][] = [
		["=", '=HYPERLINK("http://x")'],
		["+", "+1+1"],
		["-", "-2+3"],
		["@", "@SUM(A1)"],
		["tab", "\t=1"],
		["carriage return", "\r=1"],
	];
	for (const [label, id] of injections) {
		it(`prefixes a text cell starting with ${label} with a single quote`, () => {
			const line = boardReportCsv(report(row({ note_id: id }))).slice(
				HEADER.length + 1,
			);
			const prefixed = `'${id}`;
			const cell = /[",\r\n]/.test(prefixed)
				? `"${prefixed.replaceAll('"', '""')}"`
				: prefixed;
			expect(line.startsWith(`${cell},USD,`)).toBe(true);
			expect(line.startsWith(id)).toBe(false);
		});
	}

	it("hardens before quoting, so a formula with a comma is quoted after the prefix", () => {
		const line = boardReportCsv(report(row({ note_id: "=SUM(1,2)" }))).slice(
			HEADER.length + 1,
		);
		expect(line.startsWith(`"'=SUM(1,2)",USD,`)).toBe(true);
	});

	it("leaves a quote that is not first alone", () => {
		const line = boardReportCsv(report(row({ note_id: "a=b" }))).slice(
			HEADER.length + 1,
		);
		expect(line.startsWith("a=b,USD,")).toBe(true);
	});

	it("writes money as plain integers and does not prefix a negative number", () => {
		const line = boardReportCsv(report(row({ payoff_minor: "-500" }))).slice(
			HEADER.length + 1,
		);
		expect(line).toContain(",-500,");
	});

	it("refuses a money cell that is not an integer instead of writing it as text", () => {
		expect(() => boardReportCsv(report(row({ payoff_minor: "=1+1" })))).toThrow(
			'CSV numeric cell is not an integer: "=1+1"',
		);
		expect(() => boardReportCsv(report(row({ overdue_minor: "1.5" })))).toThrow(
			"not an integer",
		);
	});

	it("hardens a currency or date cell too", () => {
		const line = boardReportCsv(
			report(row({ currency: "-X", next_due: "@2026" })),
		).slice(HEADER.length + 1);
		expect(line).toBe(
			"loan-1,'-X,2,lender,12345,0,0,current,0,0,accepted,false,false,'@2026\n",
		);
	});
});
