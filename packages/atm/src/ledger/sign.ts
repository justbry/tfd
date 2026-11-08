// SPDX-License-Identifier: Apache-2.0
import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { Ajv2020, type ValidateFunction } from "ajv/dist/2020.js";
import type {
	AtmPublicKeys,
	AtmSigner,
	KeyUseVerdict,
	TfdKeyEntry,
	TfdKeyPurpose,
} from "../types.js";

/** Receipts and seals are signed with Ed25519 only: deterministic (RFC 8032), so the same bytes and key give the same signature. */
const ED25519 = "ed25519";

const encoder = new TextEncoder();

/** `sig` of `text` (its UTF-8 bytes), base64url without padding. Throws naming the key type when the key is not an Ed25519 private key. */
export const signBytes = (text: string, signer: AtmSigner): string => {
	const key = createPrivateKey(signer.privateKeyPem);
	if (key.asymmetricKeyType !== ED25519)
		throw new Error(
			`signing needs an Ed25519 private key; ${signer.keyId} is ${key.asymmetricKeyType ?? key.type}`,
		);
	return sign(null, encoder.encode(text), key).toString("base64url");
};

const PURPOSES: readonly string[] = ["receipt", "seal", "directory"];

const isInstant = (value: unknown): value is string =>
	typeof value === "string" && !Number.isNaN(Date.parse(value));

/** A keys-file entry in either form; an object that is not a whole `TfdKeyEntry` is not a key. */
type KeyEntry = { pem: string; use: TfdKeyEntry | null };

/**
 * The key published as `keyId`: its PEM, and its purpose and window when the entry is the object form (`use: null` for
 * the first form, a bare PEM). An entry missing a field, or with a field of the wrong type or an unreadable time, is
 * `null` (the verifiers call that `unknown_key`). Never throws.
 */
export const keyEntryOf = (
	keys: AtmPublicKeys,
	keyId: string,
): KeyEntry | null => {
	const entry: unknown = Object.hasOwn(keys, keyId) ? keys[keyId] : undefined;
	if (typeof entry === "string") return { pem: entry, use: null };
	if (typeof entry !== "object" || entry === null || Array.isArray(entry))
		return null;
	const { pem, purpose, not_before, not_after, revoked_at } = entry as Record<
		string,
		unknown
	>;
	const whole =
		typeof pem === "string" &&
		typeof purpose === "string" &&
		PURPOSES.includes(purpose) &&
		isInstant(not_before) &&
		(not_after === null || isInstant(not_after)) &&
		(revoked_at === undefined || isInstant(revoked_at));
	return whole ? { pem, use: entry as TfdKeyEntry } : null;
};

/**
 * Whether the key that made a good signature vouches for the document: never once revoked (whatever `at` says), then the
 * purpose, then `at` (the document's signed time, `null` for a v1 receipt, which has none) in `[not_before, not_after)`.
 * The first-form key vouches for anything, as before windows. Call it only after the signature verified.
 */
export const keyUse = (
	keys: AtmPublicKeys,
	keyId: string,
	purpose: TfdKeyPurpose,
	at: string | null,
): "ok" | KeyUseVerdict => {
	const use = keyEntryOf(keys, keyId)?.use;
	if (!use) return "ok";
	if (use.revoked_at !== undefined) return "key_revoked";
	if (use.purpose !== purpose) return "key_wrong_purpose";
	if (at === null) return "ok";
	const time = Date.parse(at);
	const inWindow =
		time >= Date.parse(use.not_before) &&
		(use.not_after === null || time < Date.parse(use.not_after));
	return inWindow ? "ok" : "outside_key_window";
};

/**
 * Whether `sig` is an Ed25519 signature of `text` by the key published as `keyId`. A key id `keys` does not hold, or holds
 * as anything but an Ed25519 public key, is `unknown_key`. A `sig` that is not the one base64url spelling of 64 bytes is
 * `bad_signature`. Never throws.
 */
export const verifyBytes = (
	text: string,
	keyId: string,
	sig: string,
	keys: AtmPublicKeys,
): "ok" | "unknown_key" | "bad_signature" => {
	const pem = keyEntryOf(keys, keyId)?.pem;
	if (pem === undefined) return "unknown_key";
	let key: ReturnType<typeof createPublicKey>;
	try {
		key = createPublicKey(pem);
	} catch {
		return "unknown_key";
	}
	if (key.asymmetricKeyType !== ED25519) return "unknown_key";
	const bytes = Buffer.from(sig, "base64url");
	if (bytes.toString("base64url") !== sig) return "bad_signature";
	return verify(null, encoder.encode(text), key, bytes)
		? "ok"
		: "bad_signature";
};

/** A shape check from one of `schema/`'s signed-document schemas, compiled on first use. */
export const shapeCheck = (
	schema: Record<string, unknown>,
): ((value: unknown) => boolean) => {
	let check: ValidateFunction | null = null;
	return (value) => {
		check ??= new Ajv2020({ strict: false }).compile(schema);
		return check(value);
	};
};
