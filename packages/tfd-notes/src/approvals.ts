// SPDX-License-Identifier: Apache-2.0
/**
 * Two-person approval for an organization party (promissory-notes plan, D1 to D6, step 4). An organization acts through
 * agents, each named by the `agent_ref` on an event. The caller, which knows a party is an organization, passes a policy
 * naming the actions that need a second, distinct agent. These functions only read a validated stream; they never
 * append, never read a clock and never change their input.
 */

import type {
	ApprovalAction,
	ApprovalGrantedEvent,
	ApprovalRequestedEvent,
	NoteEvent,
} from "./types";

/** The actions that need two distinct agents. An action absent from the set needs no second approver. */
export interface ApprovalPolicy {
	twoPerson: ReadonlySet<ApprovalAction>;
}

export interface ApprovalRequestKey {
	action: ApprovalAction;
	target: string;
}

export interface ApprovalStatus {
	/** True when an `approval.requested` event exists for the action and target. */
	requested: boolean;
	/** The `agent_ref` of the request, or null when none exists or the request names no agent. */
	requester_agent: string | null;
	/** Distinct `agent_ref`s that granted the request, never the requester's own agent, in grant order. */
	granted_by: string[];
	/** At least one distinct approver. A request with no `agent_ref` is never satisfied. */
	satisfied: boolean;
}

export interface PendingApproval {
	action: ApprovalAction;
	target: string;
	requested_by_agent: string | null;
	/** The `entered_at` of the request. */
	requested_at: string;
}

const isRequest = (event: NoteEvent): event is ApprovalRequestedEvent =>
	event.type === "approval.requested";

const isGrant = (event: NoteEvent): event is ApprovalGrantedEvent =>
	event.type === "approval.granted";

/** Approvers of one request: the distinct agents of its grants, excluding the requester. Order of first grant. */
const approversOf = (
	events: readonly NoteEvent[],
	request: ApprovalRequestedEvent,
): string[] => {
	const approvers: string[] = [];
	if (request.agent_ref === undefined) {
		return approvers;
	}
	for (const event of events) {
		if (!isGrant(event) || event.request !== request.id) {
			continue;
		}
		const agent = event.agent_ref;
		if (
			agent !== undefined &&
			agent !== request.agent_ref &&
			!approvers.includes(agent)
		) {
			approvers.push(agent);
		}
	}
	return approvers;
};

const statusOfRequest = (
	events: readonly NoteEvent[],
	request: ApprovalRequestedEvent,
): ApprovalStatus => {
	const grantedBy = approversOf(events, request);
	return {
		requested: true,
		requester_agent: request.agent_ref ?? null,
		granted_by: grantedBy,
		satisfied: grantedBy.length > 0,
	};
};

const findRequest = (
	events: readonly NoteEvent[],
	key: ApprovalRequestKey,
): ApprovalRequestedEvent | undefined =>
	events.find(
		(event): event is ApprovalRequestedEvent =>
			isRequest(event) &&
			event.action === key.action &&
			event.target === key.target,
	);

/**
 * Where one approval request stands. When the same action and target were requested more than once, the first request
 * answers (grants name a request by id, so a later duplicate has its own count).
 */
export const approvalStatus = (
	events: readonly NoteEvent[],
	request: ApprovalRequestKey,
): ApprovalStatus => {
	const found = findRequest(events, request);
	if (found === undefined) {
		return {
			requested: false,
			requester_agent: null,
			granted_by: [],
			satisfied: false,
		};
	}
	return statusOfRequest(events, found);
};

const fail = (message: string): never => {
	throw new Error(message);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const requireString = (
	record: Record<string, unknown>,
	label: string,
	field: string,
): string => {
	const value = record[field];
	if (typeof value !== "string" || value === "") {
		return fail(`${label}: ${field} must be a non-empty string`);
	}
	return value;
};

const checkRelease = (
	events: readonly NoteEvent[],
	candidate: Record<string, unknown>,
	policy: ApprovalPolicy,
): void => {
	if (!policy.twoPerson.has("release.confirm")) {
		return;
	}
	const target = requireString(candidate, "release.confirmed", "target");
	const status = approvalStatus(events, { action: "release.confirm", target });
	if (!status.requested) {
		fail(
			`release.confirmed: draft ${JSON.stringify(target)} has no approval request (action release.confirm)`,
		);
	}
	if (!status.satisfied) {
		fail(
			`release.confirmed: the approval request for draft ${JSON.stringify(target)} has no approval from a second agent`,
		);
	}
};

const checkDefaultNotice = (
	events: readonly NoteEvent[],
	candidate: Record<string, unknown>,
	policy: ApprovalPolicy,
): void => {
	if (candidate.kind !== "default" || !policy.twoPerson.has("notice.default")) {
		return;
	}
	let satisfied = 0;
	let sent = 0;
	for (const event of events) {
		if (
			isRequest(event) &&
			event.action === "notice.default" &&
			statusOfRequest(events, event).satisfied
		) {
			satisfied += 1;
		}
		if (event.type === "notice.sent" && event.kind === "default") {
			sent += 1;
		}
	}
	if (satisfied <= sent) {
		fail(
			`notice.sent: a default notice needs its own approved request (action notice.default); ${satisfied} approved, ${sent} already sent`,
		);
	}
};

const checkGrant = (
	events: readonly NoteEvent[],
	candidate: Record<string, unknown>,
): void => {
	const label = "approval.granted";
	const requestId = requireString(candidate, label, "request");
	const agent = requireString(candidate, label, "agent_ref");
	const request = events.find(
		(event): event is ApprovalRequestedEvent =>
			isRequest(event) && event.id === requestId,
	);
	if (request === undefined) {
		fail(`${label}: request ${JSON.stringify(requestId)} does not exist`);
		return;
	}
	if (request.agent_ref === undefined) {
		fail(
			`${label}: request ${JSON.stringify(requestId)} names no agent_ref, so it cannot be approved`,
		);
		return;
	}
	if (agent === request.agent_ref) {
		fail(`${label}: an agent cannot approve their own request`);
	}
	if (approversOf(events, request).includes(agent)) {
		fail(
			`${label}: agent ${JSON.stringify(agent)} already approved request ${JSON.stringify(requestId)}`,
		);
	}
};

/**
 * Refuses, with a one-line error, a new event the approval rules forbid. Call it before appending. It reads only the
 * fields it needs from `candidate`, which may be unvalidated. A `release.confirmed` and a `default` `notice.sent` need
 * approval only when the policy lists the action; an `approval.granted` is always checked. Anything else passes.
 */
export const checkAppend = (
	events: readonly NoteEvent[],
	candidate: unknown,
	policy: ApprovalPolicy,
): void => {
	if (!isRecord(candidate)) {
		fail("candidate must be an object");
		return;
	}
	switch (candidate.type) {
		case "release.confirmed":
			checkRelease(events, candidate, policy);
			return;
		case "notice.sent":
			checkDefaultNotice(events, candidate, policy);
			return;
		case "approval.granted":
			checkGrant(events, candidate);
			return;
		default:
			return;
	}
};

/** Requests for a two-person action still without an approver, oldest first (by seq). For an approvals queue. */
export const pendingApprovals = (
	events: readonly NoteEvent[],
	policy: ApprovalPolicy,
): PendingApproval[] => {
	const pending: { seq: number; entry: PendingApproval }[] = [];
	for (const event of events) {
		if (
			!isRequest(event) ||
			!policy.twoPerson.has(event.action) ||
			statusOfRequest(events, event).satisfied
		) {
			continue;
		}
		pending.push({
			seq: event.seq,
			entry: {
				action: event.action,
				target: event.target,
				requested_by_agent: event.agent_ref ?? null,
				requested_at: event.entered_at,
			},
		});
	}
	pending.sort((left, right) => left.seq - right.seq);
	return pending.map(({ entry }) => entry);
};
