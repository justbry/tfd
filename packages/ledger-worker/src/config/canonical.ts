/**
 * Canonical JSON for the config objects: keys sorted, two-space indent, a trailing newline. Equal content gives equal
 * bytes and so an equal sha256, which is what an ETag, `verifiedHash` and the manifest compare. Worker-safe: WebCrypto
 * only, and the text is built by hand so a `__proto__` key in a body stays data.
 */

const encoder = new TextEncoder();
const INDENT = "  ";

const render = (
	value: unknown,
	indent: string | null,
	depth: string,
): string => {
	if (value === null) return "null";
	if (typeof value === "string" || typeof value === "boolean")
		return JSON.stringify(value);
	if (typeof value === "number") {
		if (!Number.isFinite(value))
			throw new Error("a number in a config object is not finite");
		return JSON.stringify(value);
	}
	if (typeof value !== "object")
		throw new Error(`a ${typeof value} cannot be written as JSON`);
	const inner = indent === null ? "" : `${depth}${indent}`;
	const separator = indent === null ? "," : `,\n`;
	const open = indent === null ? "" : "\n";
	const close = indent === null ? "" : `\n${depth}`;
	if (Array.isArray(value)) {
		if (value.length === 0) return "[]";
		const items = value.map(
			(item) => `${inner}${render(item, indent, `${depth}${indent ?? ""}`)}`,
		);
		return `[${open}${items.join(separator)}${close}]`;
	}
	const keys = Object.keys(value).sort();
	if (keys.length === 0) return "{}";
	const colon = indent === null ? ":" : ": ";
	const members = keys.map(
		(key) =>
			`${inner}${JSON.stringify(key)}${colon}${render(
				(value as Record<string, unknown>)[key],
				indent,
				`${depth}${indent ?? ""}`,
			)}`,
	);
	return `{${open}${members.join(separator)}${close}}`;
};

/** The object's canonical text: sorted keys, two-space indent, one trailing newline. */
export const canonicalJson = (value: unknown): string =>
	`${render(value, INDENT, "")}\n`;

/** One line of an audit file: sorted keys, no spaces, no newline. */
export const canonicalLine = (value: unknown): string =>
	render(value, null, "");

export const bytesOf = (text: string): Uint8Array => encoder.encode(text);

export const sha256Hex = async (bytes: Uint8Array): Promise<string> => {
	const digest = new Uint8Array(
		await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>),
	);
	let hex = "";
	for (const byte of digest) hex += byte.toString(16).padStart(2, "0");
	return hex;
};

export const sha256OfText = (text: string): Promise<string> =>
	sha256Hex(encoder.encode(text));
