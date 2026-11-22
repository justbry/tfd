import { describe, expect, test } from "bun:test";
import type { CloudEnv, SendEmailService } from "../src/env";
import {
	cloudflareMailer,
	htmlFromText,
	MAX_SUBJECT_LENGTH,
	mailerFor,
} from "../src/notes/cloudflare-mailer";
import {
	MailError,
	MailNotConfiguredError,
	unconfiguredMailer,
} from "../src/notes/ports";
import { notesRoute } from "../src/notes/routes";
import {
	API,
	API_KEY,
	BORROWER_EMAIL,
	harness,
	LEDGER,
	LENDER_EMAIL,
	notesEnv,
	TERMS,
} from "./notes-fakes";

const FROM = "notes@trifold.app";
const BANNED =
	/\b(proof|enforceable|binding|tamper-proof|legally|credit|interest-free)\b/i;

type SentMessage = Parameters<SendEmailService["send"]>[0];

/** A fake `send_email` binding: it records each message, or throws what `failWith` holds. No network. */
class FakeBinding implements SendEmailService {
	readonly sent: SentMessage[] = [];
	failWith: unknown = null;

	async send(message: SentMessage): Promise<{ messageId: string }> {
		if (this.failWith !== null) throw this.failWith;
		this.sent.push(message);
		return { messageId: `message-${this.sent.length}` };
	}
}

const coded = (code: string, message = "service said no"): Error =>
	Object.assign(new Error(message), { code });

const failureOf = async (work: Promise<unknown>): Promise<unknown> => {
	try {
		await work;
	} catch (error) {
		return error;
	}
	throw new Error("expected a failure");
};

const mailError = async (work: Promise<unknown>): Promise<MailError> => {
	const error = await failureOf(work);
	expect(error).toBeInstanceOf(MailError);
	return error as MailError;
};

describe("cloudflareMailer", () => {
	test("sends the exact message: fixed from, text as given, html generated", async () => {
		const binding = new FakeBinding();
		await cloudflareMailer(binding, FROM).send({
			to: "ana@example.com",
			subject: "A loan record is waiting for you",
			text: "Line one\nLine two\n\nSecond paragraph",
		});
		expect(binding.sent).toEqual([
			{
				to: "ana@example.com",
				from: FROM,
				subject: "A loan record is waiting for you",
				text: "Line one\nLine two\n\nSecond paragraph",
				html: "<!doctype html>\n<html><body>\n<p>Line one<br>Line two</p>\n<p>Second paragraph</p>\n</body></html>",
			},
		]);
	});

	test("the sender is never taken from the message", async () => {
		const binding = new FakeBinding();
		const message = {
			to: "ana@example.com",
			subject: "Hello",
			text: "Hi",
			from: "attacker@example.com",
		};
		await cloudflareMailer(binding, FROM).send(message);
		expect(binding.sent[0]?.from).toBe(FROM);
	});

	test("html escapes & < > quotes and apostrophes, and creates no link", () => {
		const html = htmlFromText(
			`<script>alert("x")</script> & 'q'\n\nhttps://example.com/?a=1&b=2`,
		);
		expect(html).toContain(
			"<p>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;q&#39;</p>",
		);
		expect(html).toContain("<p>https://example.com/?a=1&amp;b=2</p>");
		expect(html).not.toContain("<script");
		expect(html).not.toContain("<a ");
	});

	test("CRLF text and extra blank lines still make clean paragraphs", () => {
		expect(htmlFromText("a\r\nb\r\n\r\n\r\n\r\nc\n")).toBe(
			"<!doctype html>\n<html><body>\n<p>a<br>b</p>\n<p>c</p>\n</body></html>",
		);
	});

	test("CR, LF or NUL in the recipient is refused before the binding is called", async () => {
		const binding = new FakeBinding();
		const mailer = cloudflareMailer(binding, FROM);
		for (const to of [
			"a@example.com\r\nBcc: b@example.com",
			"a@example.com\nb@example.com",
			"a@example.com\rb",
			"a@example.com\0b@example.com",
			"a@b@example.com",
			"no-at-sign",
			"@example.com",
			"a@",
			"a@example.com, b@example.com",
			"Ana <a@example.com>",
			"a@localhost",
			"a@.",
			"a@example..com",
			"",
		]) {
			const error = await mailError(
				mailer.send({ to, subject: "Hi", text: "Hi" }),
			);
			expect(error.code).toBeNull();
			expect(error.retryable).toBe(false);
		}
		expect(binding.sent).toHaveLength(0);
	});

	test("CR or LF in the subject, or a subject over the limit, is refused before the binding is called", async () => {
		const binding = new FakeBinding();
		const mailer = cloudflareMailer(binding, FROM);
		for (const subject of [
			"Hi\r\nBcc: b@example.com",
			"Hi\nthere",
			"Hi\rthere",
			"x".repeat(MAX_SUBJECT_LENGTH + 1),
		])
			await mailError(
				mailer.send({ to: "ana@example.com", subject, text: "Hi" }),
			);
		expect(binding.sent).toHaveLength(0);
		await mailer.send({
			to: "ana@example.com",
			subject: "x".repeat(MAX_SUBJECT_LENGTH),
			text: "Hi",
		});
		expect(binding.sent).toHaveLength(1);
	});

	test("a suppressed recipient is a MailError with its code, not retryable", async () => {
		const binding = new FakeBinding();
		binding.failWith = coded("E_RECIPIENT_SUPPRESSED");
		const error = await mailError(
			cloudflareMailer(binding, FROM).send({
				to: "ana@example.com",
				subject: "Hi",
				text: "Hi",
			}),
		);
		expect(error.code).toBe("E_RECIPIENT_SUPPRESSED");
		expect(error.retryable).toBe(false);
	});

	test("the retryable codes are retryable and others are not", async () => {
		const binding = new FakeBinding();
		const mailer = cloudflareMailer(binding, FROM);
		const retryable = [
			"E_EMAIL_SENDING_NOT_READY",
			"E_RATE_LIMIT_EXCEEDED",
			"E_DAILY_LIMIT_EXCEEDED",
			"E_INTERNAL_SERVER_ERROR",
			"E_DELIVERY_FAILED",
		];
		const final = [
			"E_SENDER_DOMAIN_NOT_CONFIGURED",
			"E_SENDER_NOT_VERIFIED",
			"E_VALIDATION_ERROR",
			"E_ACCOUNT_SUSPENDED",
			"E_SOMETHING_NEW",
		];
		for (const code of [...retryable, ...final]) {
			binding.failWith = coded(code);
			const error = await mailError(
				mailer.send({ to: "ana@example.com", subject: "Hi", text: "Hi" }),
			);
			expect({ code, retryable: error.retryable }).toEqual({
				code,
				retryable: retryable.includes(code),
			});
		}
	});

	test("a TypeError, or an error with no string code, is not retryable and has code null", async () => {
		const binding = new FakeBinding();
		const mailer = cloudflareMailer(binding, FROM);
		for (const thrown of [
			new TypeError("bad argument"),
			new Error("plain"),
			Object.assign(new Error("numeric code"), { code: 500 }),
			"a string",
		]) {
			binding.failWith = thrown;
			const error = await mailError(
				mailer.send({ to: "ana@example.com", subject: "Hi", text: "Hi" }),
			);
			expect(error.code).toBeNull();
			expect(error.retryable).toBe(false);
		}
	});

	test("an error message never carries the address, the subject or the body, even when the binding's does", async () => {
		const binding = new FakeBinding();
		const mailer = cloudflareMailer(binding, FROM);
		const address = "secret.person@example.com";
		for (const thrown of [
			coded("E_RECIPIENT_NOT_ALLOWED", `${address} is not allowed`),
			new TypeError(`bad to: ${address}`),
		]) {
			binding.failWith = thrown;
			const error = await mailError(
				mailer.send({
					to: address,
					subject: "Private subject",
					text: "https://staging-ledger.trifold.app/n/x/enter?t=sometoken",
				}),
			);
			for (const secret of [
				address,
				"secret.person",
				"Private subject",
				"sometoken",
			])
				expect(error.message).not.toContain(secret);
		}
		const refused = await mailError(
			mailer.send({
				to: `${address}\n`,
				subject: "Hi",
				text: "Hi",
			}),
		);
		expect(refused.message).not.toContain("secret.person");
	});

	test("it writes nothing to the console", async () => {
		const binding = new FakeBinding();
		const original = { ...console };
		const lines: unknown[][] = [];
		for (const method of ["log", "error", "warn", "info", "debug"] as const)
			console[method] = (...args: unknown[]) => {
				lines.push(args);
			};
		try {
			await cloudflareMailer(binding, FROM).send({
				to: "ana@example.com",
				subject: "Hi",
				text: "link",
			});
			binding.failWith = coded("E_DELIVERY_FAILED");
			await failureOf(
				cloudflareMailer(binding, FROM).send({
					to: "ana@example.com",
					subject: "Hi",
					text: "link",
				}),
			);
		} finally {
			Object.assign(console, original);
		}
		expect(lines).toEqual([]);
	});
});

describe("mailerFor", () => {
	const envWith = (overrides: Partial<CloudEnv>): CloudEnv =>
		notesEnv(overrides);

	test("picks the Cloudflare mailer only when both EMAIL and NOTES_MAIL_FROM are set", async () => {
		const binding = new FakeBinding();
		await mailerFor(envWith({ EMAIL: binding, NOTES_MAIL_FROM: FROM })).send({
			to: "ana@example.com",
			subject: "Hi",
			text: "Hi",
		});
		expect(binding.sent).toHaveLength(1);
		expect(binding.sent[0]?.from).toBe(FROM);
	});

	test("picks the unconfigured mailer when either is missing", async () => {
		const binding = new FakeBinding();
		expect(mailerFor(envWith({}))).toBe(unconfiguredMailer);
		expect(mailerFor(envWith({ EMAIL: binding }))).toBe(unconfiguredMailer);
		expect(mailerFor(envWith({ NOTES_MAIL_FROM: FROM }))).toBe(
			unconfiguredMailer,
		);
		expect(mailerFor(envWith({ EMAIL: binding, NOTES_MAIL_FROM: "" }))).toBe(
			unconfiguredMailer,
		);
		expect(
			await failureOf(
				unconfiguredMailer.send({
					to: "a@example.com",
					subject: "s",
					text: "t",
				}),
			),
		).toBeInstanceOf(MailNotConfiguredError);
		expect(binding.sent).toHaveLength(0);
	});
});

describe("creating a note through the Cloudflare mailer", () => {
	const create = async (env: CloudEnv) => {
		const h = harness();
		const response = await notesRoute(
			new Request(`https://${API}/v1/notes`, {
				method: "POST",
				headers: { Authorization: `Bearer ${API_KEY}` },
				body: JSON.stringify({
					terms: TERMS,
					lender_email: LENDER_EMAIL,
					borrower_email: BORROWER_EMAIL,
					idem: "cf-mail",
				}),
			}),
			env,
			{ store: h.store, clock: h.clock, ids: h.ids },
		);
		return response;
	};

	test("sends both invitations from the fixed address, with links to the note's own path and no banned word", async () => {
		const binding = new FakeBinding();
		const response = await create(
			notesEnv({ EMAIL: binding, NOTES_MAIL_FROM: FROM }),
		);
		expect(response?.status).toBe(201);
		const { note_id: noteId } = (await response?.json()) as { note_id: string };
		expect(binding.sent.map((message) => message.to).sort()).toEqual(
			[BORROWER_EMAIL, LENDER_EMAIL].sort(),
		);
		for (const message of binding.sent) {
			expect(message.from).toBe(FROM);
			expect(message.subject).toBe("A loan record is waiting for you");
			const link = new RegExp(
				`https://${LEDGER.replaceAll(".", "\\.")}/n/${noteId}/enter\\?t=[A-Za-z0-9_-]+`,
			);
			expect(message.text).toMatch(link);
			expect(message.html).toMatch(link);
			expect(message.html).toContain("<p>");
			expect(
				`${message.subject}\n${message.text}\n${message.html}`,
			).not.toMatch(BANNED);
		}
	});

	test("a service refusal shows the existing mail_failed outcome and the note stays", async () => {
		const binding = new FakeBinding();
		binding.failWith = coded("E_SENDER_DOMAIN_NOT_CONFIGURED");
		const response = await create(
			notesEnv({ EMAIL: binding, NOTES_MAIL_FROM: FROM }),
		);
		expect(response?.status).toBe(502);
		expect(
			((await response?.json()) as { error: { code: string } }).error.code,
		).toBe("mail_failed");
	});
});
