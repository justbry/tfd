import type {
	ApprovalAction,
	ApprovalAgents,
	ApprovalRequestedEvent,
	NoteEvent,
} from "tfd-notes";
import type { AgentIdentity, AgentRole } from "./org";

/**
 * What a page shows about approvals, worked out from the events alone. Agent refs are read here to say whether a request
 * or a grant is the viewer's own, and are never returned: a page gets booleans, not ids of people.
 */

export const ACTION_LABELS: Record<ApprovalAction, string> = {
	"release.confirm": "confirming a release",
	"notice.default": "a default notice",
	waiver: "a waiver",
};

const LABEL_LENGTH = 80;

export interface ApprovalRow {
	requestId: string;
	action: ApprovalAction;
	/** A readable name for what the request is about. Free text from an annotation is possible: escape it. */
	label: string;
	requestedAt: string;
	/** Days to cure of a default notice request; null for the other actions. */
	cureDays: number | null;
	/** The viewer asked for this one. */
	mine: boolean;
	satisfied: boolean;
	/** The viewer has already approved this one. */
	approvedByYou: boolean;
}

export type ReleaseApproval = {
	status: "none" | "pending" | "satisfied";
	/** The request for the current draft, when there is one. */
	requestId: string | null;
	mine: boolean;
	approvedByYou: boolean;
};

export interface OrgNoteView {
	orgId: string;
	agentRole: AgentRole;
	requests: ApprovalRow[];
	/** For the release that is drafted and not yet confirmed; `null` when there is no such draft. */
	releaseApproval: ReleaseApproval | null;
	/** Default notices the approvals allow and that have not been sent yet: one per approved request nobody has used. */
	approvedNotices: { requestId: string; cureDays: number }[];
	/** Earlier entries a request for a default notice or a waiver may name: the annotations, and the start of the record. */
	targets: { id: string; label: string }[];
}

const isRequest = (event: NoteEvent): event is ApprovalRequestedEvent =>
	event.type === "approval.requested";

/**
 * The ids of requests with an approver: a grant by a distinct agent, never the requester's own, both still on the team
 * when `agents.activeAgents` is given. This is the rule of `tfd-notes` `approvalStatus`, applied to each request by its
 * id so two requests for the same target stay apart.
 */
export const satisfiedRequestIds = (
	events: readonly NoteEvent[],
	agents: ApprovalAgents = {},
): Set<string> => {
	const isActive = (agent: string): boolean =>
		agents.activeAgents === undefined || agents.activeAgents.has(agent);
	const requests = new Map<string, ApprovalRequestedEvent>();
	for (const event of events) {
		if (isRequest(event)) requests.set(event.id, event);
	}
	const satisfied = new Set<string>();
	for (const event of events) {
		if (event.type !== "approval.granted") continue;
		const request = requests.get(event.request);
		if (
			request?.agent_ref !== undefined &&
			event.agent_ref !== undefined &&
			event.agent_ref !== request.agent_ref &&
			isActive(request.agent_ref) &&
			isActive(event.agent_ref)
		)
			satisfied.add(request.id);
	}
	return satisfied;
};

const excerpt = (text: string): string =>
	text.length > LABEL_LENGTH ? `${text.slice(0, LABEL_LENGTH)}...` : text;

const targetLabel = (
	events: readonly NoteEvent[],
	action: ApprovalAction,
	target: string,
): string => {
	const found = events.find((event) => event.id === target);
	if (found === undefined) return "an earlier entry";
	if (action === "release.confirm")
		return `the release drafted on ${found.entered_at.slice(0, 10)}`;
	if (found.type === "annotation.added")
		return `the note "${excerpt(found.text)}"`;
	if (found.type === "note.created") return "the start of the record";
	return `an earlier ${found.type} entry`;
};

const requestRows = (
	events: readonly NoteEvent[],
	agentRef: string,
	agents: ApprovalAgents,
): ApprovalRow[] => {
	const satisfied = satisfiedRequestIds(events, agents);
	const rows: ApprovalRow[] = [];
	for (const event of events) {
		if (!isRequest(event)) continue;
		rows.push({
			requestId: event.id,
			action: event.action,
			label: targetLabel(events, event.action, event.target),
			requestedAt: event.entered_at,
			cureDays: event.cure_days ?? null,
			mine: event.agent_ref === agentRef,
			satisfied: satisfied.has(event.id),
			approvedByYou: events.some(
				(other) =>
					other.type === "approval.granted" &&
					other.request === event.id &&
					other.agent_ref === agentRef,
			),
		});
	}
	return rows;
};

const releaseApprovalFor = (
	rows: readonly ApprovalRow[],
	events: readonly NoteEvent[],
	draftId: string | null,
): ReleaseApproval | null => {
	if (draftId === null) return null;
	const request = events.find(
		(event): event is ApprovalRequestedEvent =>
			isRequest(event) &&
			event.action === "release.confirm" &&
			event.target === draftId,
	);
	const row = rows.find((candidate) => candidate.requestId === request?.id);
	if (row === undefined)
		return {
			status: "none",
			requestId: null,
			mine: false,
			approvedByYou: false,
		};
	return {
		status: row.satisfied ? "satisfied" : "pending",
		requestId: row.requestId,
		mine: row.mine,
		approvedByYou: row.approvedByYou,
	};
};

/** The approved default-notice requests no notice has used yet (a notice names its request in `approval`). */
const approvedDefaultNotices = (
	rows: readonly ApprovalRow[],
	events: readonly NoteEvent[],
): { requestId: string; cureDays: number }[] => {
	const used = new Set<string>();
	for (const event of events) {
		if (event.type === "notice.sent" && event.approval !== undefined)
			used.add(event.approval);
	}
	const ready: { requestId: string; cureDays: number }[] = [];
	for (const row of rows) {
		if (
			row.action === "notice.default" &&
			row.satisfied &&
			row.cureDays !== null &&
			!used.has(row.requestId)
		)
			ready.push({ requestId: row.requestId, cureDays: row.cureDays });
	}
	return ready;
};

const requestTargets = (
	events: readonly NoteEvent[],
): { id: string; label: string }[] => {
	const targets: { id: string; label: string }[] = [];
	for (const event of events) {
		if (event.type === "note.created")
			targets.push({ id: event.id, label: "The start of the record" });
		if (event.type === "annotation.added")
			targets.push({ id: event.id, label: `Note: ${excerpt(event.text)}` });
	}
	return targets;
};

/** The approvals panel's data for one agent on one note. `draftId` is the release that is drafted and unconfirmed. */
export const orgViewOf = (
	events: readonly NoteEvent[],
	agent: AgentIdentity,
	draftId: string | null,
	agents: ApprovalAgents = {},
): OrgNoteView => {
	const requests = requestRows(events, agent.agentRef, agents);
	return {
		orgId: agent.orgId,
		agentRole: agent.role,
		requests,
		releaseApproval: releaseApprovalFor(requests, events, draftId),
		approvedNotices: approvedDefaultNotices(requests, events),
		targets: requestTargets(events),
	};
};
