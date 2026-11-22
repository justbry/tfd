// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "bun:test";
import {
	activeGrants,
	disclosureLog,
	type Grant,
	type GrantStatus,
	grantsOf,
	REVOKE_NOTICE,
} from "../src/grants";
import type { Role } from "../src/types";

type Fields = Record<string, unknown>;

const TERMS: Fields = {
	currency: "USD",
	exponent: 2,
	principal_minor: "100000",
	issue_date: "2026-01-15",
	annual_rate: "0",
	day_count: "actual/365",
	rounding: "half-up",
	timezone: "America/Denver",
	schedule: { type: "none" },
};

const EXPIRES = "2026-03-01T00:00:00Z";
const BEFORE_EXPIRY = "2026-02-28T23:59:59Z";
const DURING = "2026-02-10T00:00:00Z";

const pad = (value: number): string => String(value).padStart(2, "0");

/** Events are entered a minute apart on 2026-02-01, so `seq` orders them in time as well. */
const make = (
	seq: number,
	type: string,
	enteredBy: Role,
	fields: Fields,
): Fields => ({
	schema: "tfd.note-event.v1",
	id: `evt-${seq}`,
	note_id: "note-grants",
	seq,
	entered_at: `2026-02-01T00:${pad(seq)}:00Z`,
	entered_by: enteredBy,
	type,
	...fields,
});

const created = (): Fields =>
	make(1, "note.created", "lender", { terms: TERMS });

const propose = (
	seq: number,
	enteredBy: Role,
	grantId: string,
	fields: Fields = {},
): Fields =>
	make(seq, "visibility.changed", enteredBy, {
		change: "grant.proposed",
		grant_id: grantId,
		audience: { kind: "person", ref: "person-1" },
		level: "statement",
		expires_at: EXPIRES,
		...fields,
	});

const consent = (seq: number, enteredBy: Role, grantId: string): Fields =>
	make(seq, "visibility.changed", enteredBy, {
		change: "grant.consented",
		grant_id: grantId,
	});

const revoke = (seq: number, enteredBy: Role, grantId: string): Fields =>
	make(seq, "visibility.changed", enteredBy, {
		change: "grant.revoked",
		grant_id: grantId,
	});

const carveOut = (fields: Fields = {}): Fields => ({
	carve_out: true,
	purpose: "accountant",
	level: "summary",
	...fields,
});

interface FoldCase {
	name: string;
	steps: Fields[];
	status: GrantStatus;
	consentedBy: Role[];
	revokedBy: Role | null;
}

const foldCases: FoldCase[] = [
	{
		name: "a proposal alone is pending, with the proposer's consent counted",
		steps: [propose(2, "lender", "g")],
		status: "pending",
		consentedBy: ["lender"],
		revokedBy: null,
	},
	{
		name: "the other party's consent makes it active (lender proposes)",
		steps: [propose(2, "lender", "g"), consent(3, "borrower", "g")],
		status: "active",
		consentedBy: ["lender", "borrower"],
		revokedBy: null,
	},
	{
		name: "the other party's consent makes it active (borrower proposes)",
		steps: [propose(2, "borrower", "g"), consent(3, "lender", "g")],
		status: "active",
		consentedBy: ["borrower", "lender"],
		revokedBy: null,
	},
	{
		name: "the proposer consenting again changes nothing",
		steps: [propose(2, "lender", "g"), consent(3, "lender", "g")],
		status: "pending",
		consentedBy: ["lender"],
		revokedBy: null,
	},
	{
		name: "a second consent by the other party changes nothing further",
		steps: [
			propose(2, "lender", "g"),
			consent(3, "borrower", "g"),
			consent(4, "borrower", "g"),
		],
		status: "active",
		consentedBy: ["lender", "borrower"],
		revokedBy: null,
	},
	{
		name: "the proposer may revoke a pending grant",
		steps: [propose(2, "lender", "g"), revoke(3, "lender", "g")],
		status: "revoked",
		consentedBy: ["lender"],
		revokedBy: "lender",
	},
	{
		name: "the other party may revoke a pending grant without consenting first",
		steps: [propose(2, "lender", "g"), revoke(3, "borrower", "g")],
		status: "revoked",
		consentedBy: ["lender"],
		revokedBy: "borrower",
	},
	{
		name: "the lender may revoke an active grant",
		steps: [
			propose(2, "lender", "g"),
			consent(3, "borrower", "g"),
			revoke(4, "lender", "g"),
		],
		status: "revoked",
		consentedBy: ["lender", "borrower"],
		revokedBy: "lender",
	},
	{
		name: "the borrower may revoke an active grant",
		steps: [
			propose(2, "lender", "g"),
			consent(3, "borrower", "g"),
			revoke(4, "borrower", "g"),
		],
		status: "revoked",
		consentedBy: ["lender", "borrower"],
		revokedBy: "borrower",
	},
	{
		name: "consent after revocation changes nothing",
		steps: [
			propose(2, "lender", "g"),
			revoke(3, "lender", "g"),
			consent(4, "borrower", "g"),
		],
		status: "revoked",
		consentedBy: ["lender"],
		revokedBy: "lender",
	},
	{
		name: "the first revocation stands when the other party revokes too",
		steps: [
			propose(2, "lender", "g"),
			revoke(3, "borrower", "g"),
			revoke(4, "lender", "g"),
		],
		status: "revoked",
		consentedBy: ["lender"],
		revokedBy: "borrower",
	},
	{
		name: "a carve-out is active on its proposer's consent alone (lender)",
		steps: [propose(2, "lender", "g", carveOut())],
		status: "active",
		consentedBy: ["lender"],
		revokedBy: null,
	},
	{
		name: "a carve-out is active on its proposer's consent alone (borrower)",
		steps: [propose(2, "borrower", "g", carveOut({ purpose: "lawyer" }))],
		status: "active",
		consentedBy: ["borrower"],
		revokedBy: null,
	},
	{
		name: "the counterparty may revoke a carve-out",
		steps: [propose(2, "lender", "g", carveOut()), revoke(3, "borrower", "g")],
		status: "revoked",
		consentedBy: ["lender"],
		revokedBy: "borrower",
	},
	{
		name: "a carve-out the counterparty consented to stays active",
		steps: [propose(2, "lender", "g", carveOut()), consent(3, "borrower", "g")],
		status: "active",
		consentedBy: ["lender", "borrower"],
		revokedBy: null,
	},
];

const only = (grants: Grant[]): Grant => {
	const [grant] = grants;
	if (grant === undefined || grants.length !== 1) {
		throw new Error(`Expected exactly one grant, got ${grants.length}`);
	}
	return grant;
};

describe("grantsOf", () => {
	for (const entry of foldCases) {
		it(entry.name, () => {
			const grant = only(grantsOf([created(), ...entry.steps], DURING));
			expect(grant.status).toBe(entry.status);
			expect(grant.consented_by).toEqual(entry.consentedBy);
			expect(grant.revoked_by).toBe(entry.revokedBy);
		});
	}

	it("carries the proposal's fields onto the grant", () => {
		const grant = only(
			grantsOf(
				[
					created(),
					propose(2, "borrower", "g", {
						audience: { kind: "org", ref: "org-9" },
						level: "summary",
					}),
				],
				DURING,
			),
		);
		expect(grant).toEqual({
			grant_id: "g",
			audience: { kind: "org", ref: "org-9" },
			level: "summary",
			proposed_by: "borrower",
			proposed_at: "2026-02-01T00:02:00Z",
			expires_at: EXPIRES,
			carve_out: false,
			consented_by: ["borrower"],
			revoked_by: null,
			status: "pending",
		});
	});

	it("carries a carve-out's purpose", () => {
		const grant = only(
			grantsOf(
				[created(), propose(2, "lender", "g", carveOut({ purpose: "court" }))],
				DURING,
			),
		);
		expect(grant.carve_out).toBe(true);
		expect(grant.purpose).toBe("court");
	});

	it("lists grants in the order they were proposed and keeps them independent", () => {
		const events = [
			created(),
			propose(2, "lender", "first"),
			propose(3, "borrower", "second"),
			consent(4, "lender", "second"),
			revoke(5, "borrower", "first"),
		];
		const grants = grantsOf(events, DURING);
		expect(grants.map((grant) => [grant.grant_id, grant.status])).toEqual([
			["first", "revoked"],
			["second", "active"],
		]);
	});

	it("returns no grants for a stream without visibility events", () => {
		expect(grantsOf([created()], DURING)).toEqual([]);
	});

	it("ignores events entered after the instant", () => {
		const events = [
			created(),
			propose(2, "lender", "g"),
			consent(3, "borrower", "g"),
			revoke(4, "lender", "g"),
		];
		const statusAt = (instant: string): GrantStatus | undefined =>
			grantsOf(events, instant)[0]?.status;
		expect(statusAt("2026-02-01T00:01:59Z")).toBeUndefined();
		expect(statusAt("2026-02-01T00:02:00Z")).toBe("pending");
		expect(statusAt("2026-02-01T00:03:00Z")).toBe("active");
		expect(statusAt("2026-02-01T00:04:00Z")).toBe("revoked");
	});

	it("rejects an invalid stream", () => {
		expect(() => grantsOf([consent(2, "lender", "nope")], DURING)).toThrow();
		expect(() =>
			grantsOf([created(), consent(2, "lender", "nope")], DURING),
		).toThrow("does not match an earlier grant.proposed");
	});
});

describe("expiry", () => {
	const events = [
		created(),
		propose(2, "lender", "g"),
		consent(3, "borrower", "g"),
	];
	const statusAt = (instant: string): GrantStatus | undefined =>
		grantsOf(events, instant)[0]?.status;

	it("is active one second before expires_at", () => {
		expect(statusAt(BEFORE_EXPIRY)).toBe("active");
	});

	it("is expired exactly at expires_at", () => {
		expect(statusAt(EXPIRES)).toBe("expired");
	});

	it("is expired after expires_at", () => {
		expect(statusAt("2026-03-01T00:00:01Z")).toBe("expired");
		expect(statusAt("2027-01-01T00:00:00Z")).toBe("expired");
	});

	it("compares fractional seconds as numbers", () => {
		expect(statusAt("2026-02-28T23:59:59.999Z")).toBe("active");
		expect(statusAt("2026-03-01T00:00:00.000Z")).toBe("expired");
	});

	it("expires a pending grant that nobody answered", () => {
		expect(
			grantsOf([created(), propose(2, "lender", "g")], EXPIRES)[0]?.status,
		).toBe("expired");
	});

	it("expires a carve-out too", () => {
		expect(
			grantsOf([created(), propose(2, "lender", "g", carveOut())], EXPIRES)[0]
				?.status,
		).toBe("expired");
	});

	it("lets revoked win over expired", () => {
		const revoked = [...events, revoke(4, "lender", "g")];
		expect(grantsOf(revoked, "2026-04-01T00:00:00Z")[0]?.status).toBe(
			"revoked",
		);
	});
});

describe("activeGrants", () => {
	it("keeps only grants that may be read now", () => {
		const events = [
			created(),
			propose(2, "lender", "pending"),
			propose(3, "lender", "agreed"),
			consent(4, "borrower", "agreed"),
			propose(5, "lender", "revoked"),
			consent(6, "borrower", "revoked"),
			revoke(7, "borrower", "revoked"),
			propose(8, "borrower", "disclosed", carveOut()),
		];
		expect(activeGrants(events, DURING).map((grant) => grant.grant_id)).toEqual(
			["agreed", "disclosed"],
		);
		expect(activeGrants(events, EXPIRES)).toEqual([]);
	});
});

describe("disclosureLog", () => {
	const events = [
		created(),
		propose(2, "lender", "normal"),
		consent(3, "borrower", "normal"),
		propose(4, "lender", "books", carveOut({ purpose: "accountant" })),
		propose(
			5,
			"borrower",
			"counsel",
			carveOut({ purpose: "lawyer", level: "statement" }),
		),
		revoke(6, "lender", "counsel"),
		propose(7, "lender", "bank", carveOut({ purpose: "assignee" })),
	];

	it("lists every carve-out and no other grant, whatever its status", () => {
		const log = disclosureLog(events, DURING);
		expect(log).toEqual([
			{
				grant_id: "books",
				purpose: "accountant",
				audience_kind: "person",
				proposed_by: "lender",
				proposed_at: "2026-02-01T00:04:00Z",
				expires_at: EXPIRES,
				status: "active",
			},
			{
				grant_id: "counsel",
				purpose: "lawyer",
				audience_kind: "person",
				proposed_by: "borrower",
				proposed_at: "2026-02-01T00:05:00Z",
				expires_at: EXPIRES,
				status: "revoked",
			},
			{
				grant_id: "bank",
				purpose: "assignee",
				audience_kind: "person",
				proposed_by: "lender",
				proposed_at: "2026-02-01T00:07:00Z",
				expires_at: EXPIRES,
				status: "active",
			},
		]);
	});

	it("keeps an expired carve-out on the log", () => {
		expect(disclosureLog(events, EXPIRES).map((entry) => entry.status)).toEqual(
			["expired", "revoked", "expired"],
		);
	});

	it("is the same for both parties: it takes no role and carries no audience reference", () => {
		for (const entry of disclosureLog(events, DURING)) {
			expect(Object.keys(entry)).toEqual([
				"grant_id",
				"purpose",
				"audience_kind",
				"proposed_by",
				"proposed_at",
				"expires_at",
				"status",
			]);
		}
	});

	it("is empty when there is no carve-out", () => {
		expect(
			disclosureLog([created(), propose(2, "lender", "normal")], DURING),
		).toEqual([]);
	});
});

describe("the grant rules the event validator enforces", () => {
	it("refuses a link grant above verify", () => {
		expect(() =>
			grantsOf(
				[
					created(),
					propose(2, "lender", "g", {
						audience: { kind: "link", ref: "l" },
						level: "summary",
					}),
				],
				DURING,
			),
		).toThrow('a link audience may only have level "verify"');
	});

	it("accepts a link grant at verify, which needs both parties like any other", () => {
		const grant = only(
			grantsOf(
				[
					created(),
					propose(2, "lender", "g", {
						audience: { kind: "link", ref: "l" },
						level: "verify",
					}),
				],
				DURING,
			),
		);
		expect(grant.status).toBe("pending");
	});

	it("refuses a proposal without an expiry", () => {
		const { expires_at: _removed, ...noExpiry } = propose(2, "lender", "g");
		expect(() => grantsOf([created(), noExpiry], DURING)).toThrow(
			"expires_at is required",
		);
	});

	it("refuses an expiry more than 365 days out", () => {
		expect(() =>
			grantsOf(
				[
					created(),
					propose(2, "lender", "g", { expires_at: "2027-02-02T00:00:00Z" }),
				],
				DURING,
			),
		).toThrow("more than 365 days");
	});

	it("refuses a carve-out to an org, above statement level or without a purpose", () => {
		const bad: Fields[] = [
			carveOut({ audience: { kind: "org", ref: "o" } }),
			carveOut({ level: "verify" }),
			{ carve_out: true },
		];
		for (const fields of bad) {
			expect(() =>
				grantsOf([created(), propose(2, "lender", "g", fields)], DURING),
			).toThrow();
		}
	});
});

describe("REVOKE_NOTICE", () => {
	it("says exactly what revoking does and does not do", () => {
		expect(REVOKE_NOTICE).toBe(
			"Revoking stops later reads. It cannot take back what the person already saw.",
		);
	});
});

describe("carve-out limits reach the fold", () => {
	it("refuses a carve-out for the purpose other, to an org, above statement level or beyond 90 days", () => {
		const bad: Fields[] = [
			carveOut({ purpose: "other" }),
			carveOut({ audience: { kind: "org", ref: "org-1" } }),
			carveOut({ level: "verify" }),
			// 2026-02-01T00:01:00Z plus 91 days.
			carveOut({ expires_at: "2026-05-03T00:01:00Z" }),
		];
		for (const fields of bad) {
			expect(() =>
				grantsOf([created(), propose(2, "lender", "g", fields)], DURING),
			).toThrow();
		}
	});

	it("takes a carve-out at exactly 90 days and a plain grant for a year", () => {
		const ninety = grantsOf(
			[
				created(),
				propose(
					2,
					"lender",
					"g",
					carveOut({ expires_at: "2026-05-02T00:02:00Z" }),
				),
			],
			DURING,
		);
		expect(ninety[0]?.status).toBe("active");
		const year = grantsOf(
			[
				created(),
				propose(2, "lender", "g", { expires_at: "2027-02-01T00:02:00Z" }),
			],
			DURING,
		);
		expect(year[0]?.status).toBe("pending");
	});
});
