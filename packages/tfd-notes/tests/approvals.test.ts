// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "bun:test";
import {
	APPROVAL_MAX_AGE_DAYS,
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
	cureDays = 30,
): Fields =>
	make(seq, "approval.requested", agent, {
		action,
		target,
		...(action === "notice.default" ? { cure_days: cureDays } : {}),
	});
const granted = (
	seq: number,
	request: string,
	agent: string | undefined,
): Fields => make(seq, "approval.granted", agent, { request });
const defaultNotice = (
	seq: number,
	approval: string,
	agent = "alice",
): Fields =>
	make(seq, "notice.sent", agent, {
		kind: "default",
		cure_days: 30,
		approval,
	});

const NOTICE_TIME = "2026-02-20T10:00:00Z";
/** A default notice about to be appended at `NOTICE_TIME`. */
const candidateNotice = (fields: Fields = {}): Fields => ({
	type: "notice.sent",
	kind: "default",
	cure_days: 30,
	entered_at: NOTICE_TIME,
	...fields,
});

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
			name: "a default notice with its own satisfied request",
			events: [
				requested(2, "notice.default", "evt-1", "alice"),
				granted(3, "evt-2", "bob"),
			],
			candidate: candidateNotice({ approval: "evt-2" }),
			policy: BOTH,
		},
		{
			name: "a default notice exactly 30 days after its request",
			events: [
				requested(2, "notice.default", "evt-1", "alice"),
				granted(3, "evt-2", "bob"),
			],
			candidate: candidateNotice({
				approval: "evt-2",
				entered_at: "2026-03-04T10:00:00Z",
			}),
			policy: BOTH,
		},
		{
			name: "a default notice entered at the instant of its request",
			events: [
				requested(2, "notice.default", "evt-1", "alice"),
				granted(3, "evt-2", "bob"),
			],
			candidate: candidateNotice({
				approval: "evt-2",
				entered_at: "2026-02-02T10:00:00Z",
			}),
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
			name: "default notice naming no approval",
			events: [
				requested(2, "notice.default", "evt-1", "alice"),
				granted(3, "evt-2", "bob"),
			],
			candidate: candidateNotice(),
			message: "notice.sent: approval must be a non-empty string",
		},
		{
			name: "default notice naming a request that does not exist",
			events: [],
			candidate: candidateNotice({ approval: "evt-9" }),
			message:
				'notice.sent: approval "evt-9" is not an approval request for notice.default',
		},
		{
			name: "default notice naming a request for another action",
			events: [
				drafted(2),
				requested(3, "release.confirm", "evt-2", "alice"),
				granted(4, "evt-3", "bob"),
			],
			candidate: candidateNotice({ approval: "evt-3" }),
			message:
				'notice.sent: approval "evt-3" is not an approval request for notice.default',
		},
		{
			name: "default notice with an unanswered request",
			events: [requested(2, "notice.default", "evt-1", "alice")],
			candidate: candidateNotice({ approval: "evt-2" }),
			message:
				'notice.sent: approval "evt-2" has no approval from a second agent',
		},
		{
			name: "a second default notice on one approved request",
			events: [
				requested(2, "notice.default", "evt-1", "alice"),
				granted(3, "evt-2", "bob"),
				defaultNotice(4, "evt-2"),
			],
			candidate: candidateNotice({ approval: "evt-2" }),
			message:
				'notice.sent: approval "evt-2" is already used by the notice at seq 4',
		},
		{
			name: "default notice with a different cure_days than its request",
			events: [
				requested(2, "notice.default", "evt-1", "alice", 10),
				granted(3, "evt-2", "bob"),
			],
			candidate: candidateNotice({ approval: "evt-2" }),
			message: 'notice.sent: approval "evt-2" covers cure_days 10, not 30',
		},
		{
			name: "default notice with no cure_days",
			events: [
				requested(2, "notice.default", "evt-1", "alice"),
				granted(3, "evt-2", "bob"),
			],
			candidate: candidateNotice({ approval: "evt-2", cure_days: undefined }),
			message:
				'notice.sent: approval "evt-2" covers cure_days 30, not undefined',
		},
		{
			name: "default notice one second more than 30 days after its request",
			events: [
				requested(2, "notice.default", "evt-1", "alice"),
				granted(3, "evt-2", "bob"),
			],
			candidate: candidateNotice({
				approval: "evt-2",
				entered_at: "2026-03-04T10:00:01Z",
			}),
			message: "is more than 30 days older than the notice",
		},
		{
			name: "default notice entered before its request",
			events: [
				requested(2, "notice.default", "evt-1", "alice"),
				granted(3, "evt-2", "bob"),
			],
			candidate: candidateNotice({
				approval: "evt-2",
				entered_at: "2026-02-02T09:59:59Z",
			}),
			message: "was entered after the notice",
		},
		{
			name: "default notice with no entered_at",
			events: [
				requested(2, "notice.default", "evt-1", "alice"),
				granted(3, "evt-2", "bob"),
			],
			candidate: candidateNotice({ approval: "evt-2", entered_at: undefined }),
			message: "notice.sent: entered_at must be an ISO 8601 UTC instant",
		},
		{
			name: "default notice with an entered_at that is not an instant",
			events: [
				requested(2, "notice.default", "evt-1", "alice"),
				granted(3, "evt-2", "bob"),
			],
			candidate: candidateNotice({
				approval: "evt-2",
				entered_at: "2026-02-30T10:00:00Z",
			}),
			message: "notice.sent: entered_at must be an ISO 8601 UTC instant",
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

	it("lets a second default notice through on its own satisfied request", () => {
		const events = stream(
			requested(2, "notice.default", "evt-1", "alice"),
			granted(3, "evt-2", "bob"),
			defaultNotice(4, "evt-2"),
			requested(5, "notice.default", "evt-1", "alice"),
			granted(6, "evt-5", "carol"),
		);
		expect(() =>
			checkAppend(events, candidateNotice({ approval: "evt-5" }), BOTH),
		).not.toThrow();
	});

	it("does not let an approval be borrowed: each request backs one notice, whichever one", () => {
		const events = stream(
			requested(2, "notice.default", "evt-1", "alice"),
			granted(3, "evt-2", "bob"),
			requested(4, "notice.default", "evt-1", "alice"),
			granted(5, "evt-4", "carol"),
			defaultNotice(6, "evt-4"),
		);
		expect(() =>
			checkAppend(events, candidateNotice({ approval: "evt-4" }), BOTH),
		).toThrow("already used");
		expect(() =>
			checkAppend(events, candidateNotice({ approval: "evt-2" }), BOTH),
		).not.toThrow();
	});

	it("lets a reminder leave an approval unused, and ages an old request out", () => {
		const events = stream(
			requested(2, "notice.default", "evt-1", "alice"),
			granted(3, "evt-2", "bob"),
			make(4, "notice.sent", "alice", { kind: "reminder" }),
		);
		expect(() =>
			checkAppend(events, candidateNotice({ approval: "evt-2" }), BOTH),
		).not.toThrow();
		expect(() =>
			checkAppend(
				events,
				candidateNotice({
					approval: "evt-2",
					entered_at: "2026-04-01T00:00:00Z",
				}),
				BOTH,
			),
		).toThrow("days older");
	});

	it("exports the age limit as 30 days", () => {
		expect(APPROVAL_MAX_AGE_DAYS).toBe(30);
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

describe("active agents", () => {
	const ACTIVE = new Set(["alice", "bob", "carol"]);
	const withActive = (
		activeAgents: ReadonlySet<string>,
		policy: ApprovalPolicy = BOTH,
	): ApprovalPolicy => ({ ...policy, activeAgents });
	const release = { action: "release.confirm", target: "evt-2" } as const;
	const approved = (approver: string, requester = "alice"): NoteEvent[] =>
		stream(
			drafted(2),
			requested(3, "release.confirm", "evt-2", requester),
			granted(4, "evt-3", approver),
		);

	it("counts every agent when the set is absent", () => {
		expect(approvalStatus(approved("bob"), release).satisfied).toBe(true);
		expect(approvalStatus(approved("bob"), release, {}).satisfied).toBe(true);
	});

	it("counts an approval by an agent in the set", () => {
		const status = approvalStatus(approved("bob"), release, {
			activeAgents: ACTIVE,
		});
		expect(status.satisfied).toBe(true);
		expect(status.granted_by).toEqual(["bob"]);
	});

	it("no longer counts the approval of a deactivated approver", () => {
		const status = approvalStatus(approved("bob"), release, {
			activeAgents: new Set(["alice", "carol"]),
		});
		expect(status.satisfied).toBe(false);
		expect(status.granted_by).toEqual([]);
		expect(status.requested).toBe(true);
	});

	it("keeps the approvals of agents who are still active", () => {
		const events = stream(
			drafted(2),
			requested(3, "release.confirm", "evt-2", "alice"),
			granted(4, "evt-3", "bob"),
			granted(5, "evt-3", "carol"),
		);
		const status = approvalStatus(events, release, {
			activeAgents: new Set(["alice", "carol"]),
		});
		expect(status.granted_by).toEqual(["carol"]);
		expect(status.satisfied).toBe(true);
	});

	it("does not satisfy a request whose requester has been deactivated", () => {
		const status = approvalStatus(approved("bob"), release, {
			activeAgents: new Set(["bob", "carol"]),
		});
		expect(status.satisfied).toBe(false);
		expect(status.requester_agent).toBe("alice");
	});

	it("makes checkAppend refuse a release approved only by a deactivated agent", () => {
		const candidate = { type: "release.confirmed", target: "evt-2" };
		expect(() =>
			checkAppend(approved("bob"), candidate, withActive(ACTIVE)),
		).not.toThrow();
		expect(() =>
			checkAppend(
				approved("bob"),
				candidate,
				withActive(new Set(["alice", "carol"])),
			),
		).toThrow("has no approval from a second agent");
	});

	it("makes checkAppend refuse a default notice backed only by a deactivated agent", () => {
		const events = stream(
			requested(2, "notice.default", "evt-1", "alice"),
			granted(3, "evt-2", "bob"),
		);
		const candidate = candidateNotice({ approval: "evt-2" });
		expect(() =>
			checkAppend(events, candidate, withActive(ACTIVE)),
		).not.toThrow();
		expect(() =>
			checkAppend(events, candidate, withActive(new Set(["alice"]))),
		).toThrow("has no approval from a second agent");
	});

	it("refuses a new grant from an agent outside the set, and allows it without a set", () => {
		const events = stream(
			drafted(2),
			requested(3, "release.confirm", "evt-2", "alice"),
		);
		const candidate = {
			type: "approval.granted",
			request: "evt-3",
			agent_ref: "bob",
		};
		expect(() => checkAppend(events, candidate, BOTH)).not.toThrow();
		expect(() =>
			checkAppend(events, candidate, withActive(new Set(["alice", "carol"]))),
		).toThrow('approval.granted: agent "bob" is not an active agent');
	});

	it("keeps a request pending when its only approver was deactivated", () => {
		const events = approved("bob");
		expect(pendingApprovals(events, BOTH)).toEqual([]);
		expect(
			pendingApprovals(events, withActive(new Set(["alice"]))).map(
				(entry) => entry.target,
			),
		).toEqual(["evt-2"]);
		expect(pendingApprovals(events, withActive(ACTIVE))).toEqual([]);
	});
});
