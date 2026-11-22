// SPDX-License-Identifier: Apache-2.0
/**
 * Test-only Ed25519 signers for the note-document vectors, on WebCrypto (no dependency, no `node:`). The keys are TEST
 * keys, published on purpose: the seed of key `<id>` is sha256 of the UTF-8 text `tfd.note-test-key:<id>`, so anyone can
 * rebuild them. `note-test-1` is the test `receipt` key and `note-test-seal-1` the test `seal` key. Never use them for
 * anything real.
 */
import { sha256Hex, toHex } from "../src/canonical";
import type { DocumentSigner, SigningPurpose } from "../src/documents";

export const TEST_RECEIPT_KEY_ID = "note-test-1";
export const TEST_SEAL_KEY_ID = "note-test-seal-1";

/** The fixed prefix of an Ed25519 PKCS#8 private key; the 32-byte seed follows it. */
const PKCS8_ED25519_PREFIX = Uint8Array.from([
	0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04,
	0x22, 0x04, 0x20,
]);

export const seedLabel = (keyId: string): string =>
	`tfd.note-test-key:${keyId}`;

const fromHex = (hex: string): Uint8Array => {
	const bytes = new Uint8Array(hex.length / 2);
	for (let index = 0; index < bytes.length; index += 1) {
		bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
	}
	return bytes;
};

export interface TestSigner extends DocumentSigner {
	/** 32 raw bytes as hex: what a verifier publishes for the key. */
	publicKeyHex: string;
	verify(message: Uint8Array, signature: Uint8Array): Promise<boolean>;
}

export const makeTestSigner = async (
	keyId: string,
	purpose: SigningPurpose,
): Promise<TestSigner> => {
	const seed = fromHex(await sha256Hex(seedLabel(keyId)));
	const pkcs8 = new Uint8Array(PKCS8_ED25519_PREFIX.length + seed.length);
	pkcs8.set(PKCS8_ED25519_PREFIX);
	pkcs8.set(seed, PKCS8_ED25519_PREFIX.length);
	const privateKey = await crypto.subtle.importKey(
		"pkcs8",
		pkcs8,
		{ name: "Ed25519" },
		true,
		["sign"],
	);
	const jwk = await crypto.subtle.exportKey("jwk", privateKey);
	if (jwk.x === undefined) {
		throw new Error("the Ed25519 key has no public part");
	}
	const publicRaw = Uint8Array.from(
		atob(jwk.x.replaceAll("-", "+").replaceAll("_", "/")),
		(character) => character.charCodeAt(0),
	);
	const publicKey = await crypto.subtle.importKey(
		"raw",
		publicRaw,
		{ name: "Ed25519" },
		true,
		["verify"],
	);
	return {
		keyId,
		purpose,
		publicKeyHex: toHex(publicRaw),
		sign: async (bytes) =>
			new Uint8Array(await crypto.subtle.sign("Ed25519", privateKey, bytes)),
		verify: (message, signature) =>
			crypto.subtle.verify("Ed25519", publicKey, signature, message),
	};
};
