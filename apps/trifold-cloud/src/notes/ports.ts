/**
 * The three things the guest flow takes from outside, so everything under `src/notes/` runs without Cloudflare and
 * tests never touch a network, a clock or a random source (plans/promissory-notes/steps-2-5.md, D5).
 */

import type { KeysInput } from "tfd-verify-notes";

/** Sends one plain-text email. No provider is wired yet: the Worker's default throws (see `routes.ts`). */
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

/** Thrown by the default mailer: the email provider is an owner decision and is not configured. */
export class MailNotConfiguredError extends Error {
	constructor() {
		super("no email provider is configured");
		this.name = "MailNotConfiguredError";
	}
}

export const unconfiguredMailer: MailSender = {
	send: () => Promise.reject(new MailNotConfiguredError()),
};
