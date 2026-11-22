/**
 * What the guest flow takes from outside (mail, time, ids, keys, deferred work), so everything under `src/notes/` runs without Cloudflare and
 * tests never touch a network, a clock or a random source (plans/promissory-notes/steps-2-5.md, D5).
 */

import type { KeysInput } from "tfd-verify-notes";

/**
 * Sends one plain-text email. The Worker's mailer is `mailerFor(env)` (`cloudflare-mailer.ts`): Cloudflare Email Service
 * when `EMAIL` and `NOTES_MAIL_FROM` are set, else the one below that always throws. A failed send throws; callers treat
 * any throw as "mail failed" and add no retry.
 */
export interface MailSender {
	send(message: { to: string; subject: string; text: string }): Promise<void>;
}

/**
 * The published public keys a pasted document is checked against, in the shape `tfd-verify-notes` reads (a map of key id
 * to PEM, or to a PEM with purpose and window). Null means the check is not configured here.
 */
export interface PublicKeySource {
	get(): Promise<KeysInput | null>;
}

/**
 * Runs work after the response has gone (`ctx.waitUntil` in the Worker). A link request hands its mail to this, so the
 * response takes the same time whether or not an address matched.
 */
export type Defer = (work: Promise<unknown>) => void;

/** Starts the work and lets it finish on its own: for callers with no execution context (tests, local runs). */
export const unawaited: Defer = (work) => {
	void work;
};

/** The time source. `now()` is a UTC instant in ISO 8601 ending in `Z`, e.g. `2026-11-22T09:30:00.000Z`. */
export interface Clock {
	now(): string;
}

/** Where ids and secrets come from. `token` is never derived from anything guessable: it is random bytes. */
export interface IdSource {
	/** An opaque id for an event, an invite or a session row. Unique, not secret. */
	next(): string;
	/** `bytes` random bytes as unpadded base64url. Used for links, sessions and step-up codes. */
	token(bytes: number): string;
}

const BASE64_CHUNK = 0x8000;

const toBase64Url = (bytes: Uint8Array): string => {
	let binary = "";
	for (let index = 0; index < bytes.length; index += BASE64_CHUNK) {
		binary += String.fromCharCode(
			...bytes.subarray(index, index + BASE64_CHUNK),
		);
	}
	return btoa(binary)
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");
};

export const systemClock: Clock = { now: () => new Date().toISOString() };

/** WebCrypto-backed ids: `crypto.randomUUID` for ids, `crypto.getRandomValues` for tokens. */
export const cryptoIdSource: IdSource = {
	next: () => crypto.randomUUID().replace(/-/g, ""),
	token: (bytes) => toBase64Url(crypto.getRandomValues(new Uint8Array(bytes))),
};

/** Thrown by the default mailer: no sending service or no sender address is configured. */
export class MailNotConfiguredError extends Error {
	constructor() {
		super("no mail sender is configured");
		this.name = "MailNotConfiguredError";
	}
}

export const unconfiguredMailer: MailSender = {
	send: () => Promise.reject(new MailNotConfiguredError()),
};

/**
 * A send that failed. `code` is the sending service's error code when it gave one (null for a refusal made here or a
 * malformed call); `retryable` says whether trying the same message later could succeed. The message never carries an
 * address, a subject or a link.
 */
export class MailError extends Error {
	readonly code: string | null;
	readonly retryable: boolean;

	constructor(message: string, code: string | null, retryable: boolean) {
		super(message);
		this.name = "MailError";
		this.code = code;
		this.retryable = retryable;
	}
}
