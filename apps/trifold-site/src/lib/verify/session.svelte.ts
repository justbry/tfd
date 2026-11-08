/**
 * One verifier's state, shared by the inline (homepage) and full (/verify) verifiers. The crypto loads on the first
 * check, so pages that only show the verifier pay nothing for it up front.
 */

import type { PublicKeys } from "tfd-verify";
import type { Books, Outcome } from "tfd-verify/check";
import publicKey from "#lib/samples/public-key.json";
import sample from "#lib/samples/receipt.json";
import tampered from "#lib/samples/receipt-tampered.json";
import { SCHOOL_NAMES } from "#lib/samples/sample";
import type { Report } from "./report";
import { fingerprintOf } from "./signet";

const SAMPLE_KEYS = publicKey.keys as PublicKeys;
/** The proof sweep: long enough that the check reads as a step, short enough that the whole reveal stays under ~1s. */
const SWEEP_MS = 450;

export const SAMPLE_TEXT = JSON.stringify(sample, null, 2);
export const TAMPERED_TEXT = JSON.stringify(tampered, null, 2);
export const TAMPERED_CENTS = tampered.receipt.amount;

const loadBooks = async (school: string): Promise<Books | null> => {
	if (school !== publicKey.school) return null;
	return (await import("#lib/samples/books.json")).default as unknown as Books;
};

export const preloadVerifier = () =>
	Promise.all([
		import("tfd-verify/check"),
		import("tfd-verify"),
		import("./report"),
	]);

export const orgName = (school: string): string =>
	SCHOOL_NAMES[school] ?? school;

/** The month's latest seal's sealed_at in a books copy, if any. */
const sealedAtOf = (books: Books | null, month: string): string | null => {
	let sealedAt: string | null = null;
	for (const raw of books?.seals ?? []) {
		const body = (raw as { seal?: { month?: unknown; sealed_at?: unknown } })
			.seal;
		if (body?.month === month && typeof body.sealed_at === "string")
			sealedAt = body.sealed_at;
	}
	return sealedAt;
};

export class VerifierSession {
	text = $state("");
	keysText = $state("");
	keysError = $state("");
	checking = $state(false);
	outcome = $state<Outcome | null>(null);
	report = $state<Report | null>(null);
	/** 8 hex of the signed bytes' SHA-256, when the input has a receipt object. */
	fingerprint = $state<string | null>(null);
	/** The receipt as parsed, for the details and the raw view. */
	parsed = $state<unknown>(null);
	which = $state<"sample" | "tampered" | "own">("own");

	/** The receipt card's light: green on a clean pass, clay on anything else. */
	get cardState(): "idle" | "pass" | "fail" {
		if (this.report === null) return "idle";
		return this.report.tone === "pass" ? "pass" : "fail";
	}

	get started(): boolean {
		return this.checking || this.outcome !== null;
	}

	keys(): PublicKeys | null {
		this.keysError = "";
		if (!this.keysText.trim()) return SAMPLE_KEYS;
		try {
			const parsed = JSON.parse(this.keysText) as unknown;
			const map =
				typeof parsed === "object" && parsed !== null && "keys" in parsed
					? (parsed as { keys: unknown }).keys
					: parsed;
			if (typeof map !== "object" || map === null || Array.isArray(map))
				throw new Error("not an object");
			return map as PublicKeys;
		} catch {
			this.keysError =
				'Keys must be JSON like { "key_id": "-----BEGIN PUBLIC KEY-----…" }.';
			return null;
		}
	}

	async verify(source: string = this.text): Promise<void> {
		const keys = this.keys();
		if (!keys) return;
		this.checking = true;
		this.outcome = null;
		this.report = null;
		this.fingerprint = null;
		let value: unknown;
		try {
			value = JSON.parse(source);
		} catch {
			value = source;
		}
		this.parsed = value;
		const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
		try {
			const [{ checkReceipt }, { canonicalize }, { reportOf }] =
				await preloadVerifier();
			const [result, fingerprint] = await Promise.all([
				checkReceipt(value, keys, loadBooks),
				fingerprintOf(value, canonicalize),
				new Promise((resolve) => setTimeout(resolve, reduced ? 0 : SWEEP_MS)),
			]);
			const signed = result.kind === "signed" ? result.signed : null;
			const keyId = signed?.key_id ?? ("keyId" in result ? result.keyId : null);
			const books = signed ? await loadBooks(signed.receipt.school) : null;
			this.fingerprint = fingerprint;
			this.report = reportOf(result, {
				orgName,
				keyEntry: keyId ? keys[keyId] : undefined,
				keySource: this.keysText.trim() ? "custom" : "sample",
				sealedAt: signed
					? sealedAtOf(books, signed.receipt.date.slice(0, 7))
					: null,
			});
			this.outcome = result;
		} finally {
			// A failed chunk load (e.g. after a deploy) must not leave the verifier stuck on "checking".
			this.checking = false;
		}
	}

	load(kind: "sample" | "tampered", run = true): void {
		this.which = kind;
		this.text = kind === "sample" ? SAMPLE_TEXT : TAMPERED_TEXT;
		this.keysText = "";
		if (run) void this.verify();
	}

	reset(): void {
		this.text = "";
		this.outcome = null;
		this.report = null;
		this.fingerprint = null;
		this.parsed = null;
		this.which = "own";
	}
}
