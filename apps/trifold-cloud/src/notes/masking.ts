/**
 * Email helpers for the guest flow. An address is kept only in the note's contact record; a page that says who
 * confirmed something shows the masked form and the wording "confirmed by the holder of <masked email>" (plan D2).
 * The page never says "signature" or "signed": nobody signed anything, a person opened a link sent to that address.
 */

const MAX_EMAIL_LENGTH = 254;
const EMAIL_PATTERN = /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/;

/** Trims and lowercases an address, the form it is stored and compared in. */
export const normalizeEmail = (email: string): string =>
	email.trim().toLowerCase();

/** True for a plain address with one `@`, a dot in the domain, no spaces, quotes or angle brackets, at most 254 characters. */
export const isPlausibleEmail = (email: string): boolean =>
	email.length <= MAX_EMAIL_LENGTH &&
	EMAIL_PATTERN.test(email) &&
	email.split("@").length === 2;

const maskWord = (word: string): string =>
	word === "" ? "" : `${word[0]}${"*".repeat(word.length - 1)}`;

/**
 * Masks an address by keeping the first character of the name and of the domain's first label, and the final label
 * (the top-level domain): every other character of the name and of that first label becomes `*`, and the count of
 * stars matches the hidden characters so the length is still readable. Middle labels are masked like the first.
 *
 * `ana@example.com` becomes `a**@e******.com`; `maria.lopez@mail.school.org` becomes `m**********@m***.s*****.org`.
 * An input without a single `@` (it should not reach here) is masked whole to its first character.
 */
export const maskEmail = (email: string): string => {
	const at = email.lastIndexOf("@");
	if (at <= 0 || at === email.length - 1) return maskWord(email);
	const name = email.slice(0, at);
	const labels = email.slice(at + 1).split(".");
	const topLevel = labels.pop() ?? "";
	const masked = labels.map(maskWord);
	return `${maskWord(name)}@${[...masked, topLevel].join(".")}`;
};

/** The one phrase a page may use for who confirmed something. Takes the already masked address (`maskEmail`). */
export const confirmedByWording = (maskedEmail: string): string =>
	`confirmed by the holder of ${maskedEmail}`;
