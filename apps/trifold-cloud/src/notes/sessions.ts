import { type Role, sha256Hex } from "tfd-notes";
import { type AgentIdentity, orgCsrfMessage, orgNotePath } from "./org";
import type { Clock, IdSource } from "./ports";
import type { NoteStore } from "./store";

/**
 * Magic links, sessions, CSRF tokens and step-up codes (docs/specs/promissory-notes.md build step 2; plan D2). WebCrypto
 * only. Nothing secret is stored: links, sessions and codes are kept as hashes, and no token is ever logged, put in a
 * redirect target or rendered on a page after it is redeemed.
 */

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export const INVITE_TTL_MS = 7 * DAY_MS;
export const SESSION_IDLE_MS = 2 * HOUR_MS;
export const SESSION_ABSOLUTE_MS = 12 * HOUR_MS;
export const CODE_TTL_MS = 10 * MINUTE_MS;
export const CODE_MAX_ATTEMPTS = 5;
/** Tries at a code are counted per session and action over this window, and a new code does not reset the count. */
export const CODE_ATTEMPT_WINDOW_MS = HOUR_MS;
/** Codes one session may be sent per window, so issuing codes cannot buy more guesses. */
export const CODES_PER_WINDOW = 5;
/** 256 bits, for a link and for a session id. */
const TOKEN_BYTES = 32;
const CODE_DIGITS = 6;
const CODE_SPACE = 10n ** BigInt(CODE_DIGITS);
const CODE_ENTROPY_BYTES = 16;
const HASH_PREFIX_BYTES = 8;
const HEX_BYTE_WIDTH = 2;

/**
 * One cookie name per scope, so a cookie of one family is never read as another: `__Host-tf_note_<noteId>`,
 * `__Host-tf_org_<orgId>` (`org-sessions.ts`) and `__Host-tf_share_<noteId>_<grantId>` (`share-routes.ts`). `__Host-`
 * makes the browser insist on `Secure`, `Path=/` and no `Domain`, so a sibling host cannot set or shadow it.
 */
export const SESSION_COOKIE_PREFIX = "__Host-tf_note_";

export const sessionCookieName = (noteId: string): string =>
	`${SESSION_COOKIE_PREFIX}${noteId}`;

/** The attributes every session cookie carries (`__Host-` needs `Path=/`). */
export const COOKIE_ATTRIBUTES = "HttpOnly; Secure; SameSite=Lax; Path=/";

/** The value of the cookie `name` in a `Cookie` header, or null. */
export const readCookie = (
	header: string | null,
	name: string,
): string | null => {
	if (!header) return null;
	for (const part of header.split(";")) {
		const [cookieName, ...rest] = part.trim().split("=");
		if (cookieName === name) return rest.join("=") || null;
	}
	return null;
};

const ENCODER = new TextEncoder();

/**
 * Compares two strings in time that depends on the longer one's length only, never on where they differ. Different
 * lengths are simply unequal (no throw). Used for bearer keys, CSRF tokens, codes and link hashes.
 */
export const constantTimeEqual = (left: string, right: string): boolean => {
	const leftBytes = ENCODER.encode(left);
	const rightBytes = ENCODER.encode(right);
	const length = Math.max(leftBytes.length, rightBytes.length);
	let difference = leftBytes.length ^ rightBytes.length;
	for (let index = 0; index < length; index += 1) {
		difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
	}
	return difference === 0;
};

const toBase64Url = (bytes: Uint8Array): string => {
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary)
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");
};

/** HMAC-SHA-256 of `message` under `secret`, as unpadded base64url. */
export const hmac = async (
	secret: string,
	message: string,
): Promise<string> => {
	const key = await crypto.subtle.importKey(
		"raw",
		ENCODER.encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	return toBase64Url(
		new Uint8Array(
			await crypto.subtle.sign("HMAC", key, ENCODER.encode(message)),
		),
	);
};

/** A short, non-secret hash prefix for a counter key, so an address never sits in a counter. */
export const hashPrefix = async (text: string): Promise<string> =>
	(await sha256Hex(text)).slice(0, HASH_PREFIX_BYTES * HEX_BYTE_WIDTH);

export const sessionCookie = (
	noteId: string,
	value: string,
	maxAgeSeconds: number,
): string =>
	`${sessionCookieName(noteId)}=${value}; ${COOKIE_ATTRIBUTES}; Max-Age=${maxAgeSeconds}`;

/** Expires the cookie in the browser. */
export const clearedSessionCookie = (noteId: string): string =>
	`${sessionCookieName(noteId)}=; ${COOKIE_ATTRIBUTES}; Max-Age=0`;

/** The value of this note's session cookie in a `Cookie` header, or null. */
export const readSessionCookie = (
	header: string | null,
	noteId: string,
): string | null => readCookie(header, sessionCookieName(noteId));

export interface ActiveSession {
	noteId: string;
	role: Role;
	/** sha256 of the cookie value: the key of the session row. Not the cookie. */
	hash: string;
	/** Set for an agent of a lender organization, whose session is the organization's (`org-sessions.ts`). */
	agent?: AgentIdentity;
}

/**
 * How a note step finds its session: a guest's own cookie on `/n/:id`, an organization agent's on `/o/:orgId/n/:id`. It
 * answers the session, or the response that refuses the request (sign in again, or not found). `clear` says whether a
 * refusal also clears the cookie.
 */
export type GetSession = (
	request: Request,
	clear: boolean,
) => Promise<ActiveSession | Response>;

/** The path of this session's note page: `/n/:id` for a guest, `/o/:orgId/n/:id` for an organization agent. */
export const basePathOf = (session: ActiveSession): string =>
	session.agent
		? orgNotePath(session.agent.orgId, session.noteId)
		: `/n/${session.noteId}`;

export type CodeCheck = "ok" | "invalid" | "expired" | "locked" | "none";

export interface SessionOptions {
	inviteTtlMs?: number;
	idleMs?: number;
	absoluteMs?: number;
	codeTtlMs?: number;
	codeMaxAttempts?: number;
}

export class SessionManager {
	private readonly inviteTtlMs: number;
	private readonly idleMs: number;
	private readonly absoluteMs: number;
	private readonly codeTtlMs: number;
	private readonly codeMaxAttempts: number;

	constructor(
		private readonly deps: {
			store: NoteStore;
			clock: Clock;
			ids: IdSource;
			/** `NOTES_SESSION_SECRET`: keys the CSRF tokens and the step-up code hashes. */
			secret: string;
		},
		options: SessionOptions = {},
	) {
		this.inviteTtlMs = options.inviteTtlMs ?? INVITE_TTL_MS;
		this.idleMs = options.idleMs ?? SESSION_IDLE_MS;
		this.absoluteMs = options.absoluteMs ?? SESSION_ABSOLUTE_MS;
		this.codeTtlMs = options.codeTtlMs ?? CODE_TTL_MS;
		this.codeMaxAttempts = options.codeMaxAttempts ?? CODE_MAX_ATTEMPTS;
	}

	private after(ms: number): string {
		return new Date(Date.parse(this.deps.clock.now()) + ms).toISOString();
	}

	/**
	 * A fresh single-use link token for `role`. Returns the token; the store keeps its hash. With `replace`, the party's
	 * older links that nobody opened stop working first (what a request for a new link does).
	 */
	async issueInvite(
		noteId: string,
		role: Role,
		options: { replace?: boolean } = {},
	): Promise<string> {
		if (options.replace) await this.deps.store.deleteInvites(noteId, role);
		const token = this.deps.ids.token(TOKEN_BYTES);
		await this.deps.store.putInvite(noteId, {
			hash: await sha256Hex(token),
			role,
			expiresAt: this.after(this.inviteTtlMs),
		});
		return token;
	}

	/** Uses the link (once) and opens a session. The cookie value is returned here and nowhere else. */
	async redeem(
		noteId: string,
		token: string,
	): Promise<{
		cookieValue: string;
		role: Role;
		maxAgeSeconds: number;
	} | null> {
		const now = this.deps.clock.now();
		const role = await this.deps.store.redeemInvite(
			noteId,
			await sha256Hex(token),
			now,
		);
		if (role === null) return null;
		const cookieValue = this.deps.ids.token(TOKEN_BYTES);
		await this.deps.store.putSession(noteId, {
			hash: await sha256Hex(cookieValue),
			role,
			createdAt: now,
			lastSeenAt: now,
			absoluteExpiresAt: this.after(this.absoluteMs),
		});
		return {
			cookieValue,
			role,
			maxAgeSeconds: Math.floor(this.absoluteMs / SECOND_MS),
		};
	}

	/** The live session behind a cookie value (sliding idle limit, absolute limit), or null. */
	async resolve(
		noteId: string,
		cookieValue: string | null,
	): Promise<ActiveSession | null> {
		if (cookieValue === null) return null;
		const hash = await sha256Hex(cookieValue);
		const record = await this.deps.store.touchSession(
			noteId,
			hash,
			this.deps.clock.now(),
			this.idleMs,
		);
		return record ? { noteId, role: record.role, hash } : null;
	}

	/** Ends the session on the server: its cookie opens nothing from now on. */
	endSession(session: ActiveSession): Promise<void> {
		return this.deps.store.deleteSession(session.noteId, session.hash);
	}

	/** The form token for this session: HMAC of the session row's key under `NOTES_SESSION_SECRET`. */
	csrfToken(session: ActiveSession): Promise<string> {
		return hmac(
			this.deps.secret,
			session.agent
				? orgCsrfMessage(session.agent.orgId, session.hash)
				: `csrf:${session.noteId}:${session.hash}`,
		);
	}

	async checkCsrf(
		session: ActiveSession,
		supplied: string | null,
	): Promise<boolean> {
		if (supplied === null) return false;
		return constantTimeEqual(await this.csrfToken(session), supplied);
	}

	private codeHash(
		session: ActiveSession,
		action: string,
		code: string,
	): Promise<string> {
		return hmac(
			this.deps.secret,
			`code:${session.noteId}:${session.hash}:${action}:${code}`,
		);
	}

	/**
	 * True while this session may be sent another code (`CODES_PER_WINDOW` an hour). Checked by the caller before it
	 * issues one, so a refused request sends no email.
	 */
	canIssueCode(session: ActiveSession): Promise<boolean> {
		return this.deps.store.hit(
			session.noteId,
			`code:${session.hash.slice(0, HASH_PREFIX_BYTES * HEX_BYTE_WIDTH)}`,
			this.deps.clock.now(),
			CODE_ATTEMPT_WINDOW_MS,
			CODES_PER_WINDOW,
		);
	}

	/** A new 6-digit code for one kind of action; the previous code of the session stops working. */
	async issueCode(session: ActiveSession, action: string): Promise<string> {
		const entropy = await sha256Hex(this.deps.ids.token(CODE_ENTROPY_BYTES));
		const number =
			BigInt(`0x${entropy.slice(0, CODE_ENTROPY_BYTES)}`) % CODE_SPACE;
		const code = number.toString().padStart(CODE_DIGITS, "0");
		await this.deps.store.putCode(session.noteId, session.hash, {
			codeHash: await this.codeHash(session, action, code),
			action,
			expiresAt: this.after(this.codeTtlMs),
		});
		return code;
	}

	/**
	 * Tries a code. Every try counts toward the attempt limit, a correct code is deleted so it works once, and a code
	 * for one kind of action does not open another.
	 */
	async checkCode(
		session: ActiveSession,
		action: string,
		supplied: string,
	): Promise<CodeCheck> {
		const attempt = await this.deps.store.takeAttempt(
			session.noteId,
			session.hash,
			this.deps.clock.now(),
			this.codeMaxAttempts,
		);
		if (attempt.status !== "ok") return attempt.status;
		// The count that matters: tries per session and action over the hour. A new code does not reset it.
		const allowed = await this.deps.store.hit(
			session.noteId,
			`try:${await hashPrefix(`${session.hash}:${action}`)}`,
			this.deps.clock.now(),
			CODE_ATTEMPT_WINDOW_MS,
			this.codeMaxAttempts,
		);
		if (!allowed) return "locked";
		const expected = await this.codeHash(session, action, supplied.trim());
		const matches =
			attempt.action === action &&
			constantTimeEqual(expected, attempt.codeHash);
		if (!matches) return "invalid";
		return (await this.deps.store.clearCode(session.noteId, session.hash))
			? "ok"
			: "invalid";
	}
}
