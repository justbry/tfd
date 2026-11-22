// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "bun:test";
import schema from "../schema/note-event.v1.json";
import {
	MAX_CARVE_OUT_DAYS,
	MAX_GRANT_DAYS,
	parseNoteEvent,
	validateStream,
} from "../src/events";
import type { NoteEvent } from "../src/types";

type Fields = Record<string, unknown>;

const NOTE_ID = "note-1";

const TERMS: Fields = {
	currency: "USD",
	exponent: 2,
	principal_minor: "1000000",
	issue_date: "2026-01-15",
	annual_rate: "0.05",
	day_count: "actual/365",
	rounding: "half-up",
	timezone: "America/Denver",
	schedule: {
		type: "amortized",
		frequency: "monthly",
		count: 36,
		first_due: "2026-02-15",
	},
};

const make = (
	seq: number,
	type: string,
	enteredBy: string,
	fields: Fields,
): Fields => ({
	schema: "tfd.note-event.v1",
	id: `evt-${seq}`,
	note_id: NOTE_ID,
	seq,
	entered_at: "2026-02-01T12:00:00Z",
	entered_by: enteredBy,
	type,
	...fields,
});

const created = (fields: Fields = {}): Fields =>
	make(1, "note.created", "lender", { terms: TERMS, ...fields });
const recorded = (
	seq: number,
	enteredBy: string,
	fields: Fields = {},
): Fields =>
	make(seq, "payment.recorded", enteredBy, {
		kind: "payment",
		amount_minor: "35000",
		value_date: "2026-02-10",
		...fields,
	});
const confirmed = (seq: number, enteredBy: string, target: string): Fields =>
	make(seq, "payment.confirmed", enteredBy, { target });
const disputed = (
	seq: number,
	enteredBy: string,
	target: string,
	fields: Fields = {},
): Fields =>
	make(seq, "payment.disputed", enteredBy, {
		target,
		counter_amount_minor: "30000",
		reason: "I handed over 300",
		...fields,
	});
const resolved = (seq: number, enteredBy: string, target: string): Fields =>
	make(seq, "payment.resolved", enteredBy, {
		target,
		agreed_amount_minor: "32000",
	});
const annotation = (seq: number, fields: Fields = {}): Fields =>
	make(seq, "annotation.added", "lender", { text: "Paid in cash", ...fields });

const without = (record: Fields, key: string): Fields => {
	const copy = { ...record };
	delete copy[key];
	return copy;
};

const withTerms = (changes: Fields): Fields =>
	created({ terms: { ...TERMS, ...changes } });

const withSchedule = (schedule: Fields): Fields => withTerms({ schedule });

const custom = (dates: string[]): Fields =>
	withSchedule({
		type: "custom",
		installments: dates.map((due) => ({ due, amount_minor: "1000" })),
	});

const SHA = "a".repeat(64);
// Read by key name: a literal `then` property trips the noThenProperty lint rule.
const THEN_KEY = "then";

describe("parseNoteEvent accepts", () => {
	const valid: [string, Fields][] = [
		["note.created", created()],
		[
			"note.created with a custom schedule and a document hash",
			withTerms({
				document_sha256: SHA,
				schedule: {
					type: "custom",
					installments: [
						{ due: "2026-06-15", amount_minor: "0" },
						{ due: "2027-01-15", amount_minor: "1000000" },
					],
				},
			}),
		],
		["note.created with no schedule", withSchedule({ type: "none" })],
		["rate 0", withTerms({ annual_rate: "0" })],
		["rate with 6 places", withTerms({ annual_rate: "0.052500" })],
		["exponent 0", withTerms({ exponent: 0 })],
		["exponent 4", withTerms({ exponent: 4 })],
		["issue date on a leap day", withTerms({ issue_date: "2024-02-29" })],
		[
			"issue date on a 400-year leap day",
			withTerms({ issue_date: "2000-02-29" }),
		],
		["payment.recorded", recorded(2, "borrower")],
		[
			"payment.recorded with every optional field",
			recorded(2, "lender", {
				method: "transfer",
				reference: "TX-9",
				source: "lender-states",
			}),
		],
		["zero amount", recorded(2, "borrower", { amount_minor: "0" })],
		[
			"reversal with reverses",
			recorded(3, "lender", { kind: "reversal", reverses: "evt-2" }),
		],
		["payment.confirmed", confirmed(3, "lender", "evt-2")],
		["payment.disputed", disputed(3, "lender", "evt-2")],
		[
			"zero counter amount",
			disputed(3, "lender", "evt-2", { counter_amount_minor: "0" }),
		],
		["payment.resolved", resolved(4, "lender", "evt-2")],
		["annotation.added", annotation(5)],
		[
			"annotation.added with attachment and target",
			annotation(5, { attachment_sha256: SHA, target: "evt-2" }),
		],
	];
	for (const [name, event] of valid) {
		it(name, () => {
			const parsed = parseNoteEvent(event);
			expect(parsed.type).toBe(event.type as NoteEvent["type"]);
			expect(parsed).toEqual(event as unknown as NoteEvent);
		});
	}

	it("entered_at with fractional seconds", () => {
		const parsed = parseNoteEvent({
			...confirmed(3, "lender", "evt-2"),
			entered_at: "2026-02-01T12:00:00.123Z",
		});
		expect(parsed.entered_at).toBe("2026-02-01T12:00:00.123Z");
	});
});

describe("parseNoteEvent rejects", () => {
	const invalid: [string, unknown, string][] = [
		[
			"a principal of more than 20 digits",
			{ ...created(), terms: { ...TERMS, principal_minor: "1".repeat(21) } },
			"at most 20 digits",
		],
		["null", null, "event: must be an object"],
		["an array", [], "event: must be an object"],
		["a string", "note.created", "event: must be an object"],
		[
			"a missing type",
			without(created(), "type"),
			"event: type must be one of",
		],
		[
			"an unknown type",
			make(2, "loan.forgiven", "lender", {}),
			"event: type must be one of",
		],
		[
			"a wrong schema",
			{ ...created(), schema: "tfd.note-event.v2" },
			"note.created: schema must be",
		],
		["a missing id", without(created(), "id"), "note.created: id is required"],
		[
			"an empty id",
			{ ...created(), id: "" },
			"note.created: id must be a non-empty string",
		],
		[
			"an empty note_id",
			{ ...created(), note_id: "" },
			"note.created: note_id must be a non-empty string",
		],
		[
			"seq 0",
			{ ...created(), seq: 0 },
			"note.created: seq must be an integer of at least 1",
		],
		[
			"a fractional seq",
			{ ...created(), seq: 1.5 },
			"note.created: seq must be an integer",
		],
		[
			"a string seq",
			{ ...created(), seq: "1" },
			"note.created: seq must be an integer",
		],
		[
			"an entered_at without Z",
			{ ...created(), entered_at: "2026-02-01T12:00:00+00:00" },
			"entered_at must be an ISO 8601 UTC instant",
		],
		[
			"an entered_at with no time",
			{ ...created(), entered_at: "2026-02-01" },
			"entered_at must be an ISO 8601 UTC instant",
		],
		[
			"an entered_at on a missing day",
			{ ...created(), entered_at: "2026-02-30T12:00:00Z" },
			"entered_at must be an ISO 8601 UTC instant",
		],
		[
			"an entered_at at hour 24",
			{ ...created(), entered_at: "2026-02-01T24:00:00Z" },
			"entered_at must be an ISO 8601 UTC instant",
		],
		[
			"an unknown role",
			{ ...created(), entered_by: "admin" },
			"entered_by must be",
		],
		[
			"an unknown key on note.created",
			{ ...created(), extra: 1 },
			"note.created: extra is not allowed",
		],
		[
			"an unknown key on payment.recorded",
			recorded(2, "borrower", { memo: "x" }),
			"payment.recorded: memo is not allowed",
		],
		[
			"an unknown key on payment.confirmed",
			{ ...confirmed(3, "lender", "evt-2"), reason: "x" },
			"payment.confirmed: reason is not allowed",
		],
		[
			"an unknown key on annotation.added",
			annotation(5, { author: "x" }),
			"annotation.added: author is not allowed",
		],
		[
			"a missing terms",
			without(created(), "terms"),
			"note.created: terms is required",
		],
		[
			"terms that are not an object",
			created({ terms: "none" }),
			"note.created: terms must be an object",
		],
		[
			"an unknown terms key",
			withTerms({ fee_minor: "100" }),
			"note.created: terms.fee_minor is not allowed",
		],
		[
			"a missing terms key",
			created({ terms: without(TERMS, "timezone") }),
			"note.created: terms.timezone is required",
		],
		[
			"a lowercase currency",
			withTerms({ currency: "usd" }),
			"terms.currency must be three capital letters",
		],
		[
			"a short currency",
			withTerms({ currency: "US" }),
			"terms.currency must be three capital letters",
		],
		[
			"a long currency",
			withTerms({ currency: "USDD" }),
			"terms.currency must be three capital letters",
		],
		[
			"exponent 5",
			withTerms({ exponent: 5 }),
			"terms.exponent must be an integer from 0 to 4",
		],
		[
			"a negative exponent",
			withTerms({ exponent: -1 }),
			"terms.exponent must be an integer from 0 to 4",
		],
		[
			"a fractional exponent",
			withTerms({ exponent: 1.5 }),
			"terms.exponent must be an integer from 0 to 4",
		],
		[
			"a string exponent",
			withTerms({ exponent: "2" }),
			"terms.exponent must be an integer from 0 to 4",
		],
		[
			"a rate of 1",
			withTerms({ annual_rate: "1" }),
			"terms.annual_rate must be a decimal string",
		],
		[
			"a rate with 7 places",
			withTerms({ annual_rate: "0.1234567" }),
			"terms.annual_rate must be a decimal string",
		],
		[
			"a rate with no leading zero",
			withTerms({ annual_rate: ".05" }),
			"terms.annual_rate must be a decimal string",
		],
		[
			"a rate with a trailing point",
			withTerms({ annual_rate: "0." }),
			"terms.annual_rate must be a decimal string",
		],
		[
			"a negative rate",
			withTerms({ annual_rate: "-0.05" }),
			"terms.annual_rate must be a decimal string",
		],
		[
			"a numeric rate",
			withTerms({ annual_rate: 0.05 }),
			"terms.annual_rate must be a decimal string",
		],
		[
			"a wrong day count",
			withTerms({ day_count: "30/360" }),
			"terms.day_count must be",
		],
		[
			"a wrong rounding",
			withTerms({ rounding: "half-even" }),
			"terms.rounding must be",
		],
		[
			"an empty timezone",
			withTerms({ timezone: "" }),
			"terms.timezone must be a non-empty string",
		],
		[
			"a bad document hash",
			withTerms({ document_sha256: "ABC" }),
			"terms.document_sha256 must be 64 lowercase hex",
		],
		[
			"a negative principal",
			withTerms({ principal_minor: "-1" }),
			"terms.principal_minor must be a non-negative integer",
		],
		[
			"a decimal principal",
			withTerms({ principal_minor: "10000.00" }),
			"terms.principal_minor must be a non-negative integer",
		],
		[
			"a numeric principal",
			withTerms({ principal_minor: 1000000 }),
			"terms.principal_minor must be a non-negative integer",
		],
		[
			"a missing day in the issue date",
			withTerms({ issue_date: "2026-02-30" }),
			"terms.issue_date must be a calendar date",
		],
		[
			"Feb 29 in a common year",
			withTerms({ issue_date: "2025-02-29" }),
			"terms.issue_date must be a calendar date",
		],
		[
			"Feb 29 in a century year",
			withTerms({ issue_date: "1900-02-29" }),
			"terms.issue_date must be a calendar date",
		],
		[
			"month 13",
			withTerms({ issue_date: "2026-13-01" }),
			"terms.issue_date must be a calendar date",
		],
		[
			"month 0",
			withTerms({ issue_date: "2026-00-10" }),
			"terms.issue_date must be a calendar date",
		],
		[
			"day 0",
			withTerms({ issue_date: "2026-01-00" }),
			"terms.issue_date must be a calendar date",
		],
		[
			"an unpadded date",
			withTerms({ issue_date: "2026-1-5" }),
			"terms.issue_date must be a calendar date",
		],
		[
			"31 days in April",
			withTerms({ issue_date: "2026-04-31" }),
			"terms.issue_date must be a calendar date",
		],
		[
			"a schedule that is not an object",
			withTerms({ schedule: "monthly" }),
			"terms.schedule must be an object",
		],
		[
			"an unknown schedule type",
			withSchedule({ type: "balloon" }),
			"terms.schedule.type must be",
		],
		[
			"an unknown schedule key",
			withSchedule({ type: "none", count: 3 }),
			"terms.schedule.count is not allowed",
		],
		[
			"an unknown frequency",
			withSchedule({
				type: "amortized",
				frequency: "daily",
				count: 3,
				first_due: "2026-02-15",
			}),
			"terms.schedule.frequency must be",
		],
		[
			"a zero installment count",
			withSchedule({
				type: "amortized",
				frequency: "monthly",
				count: 0,
				first_due: "2026-02-15",
			}),
			"terms.schedule.count must be an integer of at least 1",
		],
		[
			"a fractional installment count",
			withSchedule({
				type: "amortized",
				frequency: "monthly",
				count: 2.5,
				first_due: "2026-02-15",
			}),
			"terms.schedule.count must be an integer",
		],
		[
			"a bad first_due",
			withSchedule({
				type: "amortized",
				frequency: "monthly",
				count: 3,
				first_due: "2026-02-30",
			}),
			"terms.schedule.first_due must be a calendar date",
		],
		[
			"a missing amortized key",
			withSchedule({ type: "amortized", frequency: "monthly", count: 3 }),
			"terms.schedule.first_due is required",
		],
		[
			"an empty custom list",
			withSchedule({ type: "custom", installments: [] }),
			"terms.schedule.installments must be a non-empty array",
		],
		[
			"a custom list that is not an array",
			withSchedule({ type: "custom", installments: "x" }),
			"terms.schedule.installments must be a non-empty array",
		],
		[
			"an equal custom due date",
			custom(["2026-03-01", "2026-03-01"]),
			"terms.schedule.installments[1].due 2026-03-01 must be after installments[0].due 2026-03-01",
		],
		[
			"a decreasing custom due date",
			custom(["2026-03-01", "2026-02-01"]),
			"terms.schedule.installments[1].due 2026-02-01 must be after",
		],
		[
			"a custom due on the issue date",
			custom(["2026-01-15"]),
			"terms.schedule.installments[0].due 2026-01-15 must be after issue_date 2026-01-15",
		],
		[
			"a custom due before the issue date",
			custom(["2026-01-01", "2026-03-01"]),
			"terms.schedule.installments[0].due 2026-01-01 must be after issue_date",
		],
		[
			"a custom installment that is not an object",
			withSchedule({ type: "custom", installments: ["x"] }),
			"terms.schedule.installments[0] must be an object",
		],
		[
			"a custom installment with an extra key",
			withSchedule({
				type: "custom",
				installments: [{ due: "2026-03-01", amount_minor: "1", note: "x" }],
			}),
			"terms.schedule.installments[0].note is not allowed",
		],
		[
			"a negative custom amount",
			withSchedule({
				type: "custom",
				installments: [{ due: "2026-03-01", amount_minor: "-1" }],
			}),
			"terms.schedule.installments[0].amount_minor must be a non-negative integer",
		],
		[
			"a payment with an unknown kind",
			recorded(2, "borrower", { kind: "refund" }),
			"payment.recorded: kind must be",
		],
		[
			"a negative payment amount",
			recorded(2, "borrower", { amount_minor: "-100" }),
			"payment.recorded: amount_minor must be a non-negative integer",
		],
		[
			"a payment amount with a leading zero",
			recorded(2, "borrower", { amount_minor: "0100" }),
			"payment.recorded: amount_minor must be a non-negative integer",
		],
		[
			"a payment amount with a decimal",
			recorded(2, "borrower", { amount_minor: "350.00" }),
			"payment.recorded: amount_minor must be a non-negative integer",
		],
		[
			"a payment amount in exponent form",
			recorded(2, "borrower", { amount_minor: "1e3" }),
			"payment.recorded: amount_minor must be a non-negative integer",
		],
		[
			"an empty payment amount",
			recorded(2, "borrower", { amount_minor: "" }),
			"payment.recorded: amount_minor must be a non-negative integer",
		],
		[
			"a numeric payment amount",
			recorded(2, "borrower", { amount_minor: 35000 }),
			"payment.recorded: amount_minor must be a non-negative integer",
		],
		[
			"a missing amount",
			without(recorded(2, "borrower"), "amount_minor"),
			"payment.recorded: amount_minor is required",
		],
		[
			"a bad value_date",
			recorded(2, "borrower", { value_date: "2026-02-30" }),
			"payment.recorded: value_date must be a calendar date",
		],
		[
			"a missing value_date",
			without(recorded(2, "borrower"), "value_date"),
			"payment.recorded: value_date is required",
		],
		[
			"a reversal without reverses",
			recorded(3, "lender", { kind: "reversal" }),
			"payment.recorded: reverses is required when kind is reversal",
		],
		[
			"a payment with reverses",
			recorded(3, "lender", { reverses: "evt-2" }),
			"payment.recorded: reverses is only allowed when kind is reversal",
		],
		[
			"an empty reverses",
			recorded(3, "lender", { kind: "reversal", reverses: "" }),
			"payment.recorded: reverses must be a non-empty string",
		],
		[
			"a typed both-agree source",
			recorded(2, "borrower", { source: "both-agree" }),
			'payment.recorded: source "both-agree" is derived',
		],
		[
			"an unknown source",
			recorded(2, "borrower", { source: "witness" }),
			"payment.recorded: source must be",
		],
		[
			"a numeric method",
			recorded(2, "borrower", { method: 5 }),
			"payment.recorded: method must be a string",
		],
		[
			"a numeric reference",
			recorded(2, "borrower", { reference: 5 }),
			"payment.recorded: reference must be a string",
		],
		[
			"a confirmation without a target",
			without(confirmed(3, "lender", "evt-2"), "target"),
			"payment.confirmed: target is required",
		],
		[
			"a dispute without a reason",
			without(disputed(3, "lender", "evt-2"), "reason"),
			"payment.disputed: reason is required",
		],
		[
			"a dispute with an empty reason",
			disputed(3, "lender", "evt-2", { reason: "" }),
			"payment.disputed: reason must be a non-empty string",
		],
		[
			"a dispute without a counter amount",
			without(disputed(3, "lender", "evt-2"), "counter_amount_minor"),
			"payment.disputed: counter_amount_minor is required",
		],
		[
			"a dispute with neither",
			without(
				without(disputed(3, "lender", "evt-2"), "reason"),
				"counter_amount_minor",
			),
			"payment.disputed: counter_amount_minor is required",
		],
		[
			"a dispute with a negative counter amount",
			disputed(3, "lender", "evt-2", { counter_amount_minor: "-1" }),
			"payment.disputed: counter_amount_minor must be a non-negative integer",
		],
		[
			"a dispute without a target",
			without(disputed(3, "lender", "evt-2"), "target"),
			"payment.disputed: target is required",
		],
		[
			"a resolution without an agreed amount",
			without(resolved(4, "lender", "evt-2"), "agreed_amount_minor"),
			"payment.resolved: agreed_amount_minor is required",
		],
		[
			"a resolution with a bad agreed amount",
			{ ...resolved(4, "lender", "evt-2"), agreed_amount_minor: "1.5" },
			"payment.resolved: agreed_amount_minor must be a non-negative integer",
		],
		[
			"an empty annotation text",
			annotation(5, { text: "" }),
			"annotation.added: text must be a non-empty string",
		],
		[
			"a missing annotation text",
			without(annotation(5), "text"),
			"annotation.added: text is required",
		],
		[
			"a bad attachment hash",
			annotation(5, { attachment_sha256: "abc" }),
			"annotation.added: attachment_sha256 must be 64 lowercase hex",
		],
		[
			"an empty annotation target",
			annotation(5, { target: "" }),
			"annotation.added: target must be a non-empty string",
		],
	];
	for (const [name, event, message] of invalid) {
		it(name, () => {
			expect(() => parseNoteEvent(event)).toThrow(message);
		});
	}
});

describe("parseNoteEvent holes closed", () => {
	const amortized = (fields: Fields): Fields =>
		withSchedule({
			type: "amortized",
			frequency: "monthly",
			count: 3,
			first_due: "2026-02-15",
			...fields,
		});
	const rejected: [string, Fields, string][] = [
		[
			"a principal of 0",
			withTerms({ principal_minor: "0" }),
			'terms.principal_minor must be at least 1 minor unit, got "0"',
		],
		[
			"first_due on the issue date",
			amortized({ first_due: "2026-01-15" }),
			"terms.schedule.first_due 2026-01-15 must be after issue_date 2026-01-15",
		],
		[
			"first_due before the issue date",
			amortized({ first_due: "2026-01-14" }),
			"terms.schedule.first_due 2026-01-14 must be after issue_date",
		],
		[
			"more than 5200 installments",
			amortized({ count: 5201 }),
			"terms.schedule.count must be an integer from 1 to 5200, got 5201",
		],
		[
			"a count above 2^53 - 1",
			amortized({ count: 2 ** 53 }),
			"terms.schedule.count must be an integer of at least 1",
		],
		[
			"a negative count",
			amortized({ count: -1 }),
			"terms.schedule.count must be an integer of at least 1",
		],
		[
			"a last due date beyond year 9999",
			amortized({ count: 5200, first_due: "9900-01-01", frequency: "monthly" }),
			"terms.schedule.count 5200 puts the last due date beyond year 9999",
		],
		[
			"a weekly last due date beyond year 9999",
			amortized({ count: 5200, first_due: "9999-12-01", frequency: "weekly" }),
			"terms.schedule.count 5200 puts the last due date beyond year 9999",
		],
		[
			"a fractional seq",
			{ ...recorded(2, "borrower"), seq: 1.5 },
			"payment.recorded: seq must be an integer of at least 1",
		],
		[
			"a seq above 2^53 - 1",
			{ ...recorded(2, "borrower"), seq: 2 ** 53 },
			"payment.recorded: seq must be an integer of at least 1",
		],
		[
			"a seq of 0",
			{ ...recorded(2, "borrower"), seq: 0 },
			"payment.recorded: seq must be an integer of at least 1",
		],
	];
	for (const [name, event, message] of rejected) {
		it(`rejects ${name}`, () => {
			expect(() => parseNoteEvent(event)).toThrow(message);
		});
	}

	it("accepts 5200 installments and a principal of 1", () => {
		expect(
			parseNoteEvent(amortized({ count: 5200, frequency: "monthly" })),
		).toBeDefined();
		expect(parseNoteEvent(withTerms({ principal_minor: "1" }))).toBeDefined();
	});

	it("accepts 5200 installments at every frequency", () => {
		for (const frequency of ["weekly", "biweekly", "monthly"]) {
			const events = [
				withSchedule({
					type: "amortized",
					frequency,
					count: 5200,
					first_due: "2026-02-15",
				}),
			];
			expect(validateStream(events).length).toBe(1);
		}
	});
});

describe("validateStream accepts", () => {
	const fullStream = (): Fields[] => [
		created(),
		recorded(2, "borrower"),
		confirmed(3, "lender", "evt-2"),
		recorded(4, "lender", { source: "lender-states" }),
		disputed(5, "borrower", "evt-4"),
		resolved(6, "lender", "evt-4"),
		annotation(7, { target: "evt-2", attachment_sha256: SHA }),
		recorded(8, "lender", { kind: "reversal", reverses: "evt-2" }),
		confirmed(9, "borrower", "evt-8"),
		recorded(10, "borrower", { value_date: "2026-01-15" }),
	];

	it("a full stream, in seq order", () => {
		const events = validateStream(fullStream());
		expect(events.map((event) => event.seq)).toEqual([
			1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
		]);
		expect(events.map((event) => event.type)).toEqual([
			"note.created",
			"payment.recorded",
			"payment.confirmed",
			"payment.recorded",
			"payment.disputed",
			"payment.resolved",
			"annotation.added",
			"payment.recorded",
			"payment.confirmed",
			"payment.recorded",
		]);
	});

	it("the same events in any input order, returned sorted by seq (AC-3)", () => {
		const forward = validateStream(fullStream());
		const backward = validateStream(fullStream().reverse());
		expect(backward).toEqual(forward);
	});

	it("a stream of only note.created", () => {
		expect(validateStream([created()]).length).toBe(1);
	});

	it("a value_date on the issue date", () => {
		const events = validateStream([
			created(),
			recorded(2, "borrower", { value_date: "2026-01-15" }),
		]);
		expect(events.length).toBe(2);
	});

	it("a resolution by either party after a dispute", () => {
		const events = validateStream([
			created(),
			recorded(2, "borrower"),
			disputed(3, "lender", "evt-2"),
			resolved(4, "borrower", "evt-2"),
		]);
		expect(events.length).toBe(4);
	});
});

describe("validateStream rejects", () => {
	const base = (): Fields[] => [created(), recorded(2, "borrower")];
	const invalidStreams: [string, () => unknown[], string][] = [
		["an empty stream", () => [], "stream: must contain at least one event"],
		[
			"a stream that starts with a payment",
			() => [recorded(1, "borrower")],
			"stream: the first event (seq 1) must be note.created",
		],
		[
			"a stream whose seq 1 is not note.created",
			() => [{ ...created(), seq: 2 }, recorded(1, "borrower")],
			"stream: the first event (seq 1) must be note.created",
		],
		[
			"a second note.created",
			() => [...base(), { ...created(), id: "evt-3", seq: 3 }],
			"note.created: seq 3: note.created is only allowed as the first event",
		],
		[
			"a different note_id",
			() => [
				...base(),
				{ ...confirmed(3, "lender", "evt-2"), note_id: "note-2" },
			],
			'payment.confirmed: seq 3: note_id "note-2" differs from "note-1"',
		],
		[
			"a seq gap",
			() => [...base(), confirmed(4, "lender", "evt-2")],
			"stream: seq has a gap: expected 3, found 4",
		],
		[
			"a seq that does not start at 1",
			() => [{ ...created(), seq: 2 }, { ...recorded(3, "borrower") }],
			"stream: seq has a gap: expected 1, found 2",
		],
		[
			"a repeated seq",
			() => [
				...base(),
				confirmed(3, "lender", "evt-2"),
				{ ...annotation(3), id: "evt-x" },
			],
			"stream: seq 3 is repeated",
		],
		[
			"a repeated event id",
			() => [...base(), { ...confirmed(3, "lender", "evt-2"), id: "evt-2" }],
			'payment.confirmed: seq 3: id "evt-2" is already used by seq 2',
		],
		[
			"a confirmation of an unknown event",
			() => [...base(), confirmed(3, "lender", "evt-99")],
			'payment.confirmed: seq 3: target "evt-99" does not match an earlier payment.recorded event',
		],
		[
			"a confirmation of a later event",
			() => [
				created(),
				confirmed(2, "lender", "evt-3"),
				recorded(3, "borrower"),
			],
			'payment.confirmed: seq 2: target "evt-3" does not match an earlier payment.recorded event',
		],
		[
			"a confirmation of a note.created event",
			() => [...base(), confirmed(3, "borrower", "evt-1")],
			'payment.confirmed: seq 3: target "evt-1" has type note.created, not payment.recorded',
		],
		[
			"a dispute of an unknown event",
			() => [...base(), disputed(3, "lender", "evt-99")],
			'payment.disputed: seq 3: target "evt-99" does not match an earlier payment.recorded event',
		],
		[
			"a dispute of an annotation",
			() => [...base(), annotation(3), disputed(4, "lender", "evt-3")],
			'payment.disputed: seq 4: target "evt-3" has type annotation.added, not payment.recorded',
		],
		[
			"a resolution of an unknown event",
			() => [...base(), resolved(3, "lender", "evt-99")],
			'payment.resolved: seq 3: target "evt-99" does not match an earlier payment.recorded event',
		],
		[
			"a resolution without a dispute",
			() => [...base(), resolved(3, "lender", "evt-2")],
			'payment.resolved: seq 3: target "evt-2" has no earlier payment.disputed event',
		],
		[
			"a resolution before its dispute",
			() => [
				...base(),
				resolved(3, "lender", "evt-2"),
				disputed(4, "lender", "evt-2"),
			],
			'payment.resolved: seq 3: target "evt-2" has no earlier payment.disputed event',
		],
		[
			"a reversal of an unknown event",
			() => [
				...base(),
				recorded(3, "lender", { kind: "reversal", reverses: "evt-99" }),
			],
			'payment.recorded: seq 3: reverses "evt-99" does not match an earlier payment.recorded event',
		],
		[
			"a reversal of a note.created event",
			() => [
				...base(),
				recorded(3, "lender", { kind: "reversal", reverses: "evt-1" }),
			],
			'payment.recorded: seq 3: reverses "evt-1" has type note.created, not payment.recorded',
		],
		[
			"a reversal of a reversal",
			() => [
				...base(),
				recorded(3, "lender", { kind: "reversal", reverses: "evt-2" }),
				recorded(4, "lender", { kind: "reversal", reverses: "evt-3" }),
			],
			'payment.recorded: seq 4: reverses "evt-3" must be a payment, not a reversal',
		],
		[
			"a reversal for a different amount than its payment",
			() => [
				...base(),
				recorded(3, "lender", {
					kind: "reversal",
					reverses: "evt-2",
					amount_minor: "10000",
				}),
			],
			'payment.recorded: seq 3: a reversal undoes one whole payment: amount_minor 10000 differs from the 35000 of "evt-2"',
		],
		[
			"a reversal dated before its payment",
			() => [
				...base(),
				recorded(3, "lender", {
					kind: "reversal",
					reverses: "evt-2",
					value_date: "2026-02-09",
				}),
			],
			'payment.recorded: seq 3: value_date 2026-02-09 is before the 2026-02-10 of the payment "evt-2" it reverses',
		],
		[
			"a second reversal of the same payment by the same party",
			() => [
				...base(),
				recorded(3, "lender", { kind: "reversal", reverses: "evt-2" }),
				recorded(4, "lender", { kind: "reversal", reverses: "evt-2" }),
			],
			'payment.recorded: seq 4: payment "evt-2" is already reversed by "evt-3" (seq 3); "evt-4" cannot reverse it again',
		],
		[
			"a second reversal of the same payment by the other party",
			() => [
				...base(),
				recorded(3, "lender", { kind: "reversal", reverses: "evt-2" }),
				recorded(4, "borrower", { kind: "reversal", reverses: "evt-2" }),
			],
			'payment.recorded: seq 4: payment "evt-2" is already reversed by "evt-3" (seq 3); "evt-4" cannot reverse it again',
		],
		[
			"a payment dated before the issue date",
			() => [created(), recorded(2, "borrower", { value_date: "2026-01-14" })],
			"payment.recorded: seq 2: value_date 2026-01-14 is before issue_date 2026-01-15",
		],
		[
			"a reversal dated before the issue date",
			() => [
				...base(),
				recorded(3, "lender", {
					kind: "reversal",
					reverses: "evt-2",
					value_date: "2025-12-31",
				}),
			],
			"payment.recorded: seq 3: value_date 2025-12-31 is before issue_date",
		],
		[
			"a borrower confirming their own payment",
			() => [...base(), confirmed(3, "borrower", "evt-2")],
			'payment.confirmed: seq 3: borrower cannot confirm a payment the borrower recorded ("evt-2")',
		],
		[
			"a lender confirming their own payment",
			() => [created(), recorded(2, "lender"), confirmed(3, "lender", "evt-2")],
			'payment.confirmed: seq 3: lender cannot confirm a payment the lender recorded ("evt-2")',
		],
		[
			"a lender disputing their own payment",
			() => [created(), recorded(2, "lender"), disputed(3, "lender", "evt-2")],
			'payment.disputed: seq 3: lender cannot dispute a payment the lender recorded ("evt-2")',
		],
		[
			"a borrower disputing their own payment",
			() => [...base(), disputed(3, "borrower", "evt-2")],
			'payment.disputed: seq 3: borrower cannot dispute a payment the borrower recorded ("evt-2")',
		],
		[
			"an annotation about an unknown event",
			() => [...base(), annotation(3, { target: "evt-99" })],
			'annotation.added: seq 3: target "evt-99" does not match an earlier event',
		],
		[
			"a dispute without a reason inside a stream",
			() => [...base(), without(disputed(3, "lender", "evt-2"), "reason")],
			"events[2]: payment.disputed: reason is required",
		],
		[
			"a bad event named by its index",
			() => [created(), { ...recorded(2, "borrower"), amount_minor: "-5" }],
			"events[1]: payment.recorded: amount_minor must be a non-negative integer",
		],
	];
	for (const [name, build, message] of invalidStreams) {
		it(name, () => {
			expect(() => validateStream(build())).toThrow(message);
		});
	}
});

describe("the event vocabulary for terms, payoff, release, notice, rebind, visibility and approval", () => {
	const HASH = "c".repeat(64);
	const termsAccepted = (seq = 2, enteredBy = "borrower"): Fields =>
		make(seq, "terms.accepted", enteredBy, {});
	const termsDeclined = (seq = 2, enteredBy = "borrower"): Fields =>
		make(seq, "terms.declined", enteredBy, {});
	const payoff = (seq = 2, fields: Fields = {}): Fields =>
		make(seq, "payoff.issued", "lender", {
			as_of: "2026-03-01",
			document_sha256: HASH,
			...fields,
		});
	const drafted = (seq = 2, enteredBy = "lender"): Fields =>
		make(seq, "release.drafted", enteredBy, {});
	const releaseConfirmed = (
		seq = 3,
		target = "evt-2",
		enteredBy = "lender",
	): Fields => make(seq, "release.confirmed", enteredBy, { target });
	const notice = (seq = 2, fields: Fields = {}): Fields =>
		make(seq, "notice.sent", "lender", { kind: "reminder", ...fields });
	const rebound = (
		seq = 2,
		role = "borrower",
		enteredBy = "lender",
		fields: Fields = {},
	): Fields =>
		make(seq, "party.rebound", enteredBy, {
			role,
			contact_commitment: HASH,
			...fields,
		});
	const proposal = (seq = 2, fields: Fields = {}): Fields =>
		make(seq, "visibility.changed", "borrower", {
			change: "grant.proposed",
			grant_id: "grant-1",
			audience: { kind: "person", ref: "person-ref-1" },
			level: "summary",
			expires_at: "2026-03-01T12:00:00Z",
			...fields,
		});
	const grantAnswer = (
		seq: number,
		change: string,
		enteredBy = "lender",
		grantId = "grant-1",
	): Fields =>
		make(seq, "visibility.changed", enteredBy, { change, grant_id: grantId });
	const approvalRequested = (seq = 3, fields: Fields = {}): Fields =>
		make(seq, "approval.requested", "lender", {
			action: "release.confirm",
			target: "evt-2",
			...fields,
		});
	const approvalGranted = (
		seq = 4,
		request = "evt-3",
		enteredBy = "borrower",
	): Fields => make(seq, "approval.granted", enteredBy, { request });

	describe("parseNoteEvent accepts", () => {
		const valid: [string, Fields][] = [
			["terms.accepted", termsAccepted()],
			["terms.declined", termsDeclined()],
			["payoff.issued", payoff()],
			["release.drafted", drafted()],
			["release.confirmed", releaseConfirmed()],
			["notice.sent reminder", notice()],
			[
				"notice.sent default with 30 cure days",
				notice(2, { kind: "default", cure_days: 30 }),
			],
			[
				"notice.sent default with 0 cure days",
				notice(2, { kind: "default", cure_days: 0 }),
			],
			[
				"notice.sent default with 365 cure days",
				notice(2, { kind: "default", cure_days: 365 }),
			],
			["party.rebound of the borrower, confirmed by the lender", rebound()],
			[
				"party.rebound of the lender, confirmed by the borrower",
				rebound(2, "lender", "borrower"),
			],
			["visibility.changed proposing to a person", proposal()],
			[
				"visibility.changed proposing to an org at statement level",
				proposal(2, {
					audience: { kind: "org", ref: "org-1" },
					level: "statement",
				}),
			],
			[
				"visibility.changed proposing a verify link with an expiry",
				proposal(2, {
					audience: { kind: "link", ref: "link-1" },
					level: "verify",
					expires_at: "2027-01-01T00:00:00Z",
				}),
			],
			[
				"visibility.changed proposing with an email-shaped ref (the engine does not judge refs)",
				proposal(2, {
					audience: { kind: "person", ref: "someone@example.com" },
				}),
			],
			[
				"visibility.changed consented by the lender",
				grantAnswer(3, "grant.consented"),
			],
			[
				"visibility.changed revoked by the borrower",
				grantAnswer(3, "grant.revoked", "borrower"),
			],
			["approval.requested for release.confirm", approvalRequested()],
			[
				"approval.requested for notice.default",
				approvalRequested(3, { action: "notice.default", cure_days: 30 }),
			],
			[
				"approval.requested for waiver",
				approvalRequested(3, { action: "waiver" }),
			],
			["approval.granted by the borrower", approvalGranted()],
			["approval.granted by the lender", approvalGranted(4, "evt-3", "lender")],
			[
				"a payment with via email-link",
				recorded(2, "borrower", { via: "email-link" }),
			],
			[
				"a payment with via account and an agent_ref",
				recorded(2, "lender", { via: "account", agent_ref: "agent-7" }),
			],
			[
				"note.created with via and agent_ref",
				created({ via: "account", agent_ref: "a" }),
			],
			["terms.accepted with via", { ...termsAccepted(), via: "email-link" }],
			[
				"an agent_ref of 128 characters",
				recorded(2, "lender", { agent_ref: "a".repeat(128) }),
			],
			[
				"an agent_ref of 128 code points beyond the BMP",
				recorded(2, "lender", { agent_ref: "\u{1F600}".repeat(128) }),
			],
		];
		for (const [name, event] of valid) {
			it(name, () => {
				const parsed = parseNoteEvent(event);
				expect(parsed.type).toBe(event.type as NoteEvent["type"]);
				expect(parsed).toEqual(event as unknown as NoteEvent);
			});
		}
	});

	describe("parseNoteEvent rejects", () => {
		const invalid: [string, unknown, string][] = [
			[
				"terms.accepted by the lender",
				termsAccepted(2, "lender"),
				'terms.accepted: entered_by must be "borrower", got "lender"',
			],
			[
				"terms.declined by the lender",
				termsDeclined(2, "lender"),
				'terms.declined: entered_by must be "borrower", got "lender"',
			],
			[
				"terms.accepted with an extra field",
				{ ...termsAccepted(), reason: "ok" },
				"terms.accepted: reason is not allowed",
			],
			[
				"terms.declined with an extra field",
				{ ...termsDeclined(), reason: "no" },
				"terms.declined: reason is not allowed",
			],
			[
				"payoff.issued by the borrower",
				{ ...payoff(), entered_by: "borrower" },
				'payoff.issued: entered_by must be "lender", got "borrower"',
			],
			[
				"payoff.issued without as_of",
				without(payoff(), "as_of"),
				"payoff.issued: as_of is required",
			],
			[
				"payoff.issued without a hash",
				without(payoff(), "document_sha256"),
				"payoff.issued: document_sha256 is required",
			],
			[
				"payoff.issued with an impossible date",
				payoff(2, { as_of: "2026-02-30" }),
				"payoff.issued: as_of must be a calendar date",
			],
			[
				"payoff.issued with an uppercase hash",
				payoff(2, { document_sha256: "A".repeat(64) }),
				"payoff.issued: document_sha256 must be 64 lowercase hex",
			],
			[
				"payoff.issued with a payoff amount",
				payoff(2, { payoff_minor: "100" }),
				"payoff.issued: payoff_minor is not allowed",
			],
			[
				"payoff.issued with any money field",
				payoff(2, { amount_minor: "100" }),
				"payoff.issued: amount_minor is not allowed",
			],
			[
				"release.drafted by the borrower",
				drafted(2, "borrower"),
				'release.drafted: entered_by must be "lender", got "borrower"',
			],
			[
				"release.drafted with a target",
				{ ...drafted(), target: "evt-1" },
				"release.drafted: target is not allowed",
			],
			[
				"release.confirmed by the borrower",
				releaseConfirmed(3, "evt-2", "borrower"),
				'release.confirmed: entered_by must be "lender", got "borrower"',
			],
			[
				"release.confirmed without a target",
				without(releaseConfirmed(), "target"),
				"release.confirmed: target is required",
			],
			[
				"release.confirmed with an empty target",
				releaseConfirmed(3, ""),
				"release.confirmed: target must be a non-empty string",
			],
			[
				"notice.sent by the borrower",
				{ ...notice(), entered_by: "borrower" },
				'notice.sent: entered_by must be "lender", got "borrower"',
			],
			[
				"notice.sent without a kind",
				without(notice(), "kind"),
				"notice.sent: kind is required",
			],
			[
				"notice.sent of an unknown kind",
				notice(2, { kind: "final" }),
				'notice.sent: kind must be "reminder" or "default", got "final"',
			],
			[
				"notice.sent default without cure_days",
				notice(2, { kind: "default" }),
				"notice.sent: cure_days is required when kind is default",
			],
			[
				"notice.sent reminder with cure_days",
				notice(2, { cure_days: 10 }),
				"notice.sent: cure_days is not allowed when kind is reminder",
			],
			[
				"notice.sent with negative cure_days",
				notice(2, { kind: "default", cure_days: -1 }),
				"notice.sent: cure_days must be an integer from 0 to 365, got -1",
			],
			[
				"notice.sent with 366 cure_days",
				notice(2, { kind: "default", cure_days: 366 }),
				"notice.sent: cure_days must be an integer from 0 to 365, got 366",
			],
			[
				"notice.sent with fractional cure_days",
				notice(2, { kind: "default", cure_days: 1.5 }),
				"notice.sent: cure_days must be an integer from 0 to 365, got 1.5",
			],
			[
				"notice.sent with a string cure_days",
				notice(2, { kind: "default", cure_days: "30" }),
				'notice.sent: cure_days must be an integer from 0 to 365, got "30"',
			],
			[
				"notice.sent with a body",
				notice(2, { text: "pay up" }),
				"notice.sent: text is not allowed",
			],
			[
				"party.rebound confirmed by the party being rebound (borrower)",
				rebound(2, "borrower", "borrower"),
				'party.rebound: entered_by must be "lender" (the other party) when role is "borrower", got "borrower"',
			],
			[
				"party.rebound confirmed by the party being rebound (lender)",
				rebound(2, "lender", "lender"),
				'party.rebound: entered_by must be "borrower" (the other party) when role is "lender", got "lender"',
			],
			[
				"party.rebound without a role",
				without(rebound(), "role"),
				"party.rebound: role is required",
			],
			[
				"party.rebound with a bad role",
				rebound(2, "guarantor"),
				'party.rebound: role must be "lender" or "borrower", got "guarantor"',
			],
			[
				"party.rebound without a commitment",
				without(rebound(), "contact_commitment"),
				"party.rebound: contact_commitment is required",
			],
			[
				"party.rebound with a short commitment",
				rebound(2, "borrower", "lender", { contact_commitment: "abc" }),
				"party.rebound: contact_commitment must be 64 lowercase hex",
			],
			[
				"party.rebound with an email",
				rebound(2, "borrower", "lender", { email: "a@b.co" }),
				"party.rebound: email is not allowed",
			],
			[
				"visibility.changed without a change",
				without(proposal(), "change"),
				"visibility.changed: change must be",
			],
			[
				"visibility.changed with an unknown change",
				proposal(2, { change: "grant.widened" }),
				'visibility.changed: change must be "grant.proposed", "grant.consented" or "grant.revoked", got "grant.widened"',
			],
			[
				"visibility.changed without a grant_id",
				without(proposal(), "grant_id"),
				"visibility.changed: grant_id is required",
			],
			[
				"visibility.changed with an empty grant_id",
				proposal(2, { grant_id: "" }),
				"visibility.changed: grant_id must be a non-empty string",
			],
			[
				"visibility.changed proposal without an audience",
				without(proposal(), "audience"),
				"visibility.changed: audience is required",
			],
			[
				"visibility.changed proposal without a level",
				without(proposal(), "level"),
				"visibility.changed: level is required",
			],
			[
				"visibility.changed with a string audience",
				proposal(2, { audience: "everyone" }),
				'visibility.changed: audience must be an object, got "everyone"',
			],
			[
				"visibility.changed with a public audience kind",
				proposal(2, { audience: { kind: "public", ref: "x" } }),
				'visibility.changed: audience.kind must be "person", "org" or "link", got "public"',
			],
			[
				"visibility.changed with an empty audience ref",
				proposal(2, { audience: { kind: "person", ref: "" } }),
				"visibility.changed: audience.ref must be a non-empty string",
			],
			[
				"visibility.changed with a missing audience ref",
				proposal(2, { audience: { kind: "person" } }),
				"visibility.changed: audience.ref is required",
			],
			[
				"visibility.changed with an audience email field",
				proposal(2, {
					audience: { kind: "person", ref: "x", email: "a@b.co" },
				}),
				"visibility.changed: audience.email is not allowed",
			],
			[
				"visibility.changed with an audience name field",
				proposal(2, { audience: { kind: "person", ref: "x", name: "Ann" } }),
				"visibility.changed: audience.name is not allowed",
			],
			[
				"visibility.changed with a bad level",
				proposal(2, { level: "full" }),
				'visibility.changed: level must be "summary", "statement" or "verify", got "full"',
			],
			[
				"visibility.changed with an expiry that is not UTC",
				proposal(2, { expires_at: "2027-01-01T00:00:00+02:00" }),
				"visibility.changed: expires_at must be an ISO 8601 UTC instant ending in Z",
			],
			[
				"visibility.changed with a date-only expiry",
				proposal(2, { expires_at: "2027-01-01" }),
				"visibility.changed: expires_at must be an ISO 8601 UTC instant ending in Z",
			],
			[
				"visibility.changed consent carrying an audience",
				{
					...grantAnswer(3, "grant.consented"),
					audience: { kind: "person", ref: "x" },
				},
				"visibility.changed: audience is not allowed",
			],
			[
				"visibility.changed revoke carrying a level",
				{ ...grantAnswer(3, "grant.revoked"), level: "summary" },
				"visibility.changed: level is not allowed",
			],
			[
				"visibility.changed consent carrying an expiry",
				{
					...grantAnswer(3, "grant.consented"),
					expires_at: "2027-01-01T00:00:00Z",
				},
				"visibility.changed: expires_at is not allowed",
			],
			[
				"approval.requested without an action",
				without(approvalRequested(), "action"),
				"approval.requested: action is required",
			],
			[
				"approval.requested with an unknown action",
				approvalRequested(3, { action: "release.draft" }),
				'approval.requested: action must be "release.confirm", "notice.default" or "waiver", got "release.draft"',
			],
			[
				"approval.requested without a target",
				without(approvalRequested(), "target"),
				"approval.requested: target is required",
			],
			[
				"approval.requested with an empty target",
				approvalRequested(3, { target: "" }),
				"approval.requested: target must be a non-empty string",
			],
			[
				"approval.granted without a request",
				without(approvalGranted(), "request"),
				"approval.granted: request is required",
			],
			[
				"approval.granted with an empty request",
				approvalGranted(4, ""),
				"approval.granted: request must be a non-empty string",
			],
			[
				"approval.granted with a target instead of a request",
				{ ...without(approvalGranted(), "request"), target: "evt-3" },
				"approval.granted: request is required",
			],
			[
				"via of an unknown value",
				recorded(2, "lender", { via: "sms" }),
				'payment.recorded: via must be "email-link" or "account", got "sms"',
			],
			[
				"via that is not a string",
				recorded(2, "lender", { via: 1 }),
				'payment.recorded: via must be "email-link" or "account", got 1',
			],
			[
				"an empty agent_ref",
				recorded(2, "lender", { agent_ref: "" }),
				"payment.recorded: agent_ref must be a non-empty string",
			],
			[
				"an agent_ref that is not a string",
				recorded(2, "lender", { agent_ref: 7 }),
				"payment.recorded: agent_ref must be a non-empty string",
			],
			[
				"an agent_ref of 129 characters",
				recorded(2, "lender", { agent_ref: "a".repeat(129) }),
				"payment.recorded: agent_ref must be at most 128 characters, got 129",
			],
			[
				"an agent_ref of 129 code points beyond the BMP",
				recorded(2, "lender", { agent_ref: "\u{1F600}".repeat(129) }),
				"payment.recorded: agent_ref must be at most 128 characters, got 129",
			],
			[
				"via on an unknown event type",
				make(2, "loan.forgiven", "lender", { via: "account" }),
				"event: type must be one of",
			],
			[
				"an email field on any event",
				{ ...termsAccepted(), email: "a@b.co" },
				"terms.accepted: email is not allowed",
			],
			[
				"a name field on any event",
				recorded(2, "lender", { name: "Ann" }),
				"payment.recorded: name is not allowed",
			],
		];
		for (const [name, event, message] of invalid) {
			it(name, () => {
				expect(() => parseNoteEvent(event)).toThrow(message);
			});
		}
	});

	describe("validateStream accepts", () => {
		const draftThenRelease = (): Fields[] => [
			created(),
			drafted(2),
			releaseConfirmed(3, "evt-2"),
		];
		const accepted: [string, () => Fields[]][] = [
			[
				"a payment before the borrower accepts the terms",
				() => [created(), recorded(2, "lender"), termsAccepted(3)],
			],
			[
				"terms accepted, then declined",
				() => [created(), termsAccepted(2), termsDeclined(3)],
			],
			["a draft and its confirmation", draftThenRelease],
			[
				"a confirmation at the same instant as its draft",
				() => [
					created(),
					{ ...drafted(2), entered_at: "2026-02-01T12:00:00Z" },
					{
						...releaseConfirmed(3, "evt-2"),
						entered_at: "2026-02-01T12:00:00Z",
					},
				],
			],
			[
				"a confirmation a fraction of a second after its draft",
				() => [
					created(),
					{ ...drafted(2), entered_at: "2026-02-01T12:00:00Z" },
					{
						...releaseConfirmed(3, "evt-2"),
						entered_at: "2026-02-01T12:00:00.5Z",
					},
				],
			],
			[
				"a confirmation between two fractions of a second",
				() => [
					created(),
					{ ...drafted(2), entered_at: "2026-02-01T12:00:00.123Z" },
					{
						...releaseConfirmed(3, "evt-2"),
						entered_at: "2026-02-01T12:00:00.1234Z",
					},
				],
			],
			[
				"two confirmations of one draft",
				() => [...draftThenRelease(), releaseConfirmed(4, "evt-2")],
			],
			[
				"a payoff, a reminder and a default notice",
				() => [
					created(),
					payoff(2),
					notice(3),
					notice(4, { kind: "default", cure_days: 30 }),
				],
			],
			["a rebind of the borrower", () => [created(), rebound(2)]],
			[
				"a proposal, a consent and a revoke",
				() => [
					created(),
					proposal(2),
					grantAnswer(3, "grant.consented"),
					grantAnswer(4, "grant.revoked", "borrower"),
				],
			],
			[
				"two grants with different ids",
				() => [created(), proposal(2), proposal(3, { grant_id: "grant-2" })],
			],
			[
				"a revoke of a grant that was never consented",
				() => [created(), proposal(2), grantAnswer(3, "grant.revoked")],
			],
			[
				"an approval requested against any earlier event, then granted",
				() => [
					created(),
					recorded(2, "borrower"),
					approvalRequested(3, { action: "waiver", target: "evt-2" }),
					approvalGranted(4, "evt-3"),
				],
			],
		];
		for (const [name, build] of accepted) {
			it(name, () => {
				expect(validateStream(build()).length).toBeGreaterThan(0);
			});
		}
	});

	describe("validateStream rejects", () => {
		const invalidStreams: [string, () => unknown[], string][] = [
			[
				"a release.confirmed with no draft",
				() => [created(), releaseConfirmed(2, "evt-9")],
				'release.confirmed: seq 2: target "evt-9" does not match an earlier release.drafted event',
			],
			[
				"a release.confirmed naming a payment",
				() => [
					created(),
					recorded(2, "borrower"),
					releaseConfirmed(3, "evt-2"),
				],
				'release.confirmed: seq 3: target "evt-2" has type payment.recorded, not release.drafted',
			],
			[
				"a release.confirmed naming itself",
				() => [created(), drafted(2), releaseConfirmed(3, "evt-3")],
				'release.confirmed: seq 3: target "evt-3" does not match an earlier release.drafted event',
			],
			[
				"a release.confirmed entered before its draft",
				() => [
					created(),
					{ ...drafted(2), entered_at: "2026-02-01T12:00:00Z" },
					{
						...releaseConfirmed(3, "evt-2"),
						entered_at: "2026-02-01T11:59:59Z",
					},
				],
				'release.confirmed: seq 3: entered_at 2026-02-01T11:59:59Z is before the 2026-02-01T12:00:00Z of the draft "evt-2"',
			],
			[
				"a release.confirmed a fraction of a second before its draft",
				() => [
					created(),
					{ ...drafted(2), entered_at: "2026-02-01T12:00:00.5Z" },
					{
						...releaseConfirmed(3, "evt-2"),
						entered_at: "2026-02-01T12:00:00.49Z",
					},
				],
				"release.confirmed: seq 3: entered_at 2026-02-01T12:00:00.49Z is before",
			],
			[
				"a release.confirmed before its draft when only the whole second matches",
				() => [
					created(),
					{ ...drafted(2), entered_at: "2026-02-01T12:00:00.5Z" },
					{
						...releaseConfirmed(3, "evt-2"),
						entered_at: "2026-02-01T12:00:00Z",
					},
				],
				"release.confirmed: seq 3: entered_at 2026-02-01T12:00:00Z is before",
			],
			[
				"a consent with no proposal",
				() => [created(), grantAnswer(2, "grant.consented")],
				'visibility.changed: seq 2: grant_id "grant-1" does not match an earlier grant.proposed event',
			],
			[
				"a revoke of an unknown grant",
				() => [
					created(),
					proposal(2),
					grantAnswer(3, "grant.revoked", "lender", "grant-9"),
				],
				'visibility.changed: seq 3: grant_id "grant-9" does not match an earlier grant.proposed event',
			],
			[
				"a consent that comes before its proposal",
				() => [created(), grantAnswer(2, "grant.consented"), proposal(3)],
				'visibility.changed: seq 2: grant_id "grant-1" does not match an earlier grant.proposed event',
			],
			[
				"a second proposal with the same grant_id",
				() => [created(), proposal(2), proposal(3)],
				'visibility.changed: seq 3: grant_id "grant-1" is already proposed by seq 2',
			],
			[
				"an approval request about an unknown event",
				() => [created(), approvalRequested(2, { target: "evt-9" })],
				'approval.requested: seq 2: target "evt-9" does not match an earlier event',
			],
			[
				"an approval request about itself",
				() => [created(), approvalRequested(2, { target: "evt-2" })],
				'approval.requested: seq 2: target "evt-2" does not match an earlier event',
			],
			[
				"an approval granted for an unknown request",
				() => [created(), approvalGranted(2, "evt-9")],
				'approval.granted: seq 2: request "evt-9" does not match an earlier approval.requested event',
			],
			[
				"an approval granted for an event that is not a request",
				() => [created(), recorded(2, "borrower"), approvalGranted(3, "evt-2")],
				'approval.granted: seq 3: request "evt-2" has type payment.recorded, not approval.requested',
			],
			[
				"an approval granted before its request",
				() => [
					created(),
					approvalGranted(2, "evt-3"),
					approvalRequested(3, { target: "evt-1" }),
				],
				'approval.granted: seq 2: request "evt-3" does not match an earlier approval.requested event',
			],
			[
				"a second note.created disguised among the new events",
				() => [
					created(),
					termsAccepted(2),
					{ ...created(), id: "evt-3", seq: 3 },
				],
				"note.created: seq 3: note.created is only allowed as the first event",
			],
			[
				"a new event with a repeated id",
				() => [
					created(),
					termsAccepted(2),
					{ ...termsDeclined(3), id: "evt-2" },
				],
				'terms.declined: seq 3: id "evt-2" is already used by seq 2',
			],
			[
				"a new event with a gap in seq",
				() => [created(), termsAccepted(3)],
				"stream: seq has a gap",
			],
			[
				"a new event with another note_id",
				() => [created(), { ...termsAccepted(2), note_id: "note-2" }],
				'terms.accepted: seq 2: note_id "note-2" differs from "note-1"',
			],
			[
				"an invalid new event named by its index",
				() => [created(), termsAccepted(2, "lender")],
				'events[1]: terms.accepted: entered_by must be "borrower"',
			],
		];
		for (const [name, build, message] of invalidStreams) {
			it(name, () => {
				expect(() => validateStream(build())).toThrow(message);
			});
		}
	});
});

describe("schema/note-event.v1.json", () => {
	const EVENT_TYPE_NAMES: NoteEvent["type"][] = [
		"note.created",
		"payment.recorded",
		"payment.confirmed",
		"payment.disputed",
		"payment.resolved",
		"annotation.added",
		"terms.accepted",
		"terms.declined",
		"payoff.issued",
		"release.drafted",
		"release.confirmed",
		"notice.sent",
		"party.rebound",
		"visibility.changed",
		"approval.requested",
		"approval.granted",
	];

	it("is JSON Schema 2020-12 with a oneOf over the sixteen event types", () => {
		expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
		// visibility.changed has two branches: a proposal, and a consent or revocation.
		expect(schema.oneOf.length).toBe(17);
		expect(EVENT_TYPE_NAMES.length).toBe(16);
	});

	it("has one branch per NoteEvent type (two for visibility.changed), each closed", () => {
		const branchTypes = [
			...new Set(schema.oneOf.map((branch) => branch.properties.type.const)),
		];
		expect(branchTypes).toEqual(EVENT_TYPE_NAMES);
		for (const branch of schema.oneOf) {
			expect(branch.additionalProperties).toBe(false);
			expect(branch.properties.schema).toEqual({ $ref: "#/$defs/schema" });
		}
		expect(schema.$defs.schema.const).toBe("tfd.note-event.v1");
	});

	it("matches the validator on bounds: seq and count maximum, positive principal, code-only checks described", () => {
		expect(schema.$defs.seq.maximum).toBe(Number.MAX_SAFE_INTEGER);
		expect(schema.$defs.terms.properties.principal_minor).toEqual({
			$ref: "#/$defs/minor_positive",
		});
		expect(new RegExp(schema.$defs.minor_positive.pattern).test("0")).toBe(
			false,
		);
		expect(new RegExp(schema.$defs.minor_positive.pattern).test("1")).toBe(
			true,
		);
		const amortizedBranch = JSON.parse(
			JSON.stringify(schema.$defs.schedule.oneOf[0]),
		) as { properties: { count: { maximum: number } } };
		expect(amortizedBranch.properties.count.maximum).toBe(
			Number.MAX_SAFE_INTEGER,
		);
		expect(schema.description).toContain("checked in code");
	});

	it("declares no personal-data property anywhere: no email, no name", () => {
		const found: string[] = [];
		const visit = (node: unknown): void => {
			if (Array.isArray(node)) {
				for (const item of node) visit(item);
				return;
			}
			if (typeof node !== "object" || node === null) return;
			for (const [key, value] of Object.entries(node)) {
				if (
					key === "properties" &&
					typeof value === "object" &&
					value !== null
				) {
					for (const propertyName of Object.keys(value)) {
						if (propertyName === "email" || propertyName === "name") {
							found.push(propertyName);
						}
					}
				}
				visit(value);
			}
		};
		visit(schema);
		expect(found).toEqual([]);
	});

	it("gives every branch the optional via and agent_ref", () => {
		for (const branch of schema.oneOf) {
			expect(branch.required).not.toContain("via");
			expect(branch.required).not.toContain("agent_ref");
			expect(branch.properties).toHaveProperty("via");
			expect(branch.properties).toHaveProperty("agent_ref");
		}
		expect(schema.$defs.via.enum).toEqual(["email-link", "account"]);
		expect(schema.$defs.agent_ref).toMatchObject({
			type: "string",
			minLength: 1,
			maxLength: 128,
		});
	});

	it("fixes entered_by on the events only one role may enter", () => {
		const roles: Record<string, string> = {
			"terms.accepted": "borrower",
			"terms.declined": "borrower",
			"payoff.issued": "lender",
			"release.drafted": "lender",
			"release.confirmed": "lender",
			"notice.sent": "lender",
		};
		for (const [type, role] of Object.entries(roles)) {
			const branch = schema.oneOf.find(
				(candidate) => candidate.properties.type.const === type,
			);
			expect(branch?.properties.entered_by).toEqual({ const: role });
		}
	});

	it("keeps money out of payoff.issued", () => {
		const branch = schema.oneOf.find(
			(candidate) => candidate.properties.type.const === "payoff.issued",
		);
		expect(
			Object.keys(branch?.properties ?? {}).filter((key) =>
				key.endsWith("_minor"),
			),
		).toEqual([]);
	});

	it("requires counter_amount_minor and reason on payment.disputed", () => {
		const branch = schema.oneOf.find(
			(candidate) => candidate.properties.type.const === "payment.disputed",
		);
		expect(branch?.required).toContain("counter_amount_minor");
		expect(branch?.required).toContain("reason");
	});

	it("makes reverses depend on kind", () => {
		const branch = schema.oneOf.find(
			(candidate) => candidate.properties.type.const === "payment.recorded",
		);
		expect(branch).toBeDefined();
		expect(branch).toMatchObject({
			if: { properties: { kind: { const: "reversal" } } },
		});
		const conditions = JSON.parse(JSON.stringify(branch)) as Record<
			string,
			unknown
		>;
		expect(conditions[THEN_KEY]).toEqual({ required: ["reverses"] });
		expect(conditions.else).toEqual({ not: { required: ["reverses"] } });
	});
});

describe("grant.proposed expiry, link and carve-out rules", () => {
	const ENTERED_AT = "2026-02-01T12:00:00Z";
	const proposed = (fields: Fields = {}): Fields =>
		make(2, "visibility.changed", "lender", {
			change: "grant.proposed",
			grant_id: "grant-1",
			audience: { kind: "person", ref: "person-ref-1" },
			level: "summary",
			expires_at: "2026-03-01T12:00:00Z",
			...fields,
		});
	const carveOut = (fields: Fields = {}): Fields =>
		proposed({
			carve_out: true,
			purpose: "accountant",
			level: "statement",
			...fields,
		});
	const withoutKey = (event: Fields, key: string): Fields => {
		const { [key]: _removed, ...rest } = event;
		return rest;
	};

	const accepted: [string, Fields][] = [
		["a plain person grant", proposed()],
		[
			"an expiry one second after entered_at",
			proposed({ expires_at: "2026-02-01T12:00:01Z" }),
		],
		[
			"an expiry exactly 365 days after entered_at",
			proposed({ expires_at: "2027-02-01T12:00:00Z" }),
		],
		[
			"a link at verify level",
			proposed({ audience: { kind: "link", ref: "link-1" }, level: "verify" }),
		],
		[
			"an org at statement level",
			proposed({ audience: { kind: "org", ref: "org-1" }, level: "statement" }),
		],
		["a carve-out at statement level with an accountant", carveOut()],
		[
			"a carve-out at summary level with a lawyer",
			carveOut({ level: "summary", purpose: "lawyer" }),
		],
		["a carve-out for a court", carveOut({ purpose: "court" })],
		["a carve-out for an assignee", carveOut({ purpose: "assignee" })],
		[
			"a carve-out exactly 90 days after entered_at",
			carveOut({ expires_at: "2026-05-02T12:00:00Z" }),
		],
		["carve_out false with no purpose", proposed({ carve_out: false })],
		[
			"carve_out false with a purpose on an org",
			proposed({
				carve_out: false,
				purpose: "lawyer",
				audience: { kind: "org", ref: "o" },
			}),
		],
	];
	for (const [name, event] of accepted) {
		it(`accepts ${name}`, () => {
			expect(parseNoteEvent(event)).toEqual(event as unknown as NoteEvent);
		});
	}

	const rejected: [string, Fields, string][] = [
		[
			"a proposal without expires_at",
			withoutKey(proposed(), "expires_at"),
			"visibility.changed: expires_at is required",
		],
		[
			"an expiry at entered_at",
			proposed({ expires_at: ENTERED_AT }),
			"must be after entered_at",
		],
		[
			"an expiry before entered_at",
			proposed({ expires_at: "2026-01-01T00:00:00Z" }),
			"must be after entered_at",
		],
		[
			"an expiry one second past 365 days",
			proposed({ expires_at: "2027-02-01T12:00:01Z" }),
			"more than 365 days after entered_at",
		],
		[
			"an expiry two years out",
			proposed({ expires_at: "2028-02-01T12:00:00Z" }),
			"more than 365 days after entered_at",
		],
		[
			"a carve-out one second past 90 days",
			carveOut({ expires_at: "2026-05-02T12:00:01Z" }),
			"more than 90 days after entered_at",
		],
		[
			"a carve-out for a year",
			carveOut({ expires_at: "2027-02-01T12:00:00Z" }),
			"more than 90 days after entered_at",
		],
		[
			"a carve-out for the purpose other",
			carveOut({ purpose: "other" }),
			'purpose must be "accountant", "lawyer", "court" or "assignee"',
		],
		[
			"a link at statement level",
			proposed({ audience: { kind: "link", ref: "l" }, level: "statement" }),
			'a link audience may only have level "verify"',
		],
		[
			"a link at summary level",
			proposed({ audience: { kind: "link", ref: "l" }, level: "summary" }),
			'a link audience may only have level "verify"',
		],
		[
			"a carve-out without a purpose",
			withoutKey(carveOut(), "purpose"),
			"purpose is required when carve_out is true",
		],
		[
			"a carve-out to an org",
			carveOut({ audience: { kind: "org", ref: "o" } }),
			"a carve_out may only name a person audience",
		],
		[
			"a carve-out to a link",
			carveOut({ audience: { kind: "link", ref: "l" }, level: "verify" }),
			"a carve_out may only name a person audience",
		],
		[
			"a carve-out at verify level",
			carveOut({ level: "verify" }),
			'a carve_out level must be "summary" or "statement"',
		],
		[
			"a purpose outside the list",
			carveOut({ purpose: "friend" }),
			"purpose must be",
		],
		[
			"a carve_out that is not a boolean",
			proposed({ carve_out: "yes" }),
			"carve_out must be true or false",
		],
		[
			"a purpose that is not a string",
			carveOut({ purpose: 3 }),
			"purpose must be",
		],
	];
	for (const [name, event, message] of rejected) {
		it(`rejects ${name}`, () => {
			expect(() => parseNoteEvent(event)).toThrow(message);
		});
	}

	it("exports the day caps the validator applies", () => {
		expect(MAX_GRANT_DAYS).toBe(365);
		expect(MAX_CARVE_OUT_DAYS).toBe(90);
	});

	it("keeps the 365-day cap for a grant that is not a carve-out", () => {
		expect(() =>
			parseNoteEvent(proposed({ expires_at: "2026-05-02T12:00:01Z" })),
		).not.toThrow();
	});

	it("describes the same rules in the schema", () => {
		const branch = schema.oneOf.find(
			(candidate) => candidate.title === "visibility.changed (grant.proposed)",
		);
		expect(branch?.properties.purpose?.enum).toEqual([
			"accountant",
			"lawyer",
			"court",
			"assignee",
		]);
		expect(branch?.required).toContain("expires_at");
		expect(branch?.properties).toHaveProperty("purpose");
		expect(branch?.properties).toHaveProperty("carve_out");
		expect(JSON.stringify(branch)).toContain('"link"');
	});
});

describe("default notice binding in the event shapes", () => {
	const request = (seq: number, fields: Fields = {}): Fields =>
		make(seq, "approval.requested", "lender", {
			action: "notice.default",
			target: "evt-1",
			cure_days: 30,
			...fields,
		});
	const defaultNotice = (seq: number, fields: Fields = {}): Fields =>
		make(seq, "notice.sent", "lender", {
			kind: "default",
			cure_days: 30,
			...fields,
		});

	it("requires cure_days on an approval.requested for notice.default", () => {
		expect(() => parseNoteEvent(request(2))).not.toThrow();
		expect(() => parseNoteEvent(without(request(2), "cure_days"))).toThrow(
			"approval.requested: cure_days is required when action is notice.default",
		);
	});

	it("forbids cure_days on any other approval action", () => {
		for (const action of ["release.confirm", "waiver"]) {
			expect(() => parseNoteEvent(request(2, { action }))).toThrow(
				"approval.requested: cure_days is only allowed when action is notice.default",
			);
		}
	});

	it("takes cure_days from 0 to 365 only", () => {
		for (const good of [0, 1, 365]) {
			expect(() =>
				parseNoteEvent(request(2, { cure_days: good })),
			).not.toThrow();
		}
		for (const bad of [-1, 366, 1.5, "30", null]) {
			expect(() => parseNoteEvent(request(2, { cure_days: bad }))).toThrow(
				"approval.requested: cure_days must be an integer from 0 to 365",
			);
		}
	});

	it("takes an approval on a default notice and refuses one on a reminder", () => {
		expect(
			parseNoteEvent(defaultNotice(3, { approval: "evt-2" })),
		).toMatchObject({ approval: "evt-2" });
		expect(() =>
			parseNoteEvent(
				make(3, "notice.sent", "lender", {
					kind: "reminder",
					approval: "evt-2",
				}),
			),
		).toThrow("notice.sent: approval is not allowed when kind is reminder");
		expect(() => parseNoteEvent(defaultNotice(3, { approval: "" }))).toThrow(
			"notice.sent: approval must be a non-empty string",
		);
	});

	const streamOf = (...extra: Fields[]): unknown[] => [created(), ...extra];

	it("accepts a notice whose approval is an earlier request with the same cure_days", () => {
		const stream = streamOf(
			request(2),
			defaultNotice(3, { approval: "evt-2" }),
		);
		expect(validateStream(stream)).toHaveLength(3);
	});

	it("accepts a default notice with no approval (the policy decides whether one is needed)", () => {
		expect(validateStream(streamOf(defaultNotice(2)))).toHaveLength(2);
	});

	it("rejects an approval that does not exist, is not a request, or is a request for another action", () => {
		expect(() =>
			validateStream(streamOf(defaultNotice(2, { approval: "evt-9" }))),
		).toThrow(
			'notice.sent: seq 2: approval "evt-9" does not match an earlier approval.requested event',
		);
		expect(() =>
			validateStream(
				streamOf(
					recorded(2, "borrower"),
					defaultNotice(3, { approval: "evt-2" }),
				),
			),
		).toThrow(
			'notice.sent: seq 3: approval "evt-2" has type payment.recorded, not approval.requested',
		);
		expect(() =>
			validateStream(
				streamOf(
					without(request(2, { action: "waiver" }), "cure_days"),
					defaultNotice(3, { approval: "evt-2" }),
				),
			),
		).toThrow(
			'notice.sent: seq 3: approval "evt-2" is a request for waiver, not notice.default',
		);
	});

	it("rejects an approval that names a request that comes later", () => {
		expect(() =>
			validateStream(
				streamOf(defaultNotice(2, { approval: "evt-3" }), request(3)),
			),
		).toThrow("does not match an earlier approval.requested event");
	});

	it("rejects a notice whose cure_days differs from its request", () => {
		expect(() =>
			validateStream(
				streamOf(
					request(2),
					defaultNotice(3, { approval: "evt-2", cure_days: 31 }),
				),
			),
		).toThrow(
			'notice.sent: seq 3: cure_days 31 differs from the 30 of the approval request "evt-2"',
		);
	});
});

describe("declined terms in the stream", () => {
	const declined = (seq: number): Fields =>
		make(seq, "terms.declined", "borrower", {});
	const accepted = (seq: number): Fields =>
		make(seq, "terms.accepted", "borrower", {});
	const payoff = (seq: number): Fields =>
		make(seq, "payoff.issued", "lender", {
			as_of: "2026-03-01",
			document_sha256: "a".repeat(64),
		});
	const reminder = (seq: number): Fields =>
		make(seq, "notice.sent", "lender", { kind: "reminder" });
	const defaultNotice = (seq: number): Fields =>
		make(seq, "notice.sent", "lender", { kind: "default", cure_days: 30 });
	const defaultRequest = (seq: number): Fields =>
		make(seq, "approval.requested", "lender", {
			action: "notice.default",
			target: "evt-1",
			cure_days: 30,
		});

	const refused: [string, (seq: number) => Fields][] = [
		["a payoff statement", payoff],
		["a reminder", reminder],
		["a default notice", defaultNotice],
		["a request to approve a default notice", defaultRequest],
	];
	for (const [name, build] of refused) {
		it(`rejects ${name} while the terms stand declined`, () => {
			expect(() => validateStream([created(), declined(2), build(3)])).toThrow(
				"the borrower has declined the terms (terms.declined)",
			);
		});
		it(`allows ${name} again once the borrower accepts`, () => {
			expect(
				validateStream([created(), declined(2), accepted(3), build(4)]),
			).toHaveLength(4);
		});
		it(`allows ${name} before any decision`, () => {
			expect(validateStream([created(), build(2)])).toHaveLength(2);
		});
	}

	it("rejects again after a later decline", () => {
		expect(() =>
			validateStream([
				created(),
				declined(2),
				accepted(3),
				declined(4),
				reminder(5),
			]),
		).toThrow("terms.declined");
	});

	it("still allows payments, confirmations, disputes, annotations, releases and approvals of other actions", () => {
		const stream = [
			created(),
			declined(2),
			recorded(3, "borrower"),
			confirmed(4, "lender", "evt-3"),
			recorded(5, "lender"),
			disputed(6, "borrower", "evt-5"),
			annotation(7),
			make(8, "release.drafted", "lender", {}),
			make(9, "release.confirmed", "lender", { target: "evt-8" }),
			make(10, "approval.requested", "lender", {
				action: "release.confirm",
				target: "evt-8",
			}),
		];
		expect(validateStream(stream)).toHaveLength(10);
	});
});

describe("free text hygiene", () => {
	const UNSAFE: [string, string][] = [
		["a null character", "\u0000"],
		["a bell", "\u0007"],
		["a carriage return", "\r"],
		["an escape", "\u001b"],
		["a delete character", "\u007f"],
		["a C1 control", "\u0085"],
		["the last C1 control", "\u009f"],
		["a left-to-right mark", "‎"],
		["a right-to-left mark", "‏"],
		["an Arabic letter mark", "؜"],
		["a right-to-left override", "‮"],
		["a left-to-right embedding", "‪"],
		["a bidirectional isolate", "⁦"],
		["a pop directional isolate", "⁩"],
		["a byte order mark", "﻿"],
	];
	const LAYOUT: [string, string][] = [
		["a newline", "\n"],
		["a tab", "\t"],
	];
	const fields: [string, (value: string) => Fields, boolean][] = [
		["annotation.added text", (value) => annotation(2, { text: value }), true],
		[
			"payment.disputed reason",
			(value) => disputed(3, "borrower", "evt-2", { reason: value }),
			true,
		],
		[
			"payment.recorded method",
			(value) => recorded(2, "borrower", { method: value }),
			false,
		],
		[
			"payment.recorded reference",
			(value) => recorded(2, "borrower", { reference: value }),
			false,
		],
		["agent_ref", (value) => annotation(2, { agent_ref: value }), false],
	];
	for (const [fieldName, build, multiline] of fields) {
		const path = fieldName.split(" ").pop() ?? fieldName;
		for (const [kind, character] of UNSAFE) {
			it(`${fieldName} rejects ${kind}`, () => {
				expect(() => parseNoteEvent(build(`pay${character}ment`))).toThrow(
					`${fieldName === "agent_ref" ? "annotation.added" : fieldName.split(" ")[0]}: ${path} must not contain control or bidirectional characters`,
				);
			});
		}
		for (const [kind, character] of LAYOUT) {
			it(`${fieldName} ${multiline ? "keeps" : "rejects"} ${kind}`, () => {
				const attempt = () => parseNoteEvent(build(`one${character}two`));
				if (multiline) {
					expect(attempt).not.toThrow();
				} else {
					expect(attempt).toThrow("must not contain control or bidirectional");
				}
			});
		}
		it(`${fieldName} keeps ordinary text, accents, emoji and other scripts`, () => {
			expect(() =>
				parseNoteEvent(build("Pago en efectivo, señor 😀 تم الدفع 支払い")),
			).not.toThrow();
		});
	}

	it("names the character and its position", () => {
		expect(() => parseNoteEvent(annotation(2, { text: "ab‮cd" }))).toThrow(
			"found U+202E at character 2",
		);
		expect(() => parseNoteEvent(annotation(2, { text: "😀\u0000" }))).toThrow(
			"found U+0000 at character 1",
		);
	});

	it("still takes an empty method and reference, and refuses an empty text", () => {
		expect(() =>
			parseNoteEvent(recorded(2, "borrower", { method: "", reference: "" })),
		).not.toThrow();
		expect(() => parseNoteEvent(annotation(2, { text: "" }))).toThrow(
			"annotation.added: text must be a non-empty string",
		);
	});

	it("is written into the schema as patterns that agree with the validator", () => {
		const line = new RegExp(schema.$defs.free_line.pattern);
		const text = new RegExp(schema.$defs.free_text.pattern);
		const agent = new RegExp(schema.$defs.agent_ref.pattern);
		for (const [, character] of UNSAFE) {
			for (const pattern of [line, text, agent]) {
				expect(pattern.test(`a${character}b`)).toBe(false);
			}
		}
		for (const [, character] of LAYOUT) {
			expect(text.test(`a${character}b`)).toBe(true);
			expect(line.test(`a${character}b`)).toBe(false);
		}
		expect(line.test("señor 😀 تم الدفع")).toBe(true);
	});
});
