/**
 * POST /api/early-access: the site's early-access form, sent on as an email to the owner. Nothing is stored, and the
 * submitter's name and email never reach the logs.
 */

/** Sends one raw RFC 5322 message. worker.ts wraps the send_email binding (EmailMessage from cloudflare:email). */
export type Mailer = (from: string, to: string, raw: string) => Promise<void>;

/** The Workers Rate Limiting binding's shape. */
export type RateLimiter = {
	limit: (options: { key: string }) => Promise<{ success: boolean }>;
};

export type EarlyAccessOptions = {
	/** The only origin allowed to post, e.g. https://trifold.app. */
	origin: string;
	/** The From address, on a domain with Email Routing enabled. */
	from: string;
	/** The verified Email Routing destination, or undefined when it isn't configured. */
	to: string | undefined;
	mailer: Mailer | undefined;
	/** The Rate Limiting binding; without one, a per-isolate limiter stands in. */
	limiter: RateLimiter | undefined;
	now?: () => Date;
};

/** The largest body accepted, comfortably above a filled-in form. */
const MAX_BODY_BYTES = 16 * 1024;
const PER_ISOLATE_LIMIT = 5;
const PER_ISOLATE_WINDOW_MS = 60_000;

/** The form's fields (apps/trifold-site/src/routes/early-access/+page.svelte), each with its cap and whether it's required. */
const FIELDS = [
	{ name: "name", label: "Name", max: 120, required: true },
	{ name: "email", label: "Email", max: 254, required: true },
	{ name: "organization", label: "Organization", max: 160, required: true },
	{ name: "role", label: "Role", max: 40, required: false },
	{
		name: "size",
		label: "Families, members or clients",
		max: 12,
		required: false,
	},
	{ name: "stripe", label: "Payments on Stripe", max: 8, required: false },
	{ name: "source", label: "Source", max: 80, required: false },
] as const;
type FieldName = (typeof FIELDS)[number]["name"];

/** The honeypot: a visually hidden field people never fill in. */
const HONEYPOT = "website";

// Printable ASCII only, so the address can go in a header as is.
const EMAIL =
	/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;
const SIZE = /^\d*$/;
const STRIPE = /^(yes|no)?$/;
const CONTROL = /\p{Cc}+/gu;
const PRINTABLE_ASCII = /^[ -~]*$/;
const FORM_TYPES = ["application/x-www-form-urlencoded", "multipart/form-data"];

const json = (
	status: number,
	body: { ok: true } | { ok: false; error: string },
) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

const recent = new Map<string, number[]>();

/** Up to PER_ISOLATE_LIMIT posts a minute per key, in this isolate only. */
const isolateLimiter = (now: number): RateLimiter => ({
	limit: async ({ key }) => {
		const kept = (recent.get(key) ?? []).filter(
			(at) => now - at < PER_ISOLATE_WINDOW_MS,
		);
		const success = kept.length < PER_ISOLATE_LIMIT;
		if (success) kept.push(now);
		recent.set(key, kept);
		return { success };
	},
});

/** The body, or null when it is larger than MAX_BODY_BYTES. */
const readCapped = async (request: Request): Promise<Uint8Array | null> => {
	const declared = Number(request.headers.get("content-length") ?? "0");
	if (declared > MAX_BODY_BYTES) return null;
	if (!request.body) return new Uint8Array();
	const reader = request.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		total += value.byteLength;
		if (total > MAX_BODY_BYTES) {
			await reader.cancel();
			return null;
		}
		chunks.push(value);
	}
	const body = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		body.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return body;
};

const base64 = (bytes: Uint8Array): string => {
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary);
};

/** A header value: as is when it's printable ASCII, else RFC 2047 encoded words of at most 45 input bytes each. */
const headerText = (text: string): string => {
	if (PRINTABLE_ASCII.test(text)) return text;
	const encoder = new TextEncoder();
	const words: string[] = [];
	let chunk = "";
	for (const character of text) {
		if (encoder.encode(chunk + character).byteLength > 45) {
			words.push(chunk);
			chunk = "";
		}
		chunk += character;
	}
	if (chunk) words.push(chunk);
	return words
		.map((word) => `=?UTF-8?B?${base64(encoder.encode(word))}?=`)
		.join("\r\n ");
};

/** RFC 5322 date, e.g. "Sun, 08 Nov 2026 12:00:00 +0000". */
const rfc5322Date = (date: Date) => date.toUTCString().replace(/GMT$/, "+0000");

/** A plain-text message, its body base64 so any UTF-8 and any line length are safe. */
export const buildMessage = (options: {
	from: string;
	to: string;
	replyTo: string;
	subject: string;
	text: string;
	date: Date;
}): string => {
	const domain = options.from.slice(options.from.indexOf("@") + 1);
	const body = base64(new TextEncoder().encode(options.text)).replace(
		/.{76}/g,
		"$&\r\n",
	);
	return [
		`From: Trifold early access <${options.from}>`,
		`To: <${options.to}>`,
		`Reply-To: <${options.replyTo}>`,
		`Subject: ${headerText(options.subject)}`,
		`Date: ${rfc5322Date(options.date)}`,
		`Message-ID: <${crypto.randomUUID()}@${domain}>`,
		"MIME-Version: 1.0",
		"Content-Type: text/plain; charset=utf-8",
		"Content-Transfer-Encoding: base64",
		"",
		body,
		"",
	].join("\r\n");
};

const errorClass = (error: unknown) =>
	error instanceof Error ? error.name : typeof error;

export const earlyAccess = async (
	request: Request,
	options: EarlyAccessOptions,
): Promise<Response> => {
	if (request.method !== "POST")
		return new Response(null, {
			status: 405,
			headers: { allow: "POST", "Cache-Control": "no-store" },
		});
	if (request.headers.get("origin") !== options.origin)
		return json(403, { ok: false, error: "forbidden" });

	const now = options.now?.() ?? new Date();
	const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
	const limiter = options.limiter ?? isolateLimiter(now.getTime());
	if (!(await limiter.limit({ key: ip })).success)
		return json(429, { ok: false, error: "too many requests" });

	const contentType = request.headers.get("content-type") ?? "";
	if (!FORM_TYPES.some((type) => contentType.toLowerCase().startsWith(type)))
		return json(415, { ok: false, error: "unsupported content type" });
	const body = await readCapped(request);
	if (body === null) return json(413, { ok: false, error: "too large" });
	let form: FormData;
	try {
		form = await new Response(body, {
			headers: { "content-type": contentType },
		}).formData();
	} catch {
		return json(400, { ok: false, error: "unreadable form" });
	}

	// A bot filled the hidden field: answer as if it went through, and drop it.
	if (String(form.get(HONEYPOT) ?? "") !== "") return json(200, { ok: true });

	const values = {} as Record<FieldName, string>;
	for (const field of FIELDS) {
		const raw = form.get(field.name);
		const value = (typeof raw === "string" ? raw : "")
			.replace(CONTROL, " ")
			.trim();
		if (value.length > field.max)
			return json(400, { ok: false, error: `${field.name} is too long` });
		if (field.required && value === "")
			return json(400, { ok: false, error: `${field.name} is required` });
		values[field.name] = value;
	}
	if (!EMAIL.test(values.email))
		return json(400, { ok: false, error: "email is not valid" });
	if (!SIZE.test(values.size))
		return json(400, { ok: false, error: "size is not a number" });
	if (!STRIPE.test(values.stripe))
		return json(400, { ok: false, error: "stripe is not yes or no" });

	if (!options.mailer || !options.to) {
		console.error("early-access failed", "NotConfigured");
		return json(503, { ok: false, error: "unavailable" });
	}
	const role = values.role || "unspecified";
	const text = `${FIELDS.map((field) => `${field.label}: ${values[field.name] || "-"}`).join("\n")}\n`;
	try {
		await options.mailer(
			options.from,
			options.to,
			buildMessage({
				from: options.from,
				to: options.to,
				replyTo: values.email,
				subject: `Early access: ${values.organization} (${role})`,
				text,
				date: now,
			}),
		);
	} catch (error) {
		// Also what an unverified destination looks like: the page shows its error, which offers emailing hello@.
		console.error("early-access failed", errorClass(error));
		return json(503, { ok: false, error: "unavailable" });
	}
	console.log("early-access sent");
	return json(200, { ok: true });
};
