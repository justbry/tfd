import { sha256Hex } from "tfd-notes";
import { constantTimeEqual } from "./sessions";

/**
 * Note ids carry a keyed MAC, so a request can be told apart from a guess before anything is read or written: an id that
 * was never made here is refused without touching a Durable Object (a Durable Object exists the moment it is addressed).
 *
 * `nt_<32 hex of sha256(caller, idem)>.<16 hex of HMAC-SHA-256(NOTES_SESSION_SECRET, "nt_<32 hex>")>`. The same
 * `(caller, idem)` pair still names the same note, so a create is idempotent as before.
 */

/** The shortest secret the notes routes accept. */
export const MIN_SECRET_LENGTH = 32;

const ID_HEX_LENGTH = 32;
const MAC_HEX_LENGTH = 16;
const HEX_RADIX = 16;
const HEX_BYTE_WIDTH = 2;
const ENCODER = new TextEncoder();
const NOTE_ID_PATTERN = /^(nt_[0-9a-f]{32})\.([0-9a-f]{16})$/;

const macHex = async (secret: string, message: string): Promise<string> => {
	const key = await crypto.subtle.importKey(
		"raw",
		ENCODER.encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const signature = new Uint8Array(
		await crypto.subtle.sign("HMAC", key, ENCODER.encode(message)),
	);
	return [...signature]
		.map((byte) => byte.toString(HEX_RADIX).padStart(HEX_BYTE_WIDTH, "0"))
		.join("")
		.slice(0, MAC_HEX_LENGTH);
};

/** The note id for a `(caller, idem)` pair: the same pair always names the same note, so a retry finds it. */
export const noteIdFor = async (
	secret: string,
	caller: string,
	idem: string,
): Promise<string> => {
	const prefix = `nt_${(await sha256Hex(`tfd.note-id.v1:${caller}\n${idem}`)).slice(0, ID_HEX_LENGTH)}`;
	return `${prefix}.${await macHex(secret, prefix)}`;
};

/** True only for an id `noteIdFor` made under this secret. Malformed and forged ids are the same `false`. */
export const isValidNoteId = async (
	secret: string,
	id: string,
): Promise<boolean> => {
	const matched = NOTE_ID_PATTERN.exec(id);
	if (matched === null) return false;
	const expected = await macHex(secret, matched[1] as string);
	return constantTimeEqual(expected, matched[2] as string);
};
