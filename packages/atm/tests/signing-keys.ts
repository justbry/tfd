/**
 * The test keys receipts and seals are signed with. Nothing key-like is committed: each private key is made here from a
 * fixed seed (sha256 of a phrase, wrapped as Ed25519 PKCS#8), and because Ed25519 is deterministic the golden receipt's
 * signature can be pinned. Only the public key's fingerprint is pinned (tests/golden/receipt/key.json).
 */
import { createHash, createPrivateKey, createPublicKey } from "node:crypto";
import type { AtmPublicKeys, AtmSigner } from "../src/types.js";

/** The fixed DER prefix of an Ed25519 PKCS#8 private key (RFC 8410); the 32-byte seed follows it. */
const ED25519_PKCS8_PREFIX = "302e020100300506032b657004220420";

const keyFromPhrase = (phrase: string) =>
	createPrivateKey({
		key: Buffer.concat([
			Buffer.from(ED25519_PKCS8_PREFIX, "hex"),
			createHash("sha256").update(phrase).digest(),
		]),
		format: "der",
		type: "pkcs8",
	});

const signerFrom = (keyId: string, phrase: string) => {
	const key = keyFromPhrase(phrase);
	const signer: AtmSigner = {
		keyId,
		privateKeyPem: String(key.export({ format: "pem", type: "pkcs8" })),
	};
	const publicKeyPem = String(
		createPublicKey(key).export({ format: "pem", type: "spki" }),
	);
	return { signer, publicKeyPem };
};

export const TEST_KEY_ID = "atm-test-1";

const main = signerFrom(TEST_KEY_ID, "atm test key v1");
const other = signerFrom("atm-test-other", "atm test key other");

export const testSigner: AtmSigner = main.signer;
/** A second key, published under no id in `testKeys`. */
export const otherSigner: AtmSigner = other.signer;
export const testKeys: AtmPublicKeys = { [TEST_KEY_ID]: main.publicKeyPem };

/** sha256 (hex) of the test public key's SPKI DER: what pins the key. */
export const testKeyFingerprint = (): string =>
	createHash("sha256")
		.update(
			createPublicKey(main.publicKeyPem).export({
				format: "der",
				type: "spki",
			}),
		)
		.digest("hex");

const fingerprintOf = (publicKeyPem: string): string =>
	createHash("sha256")
		.update(
			createPublicKey(publicKeyPem).export({ format: "der", type: "spki" }),
		)
		.digest("hex");

/** When the October keys were revoked: after it, they fail everything they ever signed. */
export const REVOKED_AT = "2026-11-05T00:00:00Z";

/**
 * Keys with a purpose and a window (the second keys-file form), as Trifold rotates them monthly: October's receipt and
 * seal keys, revoked, and November's, current. Each is made from its phrase, like the test key; the receipt v2 vectors
 * (tests/golden/receipt-v2/keys.json) pin their fingerprints and windows.
 */
const WINDOWED = [
	{
		keyId: "trifold-test-2026-10",
		phrase: "tfd test receipt key 2026-10",
		purpose: "receipt",
		not_before: "2026-10-01T00:00:00Z",
		not_after: "2026-11-01T00:00:00Z",
		revoked_at: REVOKED_AT,
	},
	{
		keyId: "trifold-test-2026-11",
		phrase: "tfd test receipt key 2026-11",
		purpose: "receipt",
		not_before: "2026-11-01T00:00:00Z",
		not_after: null,
	},
	{
		keyId: "trifold-test-seal-2026-10",
		phrase: "tfd test seal key 2026-10",
		purpose: "seal",
		not_before: "2026-10-01T00:00:00Z",
		not_after: "2026-11-01T00:00:00Z",
		revoked_at: REVOKED_AT,
	},
	{
		keyId: "trifold-test-seal-2026-11",
		phrase: "tfd test seal key 2026-11",
		purpose: "seal",
		not_before: "2026-11-01T00:00:00Z",
		not_after: null,
	},
] as const;

type WindowedId = (typeof WINDOWED)[number]["keyId"];

const windowed = WINDOWED.map(({ keyId, phrase, ...use }) => ({
	keyId,
	use,
	...signerFrom(keyId, phrase),
}));

/** The windowed keys' signers, by key id. */
export const windowedSigners = Object.fromEntries(
	windowed.map(({ keyId, signer }) => [keyId, signer]),
) as Record<WindowedId, AtmSigner>;

/** The keys file of the windowed keys: `{ key_id: { pem, purpose, not_before, not_after, revoked_at? } }`. */
export const windowedKeys: AtmPublicKeys = Object.fromEntries(
	windowed.map(({ keyId, use, publicKeyPem }) => [
		keyId,
		{ pem: publicKeyPem, ...use },
	]),
);

/** What the vectors pin of each windowed key: its fingerprint and window, never the PEM. */
export const windowedKeysPinned = Object.fromEntries(
	windowed.map(({ keyId, use, publicKeyPem }) => [
		keyId,
		{ spki_sha256: fingerprintOf(publicKeyPem), ...use },
	]),
);
