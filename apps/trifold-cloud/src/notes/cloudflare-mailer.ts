/**
 * The production mailer: Cloudflare Email Service through the Workers `send_email` object (`EMAIL`). It checks a message
 * here before the service sees it, sends from one fixed address, and turns any failure into a `MailError` that names a
 * code and never an address. It logs nothing: a body holds a single-use link or a code.
 */

import type { CloudEnv, SendEmailService } from "../env";
import { MailError, type MailSender, unconfiguredMailer } from "./ports";

/** The most characters a subject may have (RFC 5322 line limit; the service refuses more). */
export const MAX_SUBJECT_LENGTH = 998;

const CONTROL_LINE_BREAK = /[\r\n]/;
const CONTROL_NUL = /\0/;
const ADDRESS_SPACE_OR_LIST = /[\s,<>;]/;
const LINE_BREAKS = /\r\n?/g;
const BLANK_LINE = /\n{2,}/;
const HTML_SPECIAL = /[&<>"']/g;

const HTML_ESCAPES: Record<string, string> = {
	"&": "&amp;",
	"<": "&lt;",
	">": "&gt;",
	'"': "&quot;",
	"'": "&#39;",
};

/** Codes after which sending the same message later could work. Every other code, and a `TypeError`, is final. */
const RETRYABLE_CODES: ReadonlySet<string> = new Set([
	"E_EMAIL_SENDING_NOT_READY",
	"E_RATE_LIMIT_EXCEEDED",
	"E_DAILY_LIMIT_EXCEEDED",
	"E_INTERNAL_SERVER_ERROR",
	"E_DELIVERY_FAILED",
]);

const escapeHtml = (text: string): string =>
	text.replace(
		HTML_SPECIAL,
		(character) => HTML_ESCAPES[character] ?? character,
	);

/**
 * The HTML twin of a plain-text body: every special character escaped, a blank line starts a paragraph and a single
 * newline is a `<br>`. No link is made (an address in the text stays text) and nothing in the text is read as markup.
 */
export const htmlFromText = (text: string): string => {
	const paragraphs = text
		.replace(LINE_BREAKS, "\n")
		.split(BLANK_LINE)
		.map((paragraph) => paragraph.trim())
		.filter((paragraph) => paragraph !== "")
		.map(
			(paragraph) => `<p>${escapeHtml(paragraph).replaceAll("\n", "<br>")}</p>`,
		);
	return `<!doctype html>\n<html><body>\n${paragraphs.join("\n")}\n</body></html>`;
};

const refuse = (reason: string): MailError =>
	new MailError(`mail refused before sending: ${reason}`, null, false);

const checkRecipient = (to: string): void => {
	if (CONTROL_LINE_BREAK.test(to) || CONTROL_NUL.test(to))
		throw refuse("the recipient has a control character");
	if (ADDRESS_SPACE_OR_LIST.test(to))
		throw refuse("the recipient is not one plain address");
	const parts = to.split("@");
	const [local, domain] = parts;
	if (parts.length !== 2 || !local || !domain)
		throw refuse("the recipient is not one address");
};

const checkSubject = (subject: string): void => {
	if (CONTROL_LINE_BREAK.test(subject))
		throw refuse("the subject has a line break");
	if (subject.length > MAX_SUBJECT_LENGTH)
		throw refuse(`the subject is longer than ${MAX_SUBJECT_LENGTH} characters`);
};

const codeOf = (error: unknown): string | null => {
	if (typeof error !== "object" || error === null || !("code" in error))
		return null;
	return typeof error.code === "string" ? error.code : null;
};

/** A send failure as a `MailError`. The service's own message is dropped: it may repeat the address. */
const toMailError = (error: unknown): MailError => {
	const code = codeOf(error);
	if (code === null) {
		const malformed = error instanceof TypeError;
		return new MailError(
			malformed
				? "mail send failed: the message was malformed"
				: "mail send failed",
			null,
			false,
		);
	}
	return new MailError(
		`mail send failed (${code})`,
		code,
		RETRYABLE_CODES.has(code),
	);
};

/** A `MailSender` over the `send_email` object, always sending `from` (never an address taken from a message). */
export const cloudflareMailer = (
	sender: SendEmailService,
	from: string,
): MailSender => ({
	send: async (message) => {
		checkRecipient(message.to);
		checkSubject(message.subject);
		try {
			await sender.send({
				to: message.to,
				from,
				subject: message.subject,
				text: message.text,
				html: htmlFromText(message.text),
			});
		} catch (error) {
			throw toMailError(error);
		}
	},
});

/** The Cloudflare mailer when both `EMAIL` and `NOTES_MAIL_FROM` are set, else the one that always refuses. */
export const mailerFor = (env: CloudEnv): MailSender => {
	const { EMAIL: sender, NOTES_MAIL_FROM: from } = env;
	if (sender === undefined || from === undefined || from === "")
		return unconfiguredMailer;
	return cloudflareMailer(sender, from);
};
