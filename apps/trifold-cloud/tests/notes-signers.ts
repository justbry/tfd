/**
 * Test-only Ed25519 signers for the note documents, on WebCrypto (the same idea as packages/tfd-notes/tests/note-signer.ts,
 * copied so no test imports across packages). The keys are TEST keys, published on purpose: the seed of key `<id>` is
 * sha256 of the UTF-8 text `tfd.note-test-key:<id>`. `note-test-1` is the test `receipt` key and `note-test-seal-1` the
 * test `seal` key. Never use them for anything real.
 */
import { type DocumentSigner, sha256Hex, toHex } from "tfd-notes";
import type { KeysInput } from "tfd-verify-notes";
import type { DocumentSigners } from "../src/notes/documents-service";

export const TEST_RECEIPT_KEY_ID = "note-test-1";
export const TEST_SEAL_KEY_ID = "note-test-seal-1";

/** The fixed prefix of an Ed25519 PKCS#8 private key; the 32-byte seed follows it. */
const PKCS8_ED25519_PREFIX = Uint8Array.from([
	0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04,
	0x22, 0x04, 0x20,
]);
const SPKI_PREFIX_HEX = "302a300506032b6570032100";

const fromHex = (hex: string): Uint8Array =>
	Uint8Array.from(hex.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16));

export interface TestSigner extends DocumentSigner {
	/** 32 raw bytes as hex: what a verifier publishes for the key. */
	publicKeyHex: string;
}

export const makeTestSigner = async (
	keyId: string,
	purpose: "receipt" | "seal",
): Promise<TestSigner> => {
	const seed = fromHex(await sha256Hex(`tfd.note-test-key:${keyId}`));
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
	if (jwk.x === undefined)
		throw new Error("the Ed25519 key has no public part");
	const publicRaw = Uint8Array.from(
		atob(jwk.x.replaceAll("-", "+").replaceAll("_", "/")),
		(character) => character.charCodeAt(0),
	);
	return {
		keyId,
		purpose,
		publicKeyHex: toHex(publicRaw),
		sign: async (bytes) =>
			new Uint8Array(await crypto.subtle.sign("Ed25519", privateKey, bytes)),
	};
};

export interface TestSigning {
	signers: DocumentSigners & { receipt: TestSigner; seal: TestSigner };
	/** The published public keys with purpose and window, as a verifier reads them. */
	keys: KeysInput;
}

const pemOfPublicHex = (publicKeyHex: string): string =>
	`-----BEGIN PUBLIC KEY-----\n${btoa(String.fromCharCode(...fromHex(`${SPKI_PREFIX_HEX}${publicKeyHex}`)))}\n-----END PUBLIC KEY-----\n`;

export const testSigning = async (): Promise<TestSigning> => {
	const receipt = await makeTestSigner(TEST_RECEIPT_KEY_ID, "receipt");
	const seal = await makeTestSigner(TEST_SEAL_KEY_ID, "seal");
	const window = { not_before: "2026-01-01T00:00:00Z", not_after: null };
	return {
		signers: { receipt, seal },
		keys: {
			[TEST_RECEIPT_KEY_ID]: {
				pem: pemOfPublicHex(receipt.publicKeyHex),
				purpose: "receipt",
				...window,
			},
			[TEST_SEAL_KEY_ID]: {
				pem: pemOfPublicHex(seal.publicKeyHex),
				purpose: "seal",
				...window,
			},
		} as KeysInput,
	};
};
