/** Ed25519 test keys and tokens, on WebCrypto, as the family service signs them (`signerFromSeed`, `signJwt` in buzz-school). */
import { base64urlEncode } from "../auth/jwt.js";

const encoder = new TextEncoder();
const SEED_BYTES = 32;
// RFC 8410 PrivateKeyInfo for an Ed25519 seed: this prefix, then the 32-byte seed
const PKCS8_PREFIX = Uint8Array.from([
	0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04,
	0x22, 0x04, 0x20,
]);

export type TestJwk = {
	kty: "OKP";
	crv: "Ed25519";
	x: string;
	kid: string;
	use: "sig";
	alg: "EdDSA";
};

export type TestSigner = { kid: string; key: CryptoKey; jwk: TestJwk };

/** RFC 7638 thumbprint of the public key: the `kid`. */
const thumbprint = async (x: string): Promise<string> =>
	base64urlEncode(
		new Uint8Array(
			await crypto.subtle.digest(
				"SHA-256",
				encoder.encode(`{"crv":"Ed25519","kty":"OKP","x":"${x}"}`),
			),
		),
	);

/** The signer for a seed of 32 bytes each equal to `fill`; two fills are two keys. */
export const testSigner = async (fill: number): Promise<TestSigner> => {
	const pkcs8 = new Uint8Array(PKCS8_PREFIX.length + SEED_BYTES);
	pkcs8.set(PKCS8_PREFIX);
	pkcs8.set(new Uint8Array(SEED_BYTES).fill(fill), PKCS8_PREFIX.length);
	const exportable = await crypto.subtle.importKey(
		"pkcs8",
		pkcs8,
		{ name: "Ed25519" },
		true,
		["sign"],
	);
	const { x } = (await crypto.subtle.exportKey("jwk", exportable)) as {
		x?: string;
	};
	if (x === undefined) throw new Error("no public key");
	const key = await crypto.subtle.importKey(
		"pkcs8",
		pkcs8,
		{ name: "Ed25519" },
		false,
		["sign"],
	);
	const kid = await thumbprint(x);
	return {
		kid,
		key,
		jwk: { kty: "OKP", crv: "Ed25519", x, kid, use: "sig", alg: "EdDSA" },
	};
};

const part = (value: unknown): string =>
	base64urlEncode(encoder.encode(JSON.stringify(value)));

/** A token with exactly these claims and header; the header defaults to what the family service writes. */
export const signToken = async (
	signer: TestSigner,
	claims: Record<string, unknown>,
	header: Record<string, unknown> = {},
): Promise<string> => {
	const head = part({ alg: "EdDSA", typ: "JWT", kid: signer.kid, ...header });
	const body = part(claims);
	const signature = new Uint8Array(
		await crypto.subtle.sign(
			{ name: "Ed25519" },
			signer.key,
			encoder.encode(`${head}.${body}`),
		),
	);
	return `${head}.${body}.${base64urlEncode(signature)}`;
};
