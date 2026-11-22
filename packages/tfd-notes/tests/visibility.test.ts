// SPDX-License-Identifier: Apache-2.0
/**
 * The shared view (plan decision D1): what a reader outside the two parties may see. The ceiling is that negative events
 * never leave the two parties, so a stream with a dispute or an unanswered claim projects exactly like the same stream
 * without that payment.
 *
 * Hand arithmetic for the scenario below (rate 0.0365 on 100000 minor units is exactly 10 minor units a day, actual/365):
 *   issue 2026-01-15; lender payment 40000 on 2026-02-15 (31 days: interest 310, principal 39690) leaves principal 60310;
 *   borrower payment 10000 on 2026-02-20, confirmed by the lender (5 days on 60310: 30.155, rounds to 30; principal
 *   9970) leaves principal 50340 with 0.155 of interest carried; to 2026-03-01 (9 days on 50340: 45.306 + 0.155 =
 *   45.461) interest 45, payoff 50385. The borrower's unanswered 15000 on 2026-02-25 and the lender's 20000 on
 *   2026-02-27 that the borrower disputed at 5000 do not appear anywhere.
 */
import { describe, expect, it } from "bun:test";
import { grantsOf } from "../src/grants";
import { statement } from "../src/statement";
import type { GrantLevel, Role } from "../src/types";
import {
	AGREED_PAYMENTS_LABEL,
	agreedBalance,
	type SharedView,
	sharedView,
	viewFor,
} from "../src/visibility";

type Fields = Record<string, unknown>;

const TERMS: Fields = {
	currency: "USD",
	exponent: 2,
	principal_minor: "100000",
	issue_date: "2026-01-15",
	annual_rate: "0.0365",
	day_count: "actual/365",
	rounding: "half-up",
	timezone: "America/Denver",
	schedule: {
		type: "custom",
		installments: [
			{ due: "2026-02-15", amount_minor: "40000" },
			{ due: "2026-03-15", amount_minor: "40000" },
			{ due: "2026-04-15", amount_minor: "20542" },
		],
	},
};

const AS_OF = "2026-03-01";
const LEVELS: GrantLevel[] = ["verify", "summary", "statement"];

const make = (
	seq: number,
	type: string,
	enteredBy: Role,
	enteredAt: string,
	fields: Fields,
): Fields => ({
	schema: "tfd.note-event.v1",
	id: `evt-${seq}`,
	note_id: "note-vis",
	seq,
	entered_at: enteredAt,
	entered_by: enteredBy,
	type,
	...fields,
});

const created = (): Fields =>
	make(1, "note.created", "lender", "2026-01-15T10:00:00Z", { terms: TERMS });

const payment = (
	seq: number,
	enteredBy: Role,
	valueDate: string,
	amount: string,
	fields: Fields = {},
): Fields =>
	make(seq, "payment.recorded", enteredBy, `${valueDate}T09:00:00Z`, {
		kind: "payment",
		amount_minor: amount,
		value_date: valueDate,
		...fields,
	});

const confirmed = (
	seq: number,
	enteredBy: Role,
	enteredAt: string,
	target: string,
): Fields => make(seq, "payment.confirmed", enteredBy, enteredAt, { target });

/** The agreed payments, the unanswered claim and the disputed payment described above. */
const scenario = (): Fields[] => [
	created(),
	payment(2, "lender", "2026-02-15", "40000"),
	payment(3, "borrower", "2026-02-25", "15000"),
	payment(4, "borrower", "2026-02-20", "10000"),
	confirmed(5, "lender", "2026-02-21T09:00:00Z", "evt-4"),
	payment(6, "lender", "2026-02-27", "20000"),
	make(7, "payment.disputed", "borrower", "2026-02-28T09:00:00Z", {
		target: "evt-6",
		counter_amount_minor: "5000",
		reason: "I only paid fifty",
	}),
];

/** The same agreed facts and nothing else. */
const agreedOnly = (): Fields[] => [
	created(),
	payment(2, "lender", "2026-02-15", "40000"),
	payment(3, "borrower", "2026-02-20", "10000"),
	confirmed(4, "lender", "2026-02-21T09:00:00Z", "evt-3"),
];

const BANNED =
	/dispute|overdue|late|unanswered|notice|default|reason|annotation|agent|via|email|name/i;

/** Every key and every string value in a projection, however deep. */
const wordsIn = (node: unknown): string[] => {
	if (typeof node === "string") {
		return [node];
	}
	if (Array.isArray(node)) {
		return node.flatMap(wordsIn);
	}
	if (typeof node === "object" && node !== null) {
		return Object.entries(node).flatMap(([key, value]) => [
			key,
			...wordsIn(value),
		]);
	}
	return [];
};

describe("agreedBalance", () => {
	it("counts only what both views count identically", () => {
		expect(agreedBalance(scenario(), AS_OF)).toEqual({
			principal_minor: "50340",
			interest_minor: "45",
			payoff_minor: "50385",
			paid_minor: "50000",
			overpaid_minor: "0",
		});
	});

	it("is the same as the balance of the stream holding only the agreed facts", () => {
		expect(agreedBalance(scenario(), AS_OF)).toEqual(
			agreedBalance(agreedOnly(), AS_OF),
		);
		expect(agreedBalance(agreedOnly(), AS_OF)).toEqual(
			statement(agreedOnly(), AS_OF).lender,
		);
	});

	it("differs from each party's own view while claims are unanswered", () => {
		const full = statement(scenario(), AS_OF);
		const agreed = agreedBalance(scenario(), AS_OF);
		expect(agreed.payoff_minor).not.toBe(full.lender.payoff_minor);
		expect(agreed.payoff_minor).not.toBe(full.borrower.payoff_minor);
	});

	it("equals both views when nothing is in difference", () => {
		const events = agreedOnly();
		const full = statement(events, AS_OF);
		expect(full.difference).toEqual([]);
		expect(agreedBalance(events, AS_OF)).toEqual(full.lender);
		expect(agreedBalance(events, AS_OF)).toEqual(full.borrower);
	});

	it("keeps a payment both parties settled by resolution", () => {
		const events = [
			...scenario(),
			make(8, "payment.resolved", "lender", "2026-02-28T10:00:00Z", {
				target: "evt-6",
				agreed_amount_minor: "5000",
			}),
			make(9, "payment.resolved", "borrower", "2026-02-28T11:00:00Z", {
				target: "evt-6",
				agreed_amount_minor: "5000",
			}),
		];
		expect(
			statement(events, AS_OF).difference.map((item) => item.event_id),
		).toEqual(["evt-3"]);
		expect(agreedBalance(events, AS_OF).paid_minor).toBe("55000");
	});

	it("leaves a payment the lender recorded and the borrower has not answered in both views at once", () => {
		const events = [created(), payment(2, "lender", "2026-02-15", "40000")];
		expect(agreedBalance(events, AS_OF).paid_minor).toBe("40000");
	});

	it("drops a lender reversal until the borrower confirms it, then applies it", () => {
		const reversal = payment(3, "lender", "2026-02-20", "40000", {
			kind: "reversal",
			reverses: "evt-2",
		});
		const base = [created(), payment(2, "lender", "2026-02-15", "40000")];
		expect(agreedBalance([...base, reversal], AS_OF).paid_minor).toBe("40000");
		expect(
			agreedBalance(
				[
					...base,
					reversal,
					confirmed(4, "borrower", "2026-02-21T09:00:00Z", "evt-3"),
				],
				AS_OF,
			).paid_minor,
		).toBe("0");
	});

	it("applies a borrower reversal at once, since it hurts the borrower", () => {
		const events = [
			created(),
			payment(2, "lender", "2026-02-15", "40000"),
			payment(3, "borrower", "2026-02-20", "40000", {
				kind: "reversal",
				reverses: "evt-2",
			}),
		];
		expect(agreedBalance(events, AS_OF).paid_minor).toBe("0");
	});

	it("drops a reversal of a payment it drops", () => {
		const events = [
			created(),
			payment(2, "borrower", "2026-02-15", "40000"),
			payment(3, "borrower", "2026-02-20", "40000", {
				kind: "reversal",
				reverses: "evt-2",
			}),
		];
		expect(agreedBalance(events, AS_OF)).toEqual(
			agreedBalance([created()], AS_OF),
		);
	});
});

describe("sharedView", () => {
	it("at verify carries the note id and level and nothing else", () => {
		expect(sharedView(scenario(), "verify", AS_OF)).toEqual({
			note_id: "note-vis",
			level: "verify",
		});
		expect(Object.keys(sharedView(scenario(), "verify", AS_OF))).toEqual([
			"note_id",
			"level",
		]);
	});

	it("at summary carries the agreed figures and the schedule's length and next due date", () => {
		expect(sharedView(scenario(), "summary", AS_OF)).toEqual({
			note_id: "note-vis",
			level: "summary",
			as_of: AS_OF,
			currency: "USD",
			exponent: 2,
			status: "open",
			principal_minor: "50340",
			interest_minor: "45",
			payoff_minor: "50385",
			schedule_length: 3,
			next_installment_due: "2026-03-15",
		});
	});

	it("takes the next due date from the schedule alone: an installment due on the date is not next", () => {
		const dueOn = (asOf: string): unknown =>
			(
				sharedView(scenario(), "summary", asOf) as {
					next_installment_due: unknown;
				}
			).next_installment_due;
		expect(dueOn("2026-03-14")).toBe("2026-03-15");
		expect(dueOn("2026-03-15")).toBe("2026-04-15");
		expect(dueOn("2026-04-15")).toBeNull();
		expect(dueOn("2026-06-01")).toBeNull();
	});

	it("at statement adds the schedule rows and the agreed payments, labelled", () => {
		const view = sharedView(scenario(), "statement", AS_OF);
		expect(view).toMatchObject({
			level: "statement",
			payoff_minor: "50385",
			payments: {
				label: "recorded and counted by both parties",
				items: [
					{
						index: 1,
						value_date: "2026-02-15",
						amount_minor: "40000",
						kind: "payment",
					},
					{
						index: 2,
						value_date: "2026-02-20",
						amount_minor: "10000",
						kind: "payment",
					},
				],
			},
		});
		expect(AGREED_PAYMENTS_LABEL).toBe("recorded and counted by both parties");
		expect(view).toHaveProperty("schedule");
		expect((view as { schedule: unknown[] }).schedule.length).toBe(3);
	});

	it("lists the agreed payments only up to the date", () => {
		const view = sharedView(scenario(), "statement", "2026-02-17") as {
			payments: { items: unknown[] };
		};
		expect(view.payments.items.length).toBe(1);
	});

	it("uses exactly these keys at each level", () => {
		const keysAt = (level: GrantLevel): string[] =>
			Object.keys(sharedView(scenario(), level, AS_OF));
		expect(keysAt("summary")).toEqual([
			"note_id",
			"level",
			"as_of",
			"currency",
			"exponent",
			"status",
			"principal_minor",
			"interest_minor",
			"payoff_minor",
			"schedule_length",
			"next_installment_due",
		]);
		expect(keysAt("statement")).toEqual([
			...keysAt("summary"),
			"schedule",
			"payments",
		]);
	});

	it("shows an agreed reversal and the payment it undoes, and the balance without that payment", () => {
		const events = [
			created(),
			payment(2, "lender", "2026-02-15", "40000"),
			payment(3, "lender", "2026-02-20", "40000", {
				kind: "reversal",
				reverses: "evt-2",
			}),
			confirmed(4, "borrower", "2026-02-21T09:00:00Z", "evt-3"),
		];
		const view = sharedView(events, "statement", AS_OF) as {
			payoff_minor: string;
			payments: { items: unknown[] };
		};
		expect(view.payoff_minor).toBe("100450");
		expect(view.payments.items).toEqual([
			{
				index: 1,
				value_date: "2026-02-15",
				amount_minor: "40000",
				kind: "payment",
			},
			{
				index: 2,
				value_date: "2026-02-20",
				amount_minor: "40000",
				kind: "reversal",
			},
		]);
	});

	it("is closed once a release is confirmed, and an unanswered reversal does not reopen it", () => {
		const closed = [
			created(),
			payment(2, "lender", "2026-02-15", "40000"),
			make(3, "release.drafted", "lender", "2026-03-01T09:00:00Z", {}),
			make(4, "release.confirmed", "lender", "2026-03-01T10:00:00Z", {
				target: "evt-3",
			}),
		];
		const statusOf = (events: Fields[]): unknown =>
			(sharedView(events, "summary", "2026-03-05") as { status: unknown })
				.status;
		expect(statusOf(closed)).toBe("closed");
		const reversal = payment(5, "lender", "2026-03-02", "40000", {
			kind: "reversal",
			reverses: "evt-2",
		});
		expect(statement([...closed, reversal], "2026-03-05").state.closed).toBe(
			false,
		);
		expect(statusOf([...closed, reversal])).toBe("closed");
		const agreedReversal = confirmed(
			6,
			"borrower",
			"2026-03-03T09:00:00Z",
			"evt-5",
		);
		expect(statusOf([...closed, reversal, agreedReversal])).toBe("open");
	});

	it("does not change for notices, annotations, payoffs or approvals", () => {
		const noisy = [
			...scenario(),
			make(8, "notice.sent", "lender", "2026-03-01T10:00:00Z", {
				kind: "default",
				cure_days: 30,
			}),
			make(9, "annotation.added", "borrower", "2026-03-01T10:01:00Z", {
				text: "he is always late",
				target: "evt-6",
			}),
			make(10, "payoff.issued", "lender", "2026-03-01T10:02:00Z", {
				as_of: AS_OF,
				document_sha256: "a".repeat(64),
			}),
			make(11, "release.drafted", "lender", "2026-03-01T10:03:00Z", {}),
			make(12, "approval.requested", "lender", "2026-03-01T10:04:00Z", {
				action: "release.confirm",
				target: "evt-11",
			}),
			make(13, "approval.granted", "borrower", "2026-03-01T10:05:00Z", {
				request: "evt-12",
			}),
		];
		for (const level of LEVELS) {
			expect(sharedView(noisy, level, AS_OF)).toEqual(
				sharedView(scenario(), level, AS_OF),
			);
		}
	});

	it("matches the stream holding only the agreed facts, at every level", () => {
		for (const level of LEVELS) {
			const full = sharedView(scenario(), level, AS_OF);
			const agreed = sharedView(agreedOnly(), level, AS_OF);
			expect(full).toEqual(agreed);
		}
	});

	it("throws for an invalid stream", () => {
		expect(() =>
			sharedView(
				[payment(2, "lender", "2026-02-15", "40000")],
				"summary",
				AS_OF,
			),
		).toThrow();
	});
});

describe("the banned words", () => {
	const loaded = (): Fields[] => [
		...scenario(),
		{
			...payment(8, "lender", "2026-02-28", "100", { via: "email-link" }),
			agent_ref: "agent-7",
		},
		make(9, "notice.sent", "lender", "2026-03-01T10:00:00Z", {
			kind: "default",
			cure_days: 30,
		}),
		make(10, "annotation.added", "borrower", "2026-03-01T10:01:00Z", {
			text: "overdue and late",
			target: "evt-6",
		}),
		make(11, "party.rebound", "lender", "2026-03-01T10:02:00Z", {
			role: "borrower",
			contact_commitment: "b".repeat(64),
		}),
		make(12, "visibility.changed", "lender", "2026-03-01T10:03:00Z", {
			change: "grant.proposed",
			grant_id: "grant-name-email",
			audience: { kind: "person", ref: "someone@example.com" },
			level: "statement",
			expires_at: "2026-04-01T00:00:00Z",
		}),
	];

	for (const level of LEVELS) {
		it(`appear in no key or text of the ${level} view`, () => {
			const view = sharedView(loaded(), level, AS_OF);
			for (const word of wordsIn(view)) {
				expect(word).not.toMatch(BANNED);
			}
		});
	}

	it("keeps the dispute's reason, the counter-amount and the party text out of the serialised view", () => {
		const text = JSON.stringify(sharedView(loaded(), "statement", AS_OF));
		for (const secret of [
			"fifty",
			"5000",
			"15000",
			"20000",
			"agent-7",
			"example.com",
			"30",
		]) {
			expect(text).not.toContain(`"${secret}"`);
		}
		expect(text).not.toContain("I only paid");
		expect(text).not.toContain("someone@");
	});
});

describe("viewFor", () => {
	const PROPOSED_AT = "2026-03-01T00:00:00Z";
	const grantEvent = (
		seq: number,
		enteredBy: Role,
		grantId: string,
		audience: Fields,
		level: string,
		extra: Fields = {},
	): Fields =>
		make(seq, "visibility.changed", enteredBy, PROPOSED_AT, {
			change: "grant.proposed",
			grant_id: grantId,
			audience,
			level,
			expires_at: "2026-06-01T00:00:00Z",
			...extra,
		});
	const answer = (
		seq: number,
		enteredBy: Role,
		change: string,
		grantId: string,
	): Fields =>
		make(seq, "visibility.changed", enteredBy, PROPOSED_AT, {
			change,
			grant_id: grantId,
		});
	const ACCOUNTANT = { kind: "person", ref: "person-1" };
	const NOW = "2026-03-02T00:00:00Z";

	const viewOf = (
		events: Fields[],
		audience: { kind: "person" | "org" | "link"; ref: string },
		instant = NOW,
	): unknown => viewFor(events, grantsOf(events, instant), audience, AS_OF);

	it("is null for an audience with no grant", () => {
		expect(viewOf(scenario(), { kind: "person", ref: "person-1" })).toBeNull();
	});

	it("is null while a grant is pending", () => {
		const events = [
			...scenario(),
			grantEvent(8, "lender", "g", ACCOUNTANT, "summary"),
		];
		expect(viewOf(events, { kind: "person", ref: "person-1" })).toBeNull();
	});

	it("gives the granted level once both parties consent", () => {
		const events = [
			...scenario(),
			grantEvent(8, "lender", "g", ACCOUNTANT, "summary"),
			answer(9, "borrower", "grant.consented", "g"),
		];
		expect(viewOf(events, { kind: "person", ref: "person-1" })).toEqual(
			sharedView(scenario(), "summary", AS_OF),
		);
	});

	it("gives the highest active level when an audience holds several grants", () => {
		const events = [
			...scenario(),
			grantEvent(8, "lender", "low", ACCOUNTANT, "summary"),
			answer(9, "borrower", "grant.consented", "low"),
			grantEvent(10, "lender", "high", ACCOUNTANT, "statement"),
			answer(11, "borrower", "grant.consented", "high"),
		];
		expect(viewOf(events, { kind: "person", ref: "person-1" })).toEqual(
			sharedView(scenario(), "statement", AS_OF),
		);
	});

	it("falls back to a lower active level when the higher grant is revoked", () => {
		const events = [
			...scenario(),
			grantEvent(8, "lender", "low", ACCOUNTANT, "summary"),
			answer(9, "borrower", "grant.consented", "low"),
			grantEvent(10, "lender", "high", ACCOUNTANT, "statement"),
			answer(11, "borrower", "grant.consented", "high"),
			answer(12, "borrower", "grant.revoked", "high"),
		];
		expect(viewOf(events, { kind: "person", ref: "person-1" })).toEqual(
			sharedView(scenario(), "summary", AS_OF),
		);
	});

	it("is null once the only grant is revoked or expired", () => {
		const events = [
			...scenario(),
			grantEvent(8, "lender", "g", ACCOUNTANT, "summary"),
			answer(9, "borrower", "grant.consented", "g"),
		];
		expect(
			viewOf([...events, answer(10, "lender", "grant.revoked", "g")], {
				kind: "person",
				ref: "person-1",
			}),
		).toBeNull();
		expect(
			viewOf(
				events,
				{ kind: "person", ref: "person-1" },
				"2026-06-01T00:00:00Z",
			),
		).toBeNull();
	});

	it("matches by kind and ref together", () => {
		const events = [
			...scenario(),
			grantEvent(8, "lender", "g", ACCOUNTANT, "summary"),
			answer(9, "borrower", "grant.consented", "g"),
		];
		expect(viewOf(events, { kind: "person", ref: "person-2" })).toBeNull();
		expect(viewOf(events, { kind: "org", ref: "person-1" })).toBeNull();
		expect(viewOf(events, { kind: "link", ref: "person-1" })).toBeNull();
	});

	it("gives a link audience only verify", () => {
		const events = [
			...scenario(),
			grantEvent(8, "lender", "g", { kind: "link", ref: "link-1" }, "verify"),
			answer(9, "borrower", "grant.consented", "g"),
		];
		expect(viewOf(events, { kind: "link", ref: "link-1" })).toEqual({
			note_id: "note-vis",
			level: "verify",
		});
	});

	it("caps a link grant at verify even if a grant object names a higher level", () => {
		const events = scenario();
		const forged = [
			{
				grant_id: "g",
				audience: { kind: "link" as const, ref: "link-1" },
				level: "statement" as const,
				proposed_by: "lender" as const,
				proposed_at: PROPOSED_AT,
				expires_at: "2026-06-01T00:00:00Z",
				carve_out: false,
				consented_by: ["lender", "borrower"] as Role[],
				revoked_by: null,
				status: "active" as const,
			},
		];
		expect(
			viewFor(events, forged, { kind: "link", ref: "link-1" }, AS_OF),
		).toEqual({
			note_id: "note-vis",
			level: "verify",
		});
	});

	it("serves a carve-out on its proposer's consent alone", () => {
		const events = [
			...scenario(),
			grantEvent(8, "borrower", "g", ACCOUNTANT, "summary", {
				carve_out: true,
				purpose: "accountant",
				expires_at: "2026-05-01T00:00:00Z",
			}),
		];
		expect(viewOf(events, { kind: "person", ref: "person-1" })).toEqual(
			sharedView(scenario(), "summary", AS_OF),
		);
	});
});

// A small seeded generator (mulberry32): the same sequence on every runtime, no `Math.random`.
const UINT32_RANGE = 4_294_967_296;
const seededGenerator = (seed: number): (() => number) => {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d_2b_79_f5) >>> 0;
		let mixed = Math.imul(state ^ (state >>> 15), state | 1);
		mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
		return ((mixed ^ (mixed >>> 14)) >>> 0) / UINT32_RANGE;
	};
};

const SEED = 20_261_122;
const STREAM_COUNT = 300;
const STEPS_PER_STREAM = 14;
const PROPERTY_AS_OF = "2026-03-31";
const OTHER: Record<Role, Role> = { lender: "borrower", borrower: "lender" };

/** A view as a plain record, so a test can override one field. */
const plain = (view: SharedView): Record<string, unknown> => ({ ...view });

const recordedOf = (events: Fields[]): Fields[] =>
	events.filter((event) => event.type === "payment.recorded");

const isValid = (events: Fields[]): boolean => {
	try {
		statement(events, PROPERTY_AS_OF);
		return true;
	} catch {
		return false;
	}
};

const pick = <Item>(next: () => number, items: Item[]): Item | undefined =>
	items[Math.floor(next() * items.length)];

const dayOf = (next: () => number): string =>
	`2026-0${2 + Math.floor(next() * 2)}-${String(1 + Math.floor(next() * 28)).padStart(2, "0")}`;

const AMOUNTS = ["5000", "10000", "20000", "35000", "40000"];

/**
 * A random valid event stream. Each step tries one random event (a payment, a reversal, a confirmation, a dispute or a
 * resolution) and keeps it only when the validator accepts the stream with it.
 */
const randomStream = (next: () => number): Fields[] => {
	const events: Fields[] = [created()];
	let counter = 1;
	for (let step = 0; step < STEPS_PER_STREAM; step += 1) {
		counter += 1;
		const enteredBy: Role = next() < 0.5 ? "lender" : "borrower";
		const recorded = recordedOf(events);
		const target = pick(next, recorded);
		const stamp = `2026-02-${String(1 + (counter % 28)).padStart(2, "0")}T${String(counter % 24).padStart(2, "0")}:00:00Z`;
		const roll = next();
		let candidate: Fields | undefined;
		if (roll < 0.35 || target === undefined) {
			candidate = make(counter, "payment.recorded", enteredBy, stamp, {
				kind: "payment",
				amount_minor: pick(next, AMOUNTS),
				value_date: dayOf(next),
			});
		} else if (roll < 0.45 && target.kind === "payment") {
			candidate = make(counter, "payment.recorded", enteredBy, stamp, {
				kind: "reversal",
				amount_minor: target.amount_minor,
				value_date: target.value_date,
				reverses: target.id,
			});
		} else if (roll < 0.65) {
			candidate = make(
				counter,
				"payment.confirmed",
				OTHER[target.entered_by as Role],
				stamp,
				{ target: target.id },
			);
		} else if (roll < 0.85) {
			candidate = make(
				counter,
				"payment.disputed",
				OTHER[target.entered_by as Role],
				stamp,
				{
					target: target.id,
					counter_amount_minor: pick(next, ["0", ...AMOUNTS]),
					reason: "counted differently",
				},
			);
		} else {
			candidate = make(counter, "payment.resolved", enteredBy, stamp, {
				target: target.id,
				agreed_amount_minor: pick(next, AMOUNTS),
			});
		}
		const withCandidate = [...events, candidate];
		if (isValid(withCandidate)) {
			events.push(candidate);
		}
	}
	return events;
};

/** The stream with the named payments removed, with every event that points at a removed event, and seq renumbered. */
const withoutPayments = (events: Fields[], hidden: Set<string>): Fields[] => {
	const removed = new Set(hidden);
	let grew = true;
	while (grew) {
		grew = false;
		for (const event of events) {
			const points = [event.target, event.reverses].some(
				(reference) => typeof reference === "string" && removed.has(reference),
			);
			if (points && !removed.has(event.id as string)) {
				removed.add(event.id as string);
				grew = true;
			}
		}
	}
	return events
		.filter((event) => !removed.has(event.id as string))
		.map((event, position) => ({ ...event, seq: position + 1 }));
};

const withInserted = (
	events: Fields[],
	position: number,
	inserted: Fields,
): Fields[] => {
	const copy = [...events];
	copy.splice(position, 0, inserted);
	return copy.map((event, index) => ({ ...event, seq: index + 1 }));
};

describe("the ceiling: negative events never leave the two parties (property)", () => {
	const next = seededGenerator(SEED);
	const streams: Fields[][] = [];
	for (let index = 0; index < STREAM_COUNT; index += 1) {
		streams.push(randomStream(next));
	}

	it("generates streams that are valid and rich enough to matter", () => {
		let withHidden = 0;
		let withDispute = 0;
		for (const events of streams) {
			expect(isValid(events)).toBe(true);
			if (statement(events, PROPERTY_AS_OF).difference.length > 0) {
				withHidden += 1;
			}
			if (events.some((event) => event.type === "payment.disputed")) {
				withDispute += 1;
			}
		}
		expect(withHidden).toBeGreaterThan(STREAM_COUNT / 2);
		expect(withDispute).toBeGreaterThan(STREAM_COUNT / 5);
	});

	it("projects a stream with a disputed or unanswered payment exactly like the stream without it", () => {
		for (const events of streams) {
			const hidden = new Set(
				statement(events, PROPERTY_AS_OF).difference.map(
					(item) => item.event_id,
				),
			);
			const stripped = withoutPayments(events, hidden);
			expect(isValid(stripped)).toBe(true);
			for (const level of LEVELS) {
				expect(sharedView(events, level, PROPERTY_AS_OF)).toEqual(
					sharedView(stripped, level, PROPERTY_AS_OF),
				);
			}
			expect(agreedBalance(events, PROPERTY_AS_OF)).toEqual(
				agreedBalance(stripped, PROPERTY_AS_OF),
			);
		}
	});

	it("never changes a projection for a notice, annotation, approval, payoff or draft, wherever it falls", () => {
		const noise = (
			id: string,
			stamp: string,
			previousId: string,
		): Fields[][] => [
			[
				make(0, "notice.sent", "lender", stamp, {
					id,
					kind: "default",
					cure_days: 30,
				}),
			],
			[
				make(0, "annotation.added", "borrower", stamp, {
					id,
					text: "overdue, late, in default",
				}),
			],
			[
				make(0, "payoff.issued", "lender", stamp, {
					id,
					as_of: PROPERTY_AS_OF,
					document_sha256: "d".repeat(64),
				}),
			],
			[make(0, "release.drafted", "lender", stamp, { id })],
			[
				make(0, "approval.requested", "lender", stamp, {
					id,
					action: "notice.default",
					target: previousId,
					cure_days: 30,
				}),
				make(0, "approval.granted", "borrower", stamp, {
					id: `${id}-granted`,
					request: id,
				}),
			],
		];
		const sampler = seededGenerator(SEED + 1);
		let exercised = 0;
		for (const events of streams.slice(0, 120)) {
			const position = 1 + Math.floor(sampler() * events.length);
			const previous = events[position - 1];
			const stamp = (previous?.entered_at as string) ?? "2026-02-01T00:00:00Z";
			for (const group of noise("noise-1", stamp, previous?.id as string)) {
				let noisy = events;
				for (const [offset, event] of group.entries()) {
					noisy = withInserted(noisy, position + offset, {
						...event,
						id: event.id ?? "noise",
					});
				}
				if (!isValid(noisy)) {
					continue;
				}
				exercised += 1;
				for (const level of LEVELS) {
					expect(sharedView(noisy, level, PROPERTY_AS_OF)).toEqual(
						sharedView(events, level, PROPERTY_AS_OF),
					);
				}
			}
		}
		expect(exercised).toBeGreaterThan(500);
	});

	it("changes only the status, to closed, when a release is confirmed", () => {
		for (const events of streams.slice(0, 120)) {
			const last = events.length;
			const closed = [
				...events,
				make(last + 1, "release.drafted", "lender", "2026-04-01T09:00:00Z", {
					id: "draft-1",
				}),
				make(last + 2, "release.confirmed", "lender", "2026-04-01T10:00:00Z", {
					id: "confirm-1",
					target: "draft-1",
				}),
			];
			expect(isValid(closed)).toBe(true);
			for (const level of ["summary", "statement"] as GrantLevel[]) {
				expect(plain(sharedView(closed, level, PROPERTY_AS_OF))).toEqual({
					...plain(sharedView(events, level, PROPERTY_AS_OF)),
					status: "closed",
				});
			}
			expect(sharedView(closed, "verify", PROPERTY_AS_OF)).toEqual(
				sharedView(events, "verify", PROPERTY_AS_OF),
			);
		}
	});

	it("never lets a banned word into any projection of any generated stream", () => {
		for (const events of streams) {
			for (const level of LEVELS) {
				for (const word of wordsIn(sharedView(events, level, PROPERTY_AS_OF))) {
					expect(word).not.toMatch(BANNED);
				}
			}
		}
	});
});
