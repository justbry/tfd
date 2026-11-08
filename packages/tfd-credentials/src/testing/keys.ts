/**
 * Test keys. The secret is derived from a label (SHA-256 of it) at run time, so no key material is ever a literal in
 * a repository, and it stays inside the returned signer. Never use these for real credentials.
 */
import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256Bytes, utf8 } from "../bytes.js";
import { encodeEd25519Multikey } from "../multikey.js";
import type { Signer } from "../proof.js";

export type TestKey = {
	publicKey: Uint8Array;
	publicKeyMultibase: string;
	/** A `Signer` for this key under the given verification method id. */
	signer(keyId: string): Signer;
};

export const createTestKey = (label: string): TestKey => {
	const seed = sha256Bytes(utf8(`tfd-credentials test key: ${label}`));
	const publicKey = ed25519.getPublicKey(seed);
	return {
		publicKey,
		publicKeyMultibase: encodeEd25519Multikey(publicKey),
		signer: (keyId) => ({
			keyId,
			sign: async (bytes) => ed25519.sign(bytes, seed),
		}),
	};
};

/** Deterministic `RandomBytes` for tests: SHA-256 of label and a counter, as a stream. */
export const seededRandomBytes = (
	label: string,
): ((length: number) => Uint8Array) => {
	let counter = 0;
	let pool = new Uint8Array(0);
	return (length) => {
		while (pool.length < length) {
			const block = sha256Bytes(utf8(`${label}:${counter++}`));
			const grown = new Uint8Array(pool.length + block.length);
			grown.set(pool);
			grown.set(block, pool.length);
			pool = grown;
		}
		const out = pool.slice(0, length);
		pool = pool.slice(length);
		return out;
	};
};
