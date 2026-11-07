/**
 * EdDSA (Ed25519) JWT verification on WebCrypto only (workerd has Ed25519 in `crypto.subtle`). The same checks as
 * `verifyJwt` in buzz-school's `packages/family-service/src/ledger/jwt.ts`, the signer's reference: the key comes from
 * the JWKS by the header's `kid`, never from the token; `aud` is exactly the one string; `iat` is required, and so is a
 * lifetime of at most `MAX_LIFETIME_SECONDS`.
 */

export type Jwk = {
	kty: "OKP";
	crv: "Ed25519";
	x: string;
	kid: string;
	use?: string;
	alg?: string;
};

export type Jwks = { keys: Jwk[] };

export type VerifyFailure =
	| "malformed"
	| "alg"
	| "unknown_kid"
	| "signature"
	| "iss"
	| "aud"
	| "expired"
	| "not_yet"
	| "lifetime";

export type Verified =
	| { ok: true; claims: Record<string, unknown> }
	| { ok: false; reason: VerifyFailure };

export type VerifyOptions = {
	iss: string;
	aud: string;
	/** Unix seconds. */
	now: number;
	/** Applied to `iat` and `nbf` only: how far ahead of this clock the issuer's may run. */
	leewaySeconds?: number;
	maxLifetimeSeconds?: number;
};

/** The longest a ledger token may live (`exp - iat`). */
export const MAX_LIFETIME_SECONDS = 300;
export const LEDGER_AUDIENCE = "atm-ledger";

const BASE64URL = /^[A-Za-z0-9_-]*$/;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const base64urlEncode = (bytes: Uint8Array): string => {
	let text = "";
	for (const byte of bytes) text += String.fromCharCode(byte);
	return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

export const base64urlDecode = (
	text: string,
): Uint8Array<ArrayBuffer> | null => {
	if (!BASE64URL.test(text)) return null;
	try {
		const raw = atob(
			text
				.replace(/-/g, "+")
				.replace(/_/g, "/")
				.padEnd(Math.ceil(text.length / 4) * 4, "="),
		);
		return Uint8Array.from(raw, (char) => char.charCodeAt(0));
	} catch {
		return null;
	}
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

/** The header's `kid` of a token, or null when it has none; the JWKS cache reads it to decide on a refetch. */
export const kidOf = (token: string): string | null => {
	const header = base64urlDecode(token.split(".")[0] ?? "");
	if (header === null) return null;
	try {
		const parsed: unknown = JSON.parse(decoder.decode(header));
		return isRecord(parsed) && typeof parsed.kid === "string"
			? parsed.kid
			: null;
	} catch {
		return null;
	}
};

const signatureHolds = async (
	jwk: Jwk,
	signature: Uint8Array<ArrayBuffer>,
	signed: string,
): Promise<boolean> => {
	try {
		const key = await crypto.subtle.importKey(
			"jwk",
			{ kty: "OKP", crv: "Ed25519", x: jwk.x },
			{ name: "Ed25519" },
			false,
			["verify"],
		);
		return await crypto.subtle.verify(
			{ name: "Ed25519" },
			key,
			signature,
			encoder.encode(signed),
		);
	} catch {
		return false;
	}
};

/** Checks the signature against the JWKS key the header's `kid` names, then `iss`, `aud`, `exp`, `iat` and `nbf`. */
export const verifyJwt = async (
	token: string,
	jwks: Jwks,
	options: VerifyOptions,
): Promise<Verified> => {
	const parts = token.split(".");
	if (parts.length !== 3) return { ok: false, reason: "malformed" };
	const [headerText = "", payloadText = "", signatureText = ""] = parts;
	const headerBytes = base64urlDecode(headerText);
	const payloadBytes = base64urlDecode(payloadText);
	const signature = base64urlDecode(signatureText);
	if (!(headerBytes && payloadBytes && signature))
		return { ok: false, reason: "malformed" };
	let header: unknown;
	let claims: unknown;
	try {
		header = JSON.parse(decoder.decode(headerBytes));
		claims = JSON.parse(decoder.decode(payloadBytes));
	} catch {
		return { ok: false, reason: "malformed" };
	}
	if (!(isRecord(header) && isRecord(claims)))
		return { ok: false, reason: "malformed" };
	if (header.alg !== "EdDSA") return { ok: false, reason: "alg" };
	const jwk =
		typeof header.kid === "string"
			? jwks.keys.find((key) => key.kid === header.kid)
			: undefined;
	if (jwk === undefined) return { ok: false, reason: "unknown_kid" };
	if (!(await signatureHolds(jwk, signature, `${headerText}.${payloadText}`)))
		return { ok: false, reason: "signature" };
	if (claims.iss !== options.iss) return { ok: false, reason: "iss" };
	// the one string, exactly: an array that merely includes it is a token for several audiences, which is never minted
	if (claims.aud !== options.aud) return { ok: false, reason: "aud" };
	const { exp, iat, nbf } = claims;
	if (typeof exp !== "number" || exp <= options.now)
		return { ok: false, reason: "expired" };
	if (typeof iat !== "number") return { ok: false, reason: "malformed" };
	const leeway = options.leewaySeconds ?? 0;
	if (iat - leeway > options.now) return { ok: false, reason: "not_yet" };
	if (exp - iat > (options.maxLifetimeSeconds ?? MAX_LIFETIME_SECONDS))
		return { ok: false, reason: "lifetime" };
	if (typeof nbf === "number" && nbf - leeway > options.now)
		return { ok: false, reason: "not_yet" };
	return { ok: true, claims };
};
