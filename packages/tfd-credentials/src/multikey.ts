/**
 * Ed25519 Multikey (Controlled Identifiers v1.0 §2.2.2, https://www.w3.org/TR/cid-1.0/#Multikey): the two-byte
 * multicodec prefix 0xed01 (varint of 0xed, ed25519-pub), then the 32-byte public key, base58btc with header `z`.
 */
import { CredentialsError } from "./errors.js";
import { decodeMultibaseBase58btc, multibaseBase58btc } from "./multibase.js";

const ED25519_PUBLIC_PREFIX = [0xed, 0x01] as const;
const ED25519_PUBLIC_KEY_LENGTH = 32;

export const encodeEd25519Multikey = (publicKey: Uint8Array): string => {
	if (publicKey.length !== ED25519_PUBLIC_KEY_LENGTH) {
		throw new CredentialsError(
			"multikey_invalid",
			`an Ed25519 public key is ${ED25519_PUBLIC_KEY_LENGTH} bytes, not ${publicKey.length}`,
		);
	}
	const bytes = new Uint8Array(2 + ED25519_PUBLIC_KEY_LENGTH);
	bytes.set(ED25519_PUBLIC_PREFIX, 0);
	bytes.set(publicKey, 2);
	return multibaseBase58btc(bytes);
};

/** The 32 raw public key bytes. Throws `multikey_invalid` for another header, codec or length. */
export const decodeEd25519Multikey = (
	publicKeyMultibase: string,
): Uint8Array => {
	let bytes: Uint8Array;
	try {
		bytes = decodeMultibaseBase58btc(publicKeyMultibase);
	} catch {
		throw new CredentialsError(
			"multikey_invalid",
			"publicKeyMultibase is not base58btc multibase",
		);
	}
	if (
		bytes.length !== 2 + ED25519_PUBLIC_KEY_LENGTH ||
		bytes[0] !== ED25519_PUBLIC_PREFIX[0] ||
		bytes[1] !== ED25519_PUBLIC_PREFIX[1]
	) {
		throw new CredentialsError(
			"multikey_invalid",
			"publicKeyMultibase is not an Ed25519 public key (prefix 0xed01, 32 bytes)",
		);
	}
	return bytes.slice(2);
};
