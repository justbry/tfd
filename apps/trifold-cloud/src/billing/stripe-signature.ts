/** Stripe's default tolerance: a signature older (or newer) than this is refused. */
export const SIGNATURE_TOLERANCE_SECONDS = 300;

export type SignatureCheck =
	| { ok: true; timestamp: number }
	| { ok: false; reason: "missing" | "malformed" | "stale" | "mismatch" };

const encoder = new TextEncoder();
const DIGITS = /^\d+$/;

const hex = (bytes: ArrayBuffer): string =>
	[...new Uint8Array(bytes)]
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");

/** Compares two equal-length hex strings without stopping at the first difference. */
const sameHex = (left: string, right: string): boolean => {
	if (left.length !== right.length) return false;
	let difference = 0;
	for (let index = 0; index < left.length; index += 1)
		difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
	return difference === 0;
};

const hmacHex = async (secret: string, message: string): Promise<string> => {
	const key = await crypto.subtle.importKey(
		"raw",
		encoder.encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	return hex(await crypto.subtle.sign("HMAC", key, encoder.encode(message)));
};

/**
 * Stripe's `constructEvent` check on WebCrypto: HMAC-SHA256 of `<t>.<raw body>` with the endpoint's secret against
 * every `v1` in the `Stripe-Signature` header, and `t` within the tolerance of `nowMs`. The body must be the raw text.
 */
export const verifyStripeSignature = async (input: {
	payload: string;
	header: string | null;
	secret: string;
	nowMs: number;
	toleranceSeconds?: number;
}): Promise<SignatureCheck> => {
	if (!input.header) return { ok: false, reason: "missing" };
	let timestamp: number | null = null;
	const signatures: string[] = [];
	for (const part of input.header.split(",")) {
		const [name, value] = part.split("=", 2).map((piece) => piece.trim());
		if (name === "t" && value && DIGITS.test(value)) timestamp = Number(value);
		if (name === "v1" && value) signatures.push(value);
	}
	if (timestamp === null || signatures.length === 0)
		return { ok: false, reason: "malformed" };
	const tolerance = input.toleranceSeconds ?? SIGNATURE_TOLERANCE_SECONDS;
	if (Math.abs(input.nowMs / 1000 - timestamp) > tolerance)
		return { ok: false, reason: "stale" };
	const expected = await hmacHex(input.secret, `${timestamp}.${input.payload}`);
	return signatures.some((signature) => sameHex(signature, expected))
		? { ok: true, timestamp }
		: { ok: false, reason: "mismatch" };
};

/** A `Stripe-Signature` header for a payload, for tests. */
export const signStripePayload = async (input: {
	payload: string;
	secret: string;
	timestampSeconds: number;
}): Promise<string> =>
	`t=${input.timestampSeconds},v1=${await hmacHex(input.secret, `${input.timestampSeconds}.${input.payload}`)}`;
