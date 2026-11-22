// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "bun:test";
import {
	type ApprovalPolicy,
	approvalStatus,
	checkAppend,
	pendingApprovals,
} from "../src/approvals";
import { validateStream } from "../src/events";
import type { ApprovalAction, NoteEvent } from "../src/types";

type Fields = Record<string, unknown>;

const TERMS: Fields = {
	currency: "USD",
	exponent: 2,
	principal_minor: "100000",
	issue_date: "2026-01-01",
	annual_rate: "0",
	day_count: "actual/365",
	rounding: "half-up",
	timezone: "America/Denver",
	schedule: { type: "none" },
};

const make = (
	seq: number,
	type: string,
	agent: string | undefined,
	fields: Fields = {},
): Fields => ({
	schema: "tfd.note-event.v1",
	id: `evt-${seq}`,
	note_id: "note-1",
	seq,
	// One day per seq, so "oldest first" can be told from insertion order.
	entered_at: `2026-02-${String(seq).padStart(2, "0")}T10:00:00Z`,
	entered_by: "lender",
	type,
	...(agent === undefined ? {} : { agent_ref: agent }),
	...fields,
});

const created = (): Fields =>
	make(1, "note.created", undefined, { terms: TERMS });
const drafted = (seq: number, agent = "alice"): Fields =>
	make(seq, "release.drafted", agent);
const requested = (
	seq: number,
	action: ApprovalAction,
	target: string,
	agent: string | undefined,
): Fields => make(seq, "approval.requested", agent, { action, target });
const granted = (
	seq: number,
	request: string,
	agent: string | undefined,
): Fields => make(seq, "approval.granted", agent, { request });
const defaultNotice = (seq: number, agent = "alice"): Fields =>
	make(seq, "notice.sent", agent, { kind: "default", cure_days: 30 });

const stream = (...events: Fields[]): NoteEvent[] =>
	validateStream([created(), ...events]);

const BOTH: ApprovalPolicy = {
	twoPerson: new Set<ApprovalAction>(["release.confirm", "notice.default"]),
};
const NONE: ApprovalPolicy = { twoPerson: new Set<ApprovalAction>() };

describe("approvalStatus", () => {
	const release = { action: "release.confirm", target: "evt-2" } as const;

	const cases: {
		name: string;
		events: Fields[];
		expected: ReturnType<typeof approvalStatus>;
	}[] = [
		{
			name: "no request",
			events: [drafted(2)],
			expected: {
				requested: false,
				requester_agent: null,
				granted_by: [],
				satisfied: false,
			},
		},
		{
			name: "requested, not yet granted",
			events: [drafted(2), requested(3, "release.confirm", "evt-2", "alice")],
			expected: {
				requested: true,
				requester_agent: "alice",
				granted_by: [],
				satisfied: false,
			},
		},
		{
			name: "an agent approving their own request counts for nothing",
			events: [
				drafted(2),
				requested(3, "release.confirm", "evt-2", "alice"),
				granted(4, "evt-3", "alice"),
			],
			expected: {
				requested: true,
				requester_agent: "alice",
				granted_by: [],
				satisfied: false,
			},
		},
		{
			name: "a grant with no agent_ref counts for nothing",
			events: [
				drafted(2),
				requested(3, "release.confirm", "evt-2", "alice"),
				granted(4, "evt-3", undefined),
			],
			expected: {
				requested: true,
				requester_agent: "alice",
				granted_by: [],
				satisfied: false,
			},
		},
		{
			name: "a second agent satisfies it",
			events: [
				drafted(2),
				requested(3, "release.confirm", "evt-2", "alice"),
				granted(4, "evt-3", "bob"),
			],
			expected: {
				requested: true,
				requester_agent: "alice",
				granted_by: ["bob"],
				satisfied: true,
			},
		},
		{
			name: "two approvers are listed once each, in grant order",
			events: [
				drafted(2),
				requested(3, "release.confirm", "evt-2", "alice"),
				granted(4, "evt-3", "carol"),
				granted(5, "evt-3", "bob"),
				granted(6, "evt-3", "carol"),
			],
			expected: {
				requested: true,
				requester_agent: "alice",
				granted_by: ["carol", "bob"],
				satisfied: true,
			},
		},
		{
			name: "a request with no agent_ref cannot be satisfied",
			events: [
				drafted(2),
				requested(3, "release.confirm", "evt-2", undefined),
				granted(4, "evt-3", "bob"),
			],
			expected: {
				requested: true,
				requester_agent: null,
				granted_by: [],
				satisfied: false,
			},
		},
		{
			name: "a grant for another request does not count",
			events: [
				drafted(2),
				requested(3, "release.confirm", "evt-2", "alice"),
				requested(4, "notice.default", "evt-1", "alice"),
				granted(5, "evt-4", "bob"),
			],
			expected: {
				requested: true,
				requester_agent: "alice",
				granted_by: [],
				satisfied: false,
			},
		},
	];

	for (const { name, events, expected } of cases) {
		it(name, () => {
			expect(approvalStatus(stream(...events), release)).toEqual(expected);
		});
	}
});

describe("checkAppend", () => {
	const approvedRelease = [
		drafted(2),
		requested(3, "release.confirm", "evt-2", "alice"),
		granted(4, "evt-3", "bob"),
	];
	const confirmRelease = { type: "release.confirmed", target: "evt-2" };

	const passes: {
		name: string;
		events: Fields[];
		candidate: unknown;
		policy: ApprovalPolicy;
	}[] = [
		{
			name: "release with a satisfied request",
			events: approvedRelease,
			candidate: confirmRelease,
			policy: BOTH,
		},
		{
			name: "release with no request when the policy lacks release.confirm",
			events: [drafted(2)],
			candidate: confirmRelease,
			policy: NONE,
		},
		{
			name: "release when the policy names only notice.default",
			events: [drafted(2)],
			candidate: confirmRelease,
			policy: { twoPerson: new Set<ApprovalAction>(["notice.default"]) },
		},
		{
			name: "a default notice with one satisfied request",
			events: [
				requested(2, "notice.default", "evt-1", "alice"),
				granted(3, "evt-2", "bob"),
			],
			candidate: { type: "notice.sent", kind: "default", cure_days: 30 },
			policy: BOTH,
		},
		{
			name: "a default notice with no request when the policy lacks notice.default",
			events: [],
			candidate: { type: "notice.sent", kind: "default", cure_days: 30 },
			policy: NONE,
		},
		{
			name: "a reminder notice needs no approval",
			events: [],
			candidate: { type: "notice.sent", kind: "reminder" },
			policy: BOTH,
		},
		{
			name: "a grant by a second agent",
			events: [drafted(2), requested(3, "release.confirm", "evt-2", "alice")],
			candidate: {
				type: "approval.granted",
				request: "evt-3",
				agent_ref: "bob",
			},
			policy: NONE,
		},
		{
			name: "a grant by a third agent after one grant",
			events: [...approvedRelease],
			candidate: {
				type: "approval.granted",
				request: "evt-3",
				agent_ref: "carol",
			},
			policy: BOTH,
		},
		{
			name: "an event the rules do not cover, with unknown fields",
			events: [],
			candidate: {
				type: "payment.recorded",
				agent_ref: "alice",
				whatever: { nested: [1, 2, 3] },
			},
			policy: BOTH,
		},
		{
			name: "an object with no type",
			events: [],
			candidate: { unknown: true },
			policy: BOTH,
		},
		{
			name: "a release candidate with extra unknown fields and a satisfied request",
			events: approvedRelease,
			candidate: { ...confirmRelease, color: "red", seq: "not a number" },
			policy: BOTH,
		},
	];

	for (const { name, events, candidate, policy } of passes) {
		it(`passes: ${name}`, () => {
			expect(() =>
				checkAppend(stream(...events), candidate, policy),
			).not.toThrow();
		});
	}

	const refusals: {
		name: string;
		events: Fields[];
		candidate: unknown;
		message: string;
	}[] = [
		{
			name: "release with no request",
			events: [drafted(2)],
			candidate: confirmRelease,
			message:
				'release.confirmed: draft "evt-2" has no approval request (action release.confirm)',
		},
		{
			name: "release with an unanswered request",
			events: [drafted(2), requested(3, "release.confirm", "evt-2", "alice")],
			candidate: confirmRelease,
			message:
				'release.confirmed: the approval request for draft "evt-2" has no approval from a second agent',
		},
		{
			name: "release whose only grant is the requester's own",
			events: [
				drafted(2),
				requested(3, "release.confirm", "evt-2", "alice"),
				granted(4, "evt-3", "alice"),
			],
			candidate: confirmRelease,
			message:
				'release.confirmed: the approval request for draft "evt-2" has no approval from a second agent',
		},
		{
			name: "release whose grant carries no agent_ref",
			events: [
				drafted(2),
				requested(3, "release.confirm", "evt-2", "alice"),
				granted(4, "evt-3", undefined),
			],
			candidate: confirmRelease,
			message:
				'release.confirmed: the approval request for draft "evt-2" has no approval from a second agent',
		},
		{
			name: "release whose request names no agent",
			events: [
				drafted(2),
				requested(3, "release.confirm", "evt-2", undefined),
				granted(4, "evt-3", "bob"),
			],
			candidate: confirmRelease,
			message:
				'release.confirmed: the approval request for draft "evt-2" has no approval from a second agent',
		},
		{
			name: "release for a different draft than the approved one",
			events: [...approvedRelease, drafted(5)],
			candidate: { type: "release.confirmed", target: "evt-5" },
			message:
				'release.confirmed: draft "evt-5" has no approval request (action release.confirm)',
		},
		{
			name: "release with no target",
			events: [drafted(2)],
			candidate: { type: "release.confirmed" },
			message: "release.confirmed: target must be a non-empty string",
		},
		{
			name: "default notice with no request",
			events: [],
			candidate: { type: "notice.sent", kind: "default", cure_days: 30 },
			message:
				"notice.sent: a default notice needs its own approved request (action notice.default); 0 approved, 0 already sent",
		},
		{
			name: "default notice with an unanswered request",
			events: [requested(2, "notice.default", "evt-1", "alice")],
			candidate: { type: "notice.sent", kind: "default", cure_days: 30 },
			message:
				"notice.sent: a default notice needs its own approved request (action notice.default); 0 approved, 0 already sent",
		},
		{
			name: "a second default notice on one approved request",
			events: [
				requested(2, "notice.default", "evt-1", "alice"),
				granted(3, "evt-2", "bob"),
				defaultNotice(4),
			],
			candidate: { type: "notice.sent", kind: "default", cure_days: 30 },
			message:
				"notice.sent: a default notice needs its own approved request (action notice.default); 1 approved, 1 already sent",
		},
		{
			name: "a grant that names no existing request",
			events: [],
			candidate: {
				type: "approval.granted",
				request: "evt-9",
				agent_ref: "bob",
			},
			message: 'approval.granted: request "evt-9" does not exist',
		},
		{
			name: "a grant naming an event that is not a request",
			events: [drafted(2)],
			candidate: {
				type: "approval.granted",
				request: "evt-2",
				agent_ref: "bob",
			},
			message: 'approval.granted: request "evt-2" does not exist',
		},
		{
			name: "an agent approving their own request",
			events: [drafted(2), requested(3, "release.confirm", "evt-2", "alice")],
			candidate: {
				type: "approval.granted",
				request: "evt-3",
				agent_ref: "alice",
			},
			message: "approval.granted: an agent cannot approve their own request",
		},
		{
			name: "an agent approving twice",
			events: [...approvedRelease],
			candidate: {
				type: "approval.granted",
				request: "evt-3",
				agent_ref: "bob",
			},
			message: 'approval.granted: agent "bob" already approved request "evt-3"',
		},
		{
			name: "a grant with no agent_ref",
			events: [drafted(2), requested(3, "release.confirm", "evt-2", "alice")],
			candidate: { type: "approval.granted", request: "evt-3" },
			message: "approval.granted: agent_ref must be a non-empty string",
		},
		{
			name: "a grant of a request that names no agent",
			events: [drafted(2), requested(3, "release.confirm", "evt-2", undefined)],
			candidate: {
				type: "approval.granted",
				request: "evt-3",
				agent_ref: "bob",
			},
			message:
				'approval.granted: request "evt-3" names no agent_ref, so it cannot be approved',
		},
		{
			name: "a candidate that is not an object",
			events: [],
			candidate: "release.confirmed",
			message: "candidate must be an object",
		},
	];

	for (const { name, events, candidate, message } of refusals) {
		it(`refuses: ${name}`, () => {
			expect(() => checkAppend(stream(...events), candidate, BOTH)).toThrow(
				message,
			);
		});
	}

	it("lets a second default notice through once a second request is satisfied", () => {
		const events = stream(
			requested(2, "notice.default", "evt-1", "alice"),
			granted(3, "evt-2", "bob"),
			defaultNotice(4),
			requested(5, "notice.default", "evt-1", "alice"),
			granted(6, "evt-5", "carol"),
		);
		expect(() =>
			checkAppend(
				events,
				{ type: "notice.sent", kind: "default", cure_days: 30 },
				BOTH,
			),
		).not.toThrow();
	});

	it("never mutates the events, the candidate or the policy", () => {
		const events = stream(...approvedRelease);
		const candidate = { ...confirmRelease, extra: { a: 1 } };
		const before = JSON.stringify([events, candidate, [...BOTH.twoPerson]]);
		checkAppend(events, candidate, BOTH);
		expect(JSON.stringify([events, candidate, [...BOTH.twoPerson]])).toBe(
			before,
		);
	});
});

describe("pendingApprovals", () => {
	it("lists unsatisfied requests of two-person actions, oldest first", () => {
		const events = stream(
			drafted(2),
			requested(3, "release.confirm", "evt-2", "alice"),
			requested(4, "notice.default", "evt-1", undefined),
			requested(5, "waiver", "evt-1", "carol"),
			requested(6, "notice.default", "evt-2", "dave"),
			granted(7, "evt-6", "erin"),
		);
		expect(pendingApprovals(events, BOTH)).toEqual([
			{
				action: "release.confirm",
				target: "evt-2",
				requested_by_agent: "alice",
				requested_at: "2026-02-03T10:00:00Z",
			},
			{
				action: "notice.default",
				target: "evt-1",
				requested_by_agent: null,
				requested_at: "2026-02-04T10:00:00Z",
			},
		]);
	});

	it("is empty when the policy names no action", () => {
		const events = stream(
			drafted(2),
			requested(3, "release.confirm", "evt-2", "alice"),
		);
		expect(pendingApprovals(events, NONE)).toEqual([]);
	});

	it("includes a waiver when the policy names it", () => {
		const events = stream(requested(2, "waiver", "evt-1", "alice"));
		const policy: ApprovalPolicy = {
			twoPerson: new Set<ApprovalAction>(["waiver"]),
		};
		expect(
			pendingApprovals(events, policy).map((entry) => entry.action),
		).toEqual(["waiver"]);
	});
});
