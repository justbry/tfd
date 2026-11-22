// SPDX-License-Identifier: Apache-2.0
/**
 * Hygiene for the free-text fields of an event (an annotation, a dispute reason, a payment method and reference, an
 * agent reference). A person can read what these hold, and a reader must see what the bytes say, so none may carry a
 * character that changes how text is shown or hides itself: control characters, the bidirectional controls that reorder
 * what follows, or a zero width no-break space (byte order mark).
 */

const TAB = 0x09;
const LINE_FEED = 0x0a;
const LAST_C0_CONTROL = 0x1f;
const DELETE = 0x7f;
const LAST_C1_CONTROL = 0x9f;
const ARABIC_LETTER_MARK = 0x06_1c;
const LEFT_TO_RIGHT_MARK = 0x20_0e;
const RIGHT_TO_LEFT_MARK = 0x20_0f;
const FIRST_EMBEDDING_CONTROL = 0x20_2a;
const LAST_EMBEDDING_CONTROL = 0x20_2e;
const FIRST_ISOLATE_CONTROL = 0x20_66;
const LAST_ISOLATE_CONTROL = 0x20_69;
const BYTE_ORDER_MARK = 0xfe_ff;

export interface UnsafeCharacter {
	/** The code point, as `U+202E`. */
	label: string;
	/** Its position counted in code points. */
	position: number;
}

const isBidiControl = (codePoint: number): boolean =>
	codePoint === ARABIC_LETTER_MARK ||
	codePoint === LEFT_TO_RIGHT_MARK ||
	codePoint === RIGHT_TO_LEFT_MARK ||
	(codePoint >= FIRST_EMBEDDING_CONTROL &&
		codePoint <= LAST_EMBEDDING_CONTROL) ||
	(codePoint >= FIRST_ISOLATE_CONTROL && codePoint <= LAST_ISOLATE_CONTROL);

const isUnsafe = (codePoint: number, allowLayout: boolean): boolean => {
	if (codePoint === TAB || codePoint === LINE_FEED) {
		return !allowLayout;
	}
	return (
		codePoint <= LAST_C0_CONTROL ||
		(codePoint >= DELETE && codePoint <= LAST_C1_CONTROL) ||
		isBidiControl(codePoint) ||
		codePoint === BYTE_ORDER_MARK
	);
};

/**
 * The first character of `text` that must not appear, or null. U+0000 to U+001F and U+007F to U+009F are control
 * characters, except that a field that holds several lines (`allowLayout`) may carry `\n` and `\t`. The bidirectional
 * controls U+061C, U+200E, U+200F, U+202A to U+202E and U+2066 to U+2069, and U+FEFF, are never allowed.
 */
export const findUnsafeCharacter = (
	text: string,
	allowLayout: boolean,
): UnsafeCharacter | null => {
	let position = 0;
	for (const character of text) {
		const codePoint = character.codePointAt(0) ?? 0;
		if (isUnsafe(codePoint, allowLayout)) {
			const hex = codePoint.toString(16).toUpperCase().padStart(4, "0");
			return { label: `U+${hex}`, position };
		}
		position += 1;
	}
	return null;
};
