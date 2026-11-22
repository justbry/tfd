import {
	type Grant,
	type GrantAudience,
	grantsOf,
	type NoteEvent,
	type SharedView,
	sha256Hex,
	validateStream,
	viewFor,
} from "tfd-notes";
import { type KeysInput, verifyNoteDocument } from "tfd-verify-notes";
import type { CloudEnv } from "../env";
import type { Clock, IdSource, PublicKeySource } from "./ports";
import { constantTimeEqual, hmac, SESSION_ABSOLUTE_MS } from "./sessions";
import { MAX_VERIFY_BODY_BYTES, parseVerifyToken } from "./share-core";
import type { VerifyResult } from "./share-pages";
import type { NoteStore, ShareRecord } from "./store";

/**
 * What a recipient reaches without being a party (build step 5): a person's share (an emailed single-use link, then a
 * read-only session) and a verify link (a bearer token, no session). Every request re-reads the log and re-evaluates
 * the grant, so revoking or letting a share expire cuts access at the next request. The page content comes from
 * `viewFor` and nothing else.
 */

const SECOND_MS = 1000;
const DATE_LENGTH = 10;
const SHARE_TOKEN_BYTES = 32;

/** The published public keys from `NOTES_PUBLIC_KEYS_JSON`. Absent or unreadable means the check is not configured. */
export const publicKeysFromEnv = (env: CloudEnv): PublicKeySource => ({
	get: async () => {
		const text = env.NOTES_PUBLIC_KEYS_JSON;
		if (text === undefined || text.trim() === "") return null;
		try {
			const parsed: unknown = JSON.parse(text);
			const isKeyMap =
				typeof parsed === "object" && parsed !== null && !Array.isArray(parsed);
			return isKeyMap ? (parsed as KeysInput) : null;
		} catch {
			return null;
		}
	},
});

export interface ShareAccessDeps {
	store: NoteStore;
	clock: Clock;
	ids: IdSource;
	/** `NOTES_SESSION_SECRET`: keys a share session's CSRF token. */
	secret: string;
	keys: PublicKeySource;
}

interface ActiveGrant {
	events: NoteEvent[];
	grants: Grant[];
	grant: Grant;
}

/** What a verify link opens: the note it belongs to, which only the check of a pasted document uses. Never shown. */
export interface VerifyContext {
	noteId: string;
}

export class ShareAccess {
	constructor(private readonly deps: ShareAccessDeps) {}

	/**
	 * The grant as of this instant, only when it is active and its audience is the reference the store row keeps. The
	 * log is read and validated whole, so a log that no longer reads as a stream is no share at all.
	 */
	private async activeGrant(
		noteId: string,
		share: ShareRecord,
	): Promise<ActiveGrant | null> {
		const raw = await this.readRaw(noteId);
		if (raw === null) return null;
		let events: NoteEvent[];
		let grants: Grant[];
		try {
			events = validateStream(raw);
			grants = grantsOf(events, this.deps.clock.now());
		} catch {
			return null;
		}
		const grant = grants.find(
			(candidate) => candidate.grant_id === share.grantId,
		);
		if (
			grant === undefined ||
			grant.status !== "active" ||
			grant.audience.kind !== share.kind ||
			grant.audience.ref !== share.audienceRef
		)
			return null;
		return { events, grants, grant };
	}

	private async readRaw(noteId: string): Promise<unknown[] | null> {
		const { events } = await this.deps.store.readLog(noteId);
		if (events.length === 0) return null;
		try {
			return events.map((text): unknown => JSON.parse(text));
		} catch {
			return null;
		}
	}

	/** The UTC date of the clock, and never before the note's issue date (the engine refuses an earlier `asOf`). */
	private asOf(events: NoteEvent[]): string {
		const today = this.deps.clock.now().slice(0, DATE_LENGTH);
		const created = events[0];
		if (created?.type !== "note.created") return today;
		return today < created.terms.issue_date ? created.terms.issue_date : today;
	}

	private after(ms: number): number {
		return Date.parse(this.deps.clock.now()) + ms;
	}

	/**
	 * Uses a person share's link, once, and opens a read-only session for that grant alone. The session ends 12 hours
	 * on, and never after the grant itself ends. Null when the link is wrong, used, or the grant is not active.
	 */
	async redeem(
		noteId: string,
		grantId: string,
		token: string,
	): Promise<{ cookieValue: string; maxAgeSeconds: number } | null> {
		const { store, ids, clock } = this.deps;
		const share = await store.getShare(noteId, grantId);
		if (share?.kind !== "person" || share.linkHash === null) return null;
		const hash = await sha256Hex(token);
		if (!constantTimeEqual(hash, share.linkHash)) return null;
		const found = await this.activeGrant(noteId, share);
		if (found === null) return null;
		const now = clock.now();
		if (!(await store.claimShareLink(noteId, grantId, hash, now))) return null;
		const endsAt = Math.min(
			this.after(SESSION_ABSOLUTE_MS),
			Date.parse(found.grant.expires_at),
		);
		const cookieValue = ids.token(SHARE_TOKEN_BYTES);
		await store.putShareSession(noteId, {
			hash: await sha256Hex(cookieValue),
			grantId,
			createdAt: now,
			absoluteExpiresAt: new Date(endsAt).toISOString(),
		});
		return {
			cookieValue,
			maxAgeSeconds: Math.max(
				0,
				Math.floor((endsAt - Date.parse(now)) / SECOND_MS),
			),
		};
	}

	/** True when this cookie is a live share session for exactly this grant of this note. */
	async hasSession(
		noteId: string,
		grantId: string,
		cookieValue: string | null,
	): Promise<boolean> {
		if (cookieValue === null) return false;
		const session = await this.deps.store.getShareSession(
			noteId,
			await sha256Hex(cookieValue),
			this.deps.clock.now(),
		);
		return session !== null && session.grantId === grantId;
	}

	/** The form token of a share session: HMAC of the session row's key under `NOTES_SESSION_SECRET`. */
	async csrfToken(
		noteId: string,
		grantId: string,
		cookieValue: string,
	): Promise<string> {
		return hmac(
			this.deps.secret,
			`csrf:share:${noteId}:${grantId}:${await sha256Hex(cookieValue)}`,
		);
	}

	async checkCsrf(
		noteId: string,
		grantId: string,
		cookieValue: string,
		supplied: string | null,
	): Promise<boolean> {
		if (supplied === null) return false;
		return constantTimeEqual(
			await this.csrfToken(noteId, grantId, cookieValue),
			supplied,
		);
	}

	/** Ends the share session on the server: its cookie opens nothing from now on. */
	async endSession(
		noteId: string,
		grantId: string,
		cookieValue: string,
	): Promise<void> {
		const hash = await sha256Hex(cookieValue);
		const session = await this.deps.store.getShareSession(
			noteId,
			hash,
			this.deps.clock.now(),
		);
		if (session?.grantId === grantId)
			await this.deps.store.deleteShareSession(noteId, hash);
	}

	/**
	 * The view a person's grant allows right now, or null. `viewFor` is the only thing that builds it, from the stream,
	 * `grantsOf` at this instant and the grant's own audience, so a revoked, expired or pending grant yields nothing.
	 */
	async viewOf(noteId: string, grantId: string): Promise<SharedView | null> {
		const share = await this.deps.store.getShare(noteId, grantId);
		if (share === null || share.kind !== "person") return null;
		const found = await this.activeGrant(noteId, share);
		if (found === null) return null;
		return this.viewFrom(found, found.grant.audience);
	}

	private viewFrom(
		found: ActiveGrant,
		audience: GrantAudience,
	): SharedView | null {
		try {
			return viewFor(
				found.events,
				found.grants,
				audience,
				this.asOf(found.events),
			);
		} catch {
			return null;
		}
	}

	/**
	 * The note a verify link opens, or null when the token is unknown, revoked, expired or its grant is not yet agreed.
	 * Every stored hash is compared in constant time. The page lists nothing about the record: not its documents, not
	 * their number.
	 */
	async verifyContext(token: string): Promise<VerifyContext | null> {
		const parsed = parseVerifyToken(token);
		if (parsed === null) return null;
		const { noteId, secret } = parsed;
		const hash = await sha256Hex(secret);
		let matched: ShareRecord | null = null;
		for (const share of await this.deps.store.listShares(noteId)) {
			const same =
				share.kind === "link" &&
				share.linkHash !== null &&
				constantTimeEqual(hash, share.linkHash);
			if (same) matched = share;
		}
		if (matched === null) return null;
		const found = await this.activeGrant(noteId, matched);
		if (found === null) return null;
		const view = this.viewFrom(found, found.grant.audience);
		if (view?.level !== "verify") return null;
		return { noteId: view.note_id };
	}

	/**
	 * Checks one pasted document against the published keys. Nothing is stored. The verdict carries the document's type,
	 * key and signing time and never its contents; a document that belongs to another note fails here.
	 */
	async checkDocument(
		context: VerifyContext,
		text: string,
	): Promise<VerifyResult> {
		if (new TextEncoder().encode(text).length > MAX_VERIFY_BODY_BYTES)
			return { kind: "too_large" };
		const keys = await this.deps.keys.get();
		if (keys === null) return { kind: "not_configured" };
		let parsed: unknown;
		try {
			parsed = JSON.parse(text);
		} catch {
			return { kind: "failed", code: "not_json" };
		}
		const verdict = await verifyNoteDocument(parsed, keys, {
			now: this.deps.clock.now(),
		});
		if (!verdict.ok) return { kind: "failed", code: verdict.code };
		if (verdict.note_id !== context.noteId)
			return { kind: "failed", code: "other_record" };
		return {
			kind: "ok",
			type: verdict.type,
			keyId: verdict.key_id,
			signedAt: verdict.signed_at,
		};
	}
}
