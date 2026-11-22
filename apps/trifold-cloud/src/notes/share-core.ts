import {
	type Grant,
	type GrantLevel,
	type GrantPurpose,
	type GrantStatus,
	MAX_CARVE_OUT_DAYS,
	MAX_GRANT_DAYS,
	type NoteEvent,
	type Role,
} from "tfd-notes";
import { isPlausibleEmail, maskEmail, normalizeEmail } from "./masking";
import { type Failure, failure } from "./outcome";
import type { ShareRecord } from "./store";

/**
 * The parts of sharing (docs/specs/promissory-notes.md build step 5; plan decision D1) that need no store: limits, the
 * parsing of a proposal, the list both parties see, the recipient's email and the token that opens a verify link. The
 * rules themselves (who must consent, what a viewer may see) live in `tfd-notes`; nothing here widens them.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export const SHARE_DEFAULT_DAYS = 30;
export const SHARE_MAX_DAYS = MAX_GRANT_DAYS;
/** A disclosure (a carve-out the proposer makes alone) lasts at most this many days. */
export const DISCLOSURE_MAX_DAYS = MAX_CARVE_OUT_DAYS;
/** Most grants one note may propose in a day, carve-outs and verify links included. */
export const SHARES_PER_DAY = 10;
export const SHARE_WINDOW_MS = DAY_MS;
/** Most times one note may re-send a person share's link in a day. */
export const SHARE_RESENDS_PER_DAY = 5;
/** A pasted document may be this large; the form is refused above it and nothing is kept. */
export const MAX_VERIFY_BODY_BYTES = 64 * 1024;

export const SHARE_LEVELS: readonly GrantLevel[] = ["summary", "statement"];
export const SHARE_PURPOSES: readonly GrantPurpose[] = [
	"accountant",
	"lawyer",
	"court",
	"assignee",
];

export const PURPOSE_LABELS: Record<GrantPurpose, string> = {
	accountant: "my accountant or bookkeeper",
	lawyer: "legal advice",
	court: "enforcement or a court",
	assignee: "an assignment of the loan",
};

const isLevel = (value: unknown): value is "summary" | "statement" =>
	SHARE_LEVELS.some((level) => level === value);

const isPurpose = (value: unknown): value is GrantPurpose =>
	SHARE_PURPOSES.some((purpose) => purpose === value);

export interface ShareProposal {
	recipientEmail: string;
	level: "summary" | "statement";
	days: number;
	carveOut: { purpose: GrantPurpose } | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

/** Whole days from 1 to the cap; undefined means the default. Anything else is a bad request. */
export const parseDays = (value: unknown): number | Failure => {
	if (value === undefined) return SHARE_DEFAULT_DAYS;
	if (
		typeof value !== "number" ||
		!Number.isInteger(value) ||
		value < 1 ||
		value > SHARE_MAX_DAYS
	)
		return failure(
			"bad_request",
			`Choose a number of days from 1 to ${SHARE_MAX_DAYS}.`,
		);
	return value;
};

/** Reads `{ recipient_email, level, days?, carve_out?: { purpose } }`; the server decides everything else. */
export const parseProposal = (input: unknown): ShareProposal | Failure => {
	if (!isRecord(input))
		return failure("bad_request", "Send the address, the level and the days.");
	const { recipient_email: email, level, days, carve_out: carve } = input;
	if (typeof email !== "string" || !isPlausibleEmail(normalizeEmail(email)))
		return failure("bad_request", "Enter a plain email address to share with.");
	if (!isLevel(level))
		return failure("bad_request", "Choose a summary or a statement.");
	const checkedDays = parseDays(days);
	if (typeof checkedDays !== "number") return checkedDays;
	let carveOut: ShareProposal["carveOut"] = null;
	if (carve !== undefined && carve !== null) {
		if (!(isRecord(carve) && isPurpose(carve.purpose)))
			return failure(
				"bad_request",
				"Choose what the disclosure is for: books, legal advice, enforcement or assignment.",
			);
		if (checkedDays > DISCLOSURE_MAX_DAYS)
			return failure(
				"bad_request",
				`A disclosure lasts at most ${DISCLOSURE_MAX_DAYS} days. Choose ${DISCLOSURE_MAX_DAYS} or fewer, or share it the ordinary way, which the other party agrees to.`,
			);
		carveOut = { purpose: carve.purpose };
	}
	return {
		recipientEmail: normalizeEmail(email),
		level,
		days: checkedDays,
		carveOut,
	};
};

/** The instant `days` whole days after `now`, in the clock's own format (UTC, ending in Z). */
export const expiryAfter = (now: string, days: number): string =>
	new Date(Date.parse(now) + days * DAY_MS).toISOString();

/** What the proposer's side sent as a verify link's reference and a person's reference: opaque, never an address. */
export const personRefOf = (id: string): string => `sp_${id}`;
export const linkRefOf = (id: string): string => `sl_${id}`;

/** One grant as both parties read it. The recipient's address is masked; nobody sees it in full. */
export interface ShareRow {
	grantId: string;
	kind: "person" | "link";
	level: GrantLevel;
	status: GrantStatus;
	/** A person share's address, masked; null for a verify link. */
	recipientMasked: string | null;
	proposedBy: Role;
	proposedAt: string;
	expiresAt: string;
	carveOut: boolean;
	purpose: GrantPurpose | null;
	consentedBy: Role[];
	revokedBy: Role | null;
	/** Pending, and this role has not consented: the viewer's own button. */
	awaitingMe: boolean;
	/** A verify link this caller proposed, active, whose token was never shown. */
	canReveal: boolean;
	/** A person share that is active: the proposer may send its link again. */
	canResend: boolean;
}

/** One carve-out as both parties read it: never hidden, whatever its status. */
export interface DisclosureRow {
	grantId: string;
	purpose: GrantPurpose;
	recipientMasked: string | null;
	proposedBy: Role;
	proposedAt: string;
	expiresAt: string;
	status: GrantStatus;
}

export interface SharingView {
	/** The caller's side. */
	role: Role;
	/** False for an organization viewer: they read the panel and press nothing. */
	canAct: boolean;
	shares: ShareRow[];
	disclosures: DisclosureRow[];
}

const proposalOf = (
	events: readonly NoteEvent[],
	grantId: string,
): NoteEvent | undefined =>
	events.find(
		(event) =>
			event.type === "visibility.changed" &&
			event.change === "grant.proposed" &&
			event.grant_id === grantId,
	);

/** True when this caller made the proposal: the same side and, for an organization agent, the same agent. */
export const isProposer = (
	events: readonly NoteEvent[],
	grant: Grant,
	role: Role,
	agentRef: string | undefined,
): boolean => {
	if (grant.proposed_by !== role) return false;
	if (agentRef === undefined) return true;
	return proposalOf(events, grant.grant_id)?.agent_ref === agentRef;
};

/**
 * The list and the disclosure log for one caller. Both parties get the same rows; only `awaitingMe`, `canReveal` and
 * `canResend` depend on who asks. `grants` is `grantsOf` at the instant of the read.
 */
export const sharingViewOf = (input: {
	events: readonly NoteEvent[];
	grants: readonly Grant[];
	shares: readonly ShareRecord[];
	role: Role;
	agentRef: string | undefined;
	canAct: boolean;
}): SharingView => {
	const { events, grants, shares, role, agentRef, canAct } = input;
	const recordOf = (grantId: string): ShareRecord | undefined =>
		shares.find((share) => share.grantId === grantId);
	const maskedOf = (grantId: string): string | null => {
		const email = recordOf(grantId)?.recipientEmail;
		return email === null || email === undefined ? null : maskEmail(email);
	};
	const rows: ShareRow[] = [];
	const disclosures: DisclosureRow[] = [];
	for (const grant of grants) {
		const record = recordOf(grant.grant_id);
		const mine = canAct && isProposer(events, grant, role, agentRef);
		rows.push({
			grantId: grant.grant_id,
			kind: grant.audience.kind === "link" ? "link" : "person",
			level: grant.level,
			status: grant.status,
			recipientMasked: maskedOf(grant.grant_id),
			proposedBy: grant.proposed_by,
			proposedAt: grant.proposed_at,
			expiresAt: grant.expires_at,
			carveOut: grant.carve_out,
			purpose: grant.purpose ?? null,
			consentedBy: [...grant.consented_by],
			revokedBy: grant.revoked_by,
			awaitingMe:
				canAct &&
				grant.status === "pending" &&
				!grant.consented_by.includes(role),
			canReveal:
				mine &&
				grant.audience.kind === "link" &&
				grant.status === "active" &&
				record?.linkHash === null,
			canResend:
				mine && grant.audience.kind === "person" && grant.status === "active",
		});
		if (grant.carve_out && grant.purpose !== undefined)
			disclosures.push({
				grantId: grant.grant_id,
				purpose: grant.purpose,
				recipientMasked: maskedOf(grant.grant_id),
				proposedBy: grant.proposed_by,
				proposedAt: grant.proposed_at,
				expiresAt: grant.expires_at,
				status: grant.status,
			});
	}
	return { role, canAct, shares: rows, disclosures };
};

/**
 * What the other party is emailed when a disclosure is recorded (the proposer needs no consent from them, so this is
 * how they hear of it). It says only that a disclosure exists, to whom (masked), for what and until when, and that the
 * note page lists it: no amount, no name.
 */
export const disclosureEmail = (input: {
	recipientEmail: string;
	purpose: GrantPurpose;
	expiresAt: string;
	notePageUrl: string;
}): { subject: string; text: string } => ({
	subject: "A disclosure was recorded on your loan record",
	text: [
		"One of the parties to your loan record disclosed it to someone who needs it for their own purposes.",
		"",
		`Recipient: ${maskEmail(input.recipientEmail)}`,
		`Purpose: ${PURPOSE_LABELS[input.purpose]}`,
		`Ends: ${input.expiresAt.slice(0, 10)}`,
		"",
		`Your note page lists it, with every disclosure on the record: ${input.notePageUrl}`,
		"If the link asks you to sign in, ask for a new link there.",
		"A record, not legal or tax advice.",
	].join("\n"),
});

/**
 * The email a recipient gets when a share becomes active. It carries no name, no amount and no claim, and says who it
 * came from only as "one of the parties". The link works once.
 */
export const shareEmail = (
	link: string,
	expiresAt: string,
): { subject: string; text: string } => ({
	subject: "A loan record was shared with you",
	text: [
		"A loan record was shared with you by one of the parties.",
		"",
		`Open it here. The link works once, and the share ends on ${expiresAt.slice(0, 10)}:`,
		link,
		"",
		"If you did not expect this, ignore this message: nothing happens until the link is used.",
		"A record, not legal or tax advice.",
	].join("\n"),
});

const TOKEN_PATTERN = /^([A-Za-z0-9_.-]{8,80})\.([A-Za-z0-9_-]{16,128})$/;

/**
 * The text of a verify link's token: the note id (so the right note is asked) and a secret; only the secret is hashed.
 * A note id holds one dot of its own, so the secret is what follows the last dot.
 */
export const verifyTokenOf = (noteId: string, secret: string): string =>
	`${noteId}.${secret}`;

export const parseVerifyToken = (
	token: string,
): { noteId: string; secret: string } | null => {
	const matched = TOKEN_PATTERN.exec(token);
	if (matched === null) return null;
	return { noteId: matched[1] as string, secret: matched[2] as string };
};
