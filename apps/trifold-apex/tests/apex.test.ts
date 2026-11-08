import { describe, expect, test } from "bun:test";
import { handle } from "../src/index";

const env = {
	APEX: "trifold.app",
	ORIGIN: "tfd-ledger.pages.dev",
	VERIFY: "verify.trifold.app",
};

const recorder = (answer: (request: Request) => Response) => {
	const seen: Request[] = [];
	const upstream = async (request: Request) => {
		seen.push(request);
		return answer(request);
	};
	return { seen, upstream };
};

describe("trifold.app", () => {
	test("www redirects to the apex, keeping path and query", async () => {
		const response = await handle(
			new Request("https://www.trifold.app/pricing?x=1"),
			env,
		);
		expect(response.status).toBe(301);
		expect(response.headers.get("location")).toBe(
			"https://trifold.app/pricing?x=1",
		);
	});

	test("the apex serves the Pages origin's answer for the same path", async () => {
		const { seen, upstream } = recorder(
			() =>
				new Response("<h1>Trifold</h1>", {
					headers: { "content-type": "text/html" },
				}),
		);
		const response = await handle(
			new Request("https://trifold.app/how-it-works?ref=a"),
			env,
			upstream,
		);
		expect(await response.text()).toBe("<h1>Trifold</h1>");
		expect(seen[0]?.url).toBe(
			"https://tfd-ledger.pages.dev/how-it-works?ref=a",
		);
		expect(seen[0]?.headers.get("host")).toBeNull();
	});

	test("the origin's status and headers pass through", async () => {
		const { upstream } = recorder(
			() =>
				new Response("missing", {
					status: 404,
					headers: { "content-security-policy": "default-src 'self'" },
				}),
		);
		const response = await handle(
			new Request("https://trifold.app/nope"),
			env,
			upstream,
		);
		expect(response.status).toBe(404);
		expect(response.headers.get("content-security-policy")).toBe(
			"default-src 'self'",
		);
	});

	test("an origin redirect to its own host comes back on the apex", async () => {
		const { upstream } = recorder(
			() =>
				new Response(null, {
					status: 308,
					headers: { location: "https://tfd-ledger.pages.dev/pricing/" },
				}),
		);
		const response = await handle(
			new Request("https://trifold.app/pricing"),
			env,
			upstream,
		);
		expect(response.status).toBe(308);
		expect(response.headers.get("location")).toBe(
			"https://trifold.app/pricing/",
		);
	});

	test("an http origin redirect to its own host comes back as https on the apex", async () => {
		const { upstream } = recorder(
			() =>
				new Response(null, {
					status: 301,
					headers: { location: "http://tfd-ledger.pages.dev/x/" },
				}),
		);
		const response = await handle(
			new Request("https://trifold.app/x"),
			env,
			upstream,
		);
		expect(response.headers.get("location")).toBe("https://trifold.app/x/");
	});

	test("a relative origin redirect resolves to the apex", async () => {
		const { upstream } = recorder(
			() => new Response(null, { status: 308, headers: { location: "/for/" } }),
		);
		const response = await handle(
			new Request("https://trifold.app/for"),
			env,
			upstream,
		);
		expect(response.headers.get("location")).toBe("https://trifold.app/for/");
	});

	test("an origin redirect elsewhere is left alone", async () => {
		const { upstream } = recorder(
			() =>
				new Response(null, {
					status: 302,
					headers: { location: "https://github.com/justbry/tfd" },
				}),
		);
		const response = await handle(
			new Request("https://trifold.app/gh"),
			env,
			upstream,
		);
		expect(response.headers.get("location")).toBe(
			"https://github.com/justbry/tfd",
		);
	});

	test("a form POST is forwarded with its body", async () => {
		const { seen, upstream } = recorder(() => new Response("ok"));
		await handle(
			new Request("https://trifold.app/early-access", {
				method: "POST",
				body: "email=a%40b.c",
			}),
			env,
			upstream,
		);
		expect(seen[0]?.method).toBe("POST");
		expect(await seen[0]?.text()).toBe("email=a%40b.c");
	});
});

describe("verify.trifold.app", () => {
	test("points at the site's verifier with a temporary redirect, keeping a receipt link's query", async () => {
		const response = await handle(
			new Request("https://verify.trifold.app/?r=eyJyZWNlaXB0Ijp7fX0"),
			env,
		);
		expect(response.status).toBe(302);
		expect(response.headers.get("location")).toBe(
			"https://trifold.app/verify?r=eyJyZWNlaXB0Ijp7fX0",
		);
	});

	test("any path lands on the verifier", async () => {
		const response = await handle(
			new Request("https://verify.trifold.app/check"),
			env,
		);
		expect(response.headers.get("location")).toBe("https://trifold.app/verify");
	});

	test("has no keys file yet", async () => {
		const response = await handle(
			new Request("https://verify.trifold.app/.well-known/trifold-keys.json"),
			env,
		);
		expect(response.status).toBe(404);
	});
});

describe("plain http", () => {
	for (const [from, to] of [
		["http://trifold.app/pricing?x=1", "https://trifold.app/pricing?x=1"],
		["http://www.trifold.app/about", "https://trifold.app/about"],
		["http://verify.trifold.app/?r=abc", "https://verify.trifold.app/?r=abc"],
		[
			"http://trifold.app/api/early-access",
			"https://trifold.app/api/early-access",
		],
	])
		test(`${from} moves to https`, async () => {
			const { seen, upstream } = recorder(() => new Response("never"));
			const response = await handle(new Request(from), env, upstream);
			expect(response.status).toBe(301);
			expect(response.headers.get("location")).toBe(to);
			expect(seen).toEqual([]);
		});
});

describe("POST /api/early-access", () => {
	const ENDPOINT = "https://trifold.app/api/early-access";
	const TO = "owner@example.com";
	const fields = {
		name: "Ada Lovelace",
		email: "ada@example.org",
		organization: "Honeycomb Hill Academy",
		role: "school",
		size: "120",
		stripe: "yes",
		source: "flyer",
		website: "",
	};

	const setup = (
		options: { fail?: Error; limit?: number; to?: string | null } = {},
	) => {
		const sent: { from: string; to: string; raw: string }[] = [];
		let calls = 0;
		const mailer = async (from: string, to: string, raw: string) => {
			if (options.fail) throw options.fail;
			sent.push({ from, to, raw });
		};
		const testEnv = {
			...env,
			EARLY_ACCESS_TO: options.to === null ? undefined : (options.to ?? TO),
			EARLY_ACCESS_LIMIT: {
				limit: async () => ({ success: ++calls <= (options.limit ?? 5) }),
			},
		};
		const { seen, upstream } = recorder(() => new Response("never"));
		const post = (
			body: Record<string, string> | string = fields,
			headers: Record<string, string> = {},
		) =>
			handle(
				new Request(ENDPOINT, {
					method: "POST",
					headers: {
						origin: "https://trifold.app",
						"content-type": "application/x-www-form-urlencoded",
						"cf-connecting-ip": "203.0.113.7",
						...headers,
					},
					body: typeof body === "string" ? body : new URLSearchParams(body),
				}),
				testEnv,
				upstream,
				mailer,
			);
		return { sent, seen, post };
	};

	const decodedBody = (raw: string) => {
		const [, body = ""] = raw.split("\r\n\r\n");
		return new TextDecoder().decode(
			Uint8Array.from(atob(body.replace(/\s/g, "")), (c) => c.charCodeAt(0)),
		);
	};

	test("sends the form as an email and answers ok", async () => {
		const { sent, seen, post } = setup();
		const response = await post();
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ ok: true });
		expect(seen).toEqual([]);
		expect(sent.length).toBe(1);
		const [message] = sent;
		expect(message?.from).toBe("early-access@trifold.app");
		expect(message?.to).toBe(TO);
		const raw = message?.raw ?? "";
		expect(raw).toContain(
			"From: Trifold early access <early-access@trifold.app>\r\n",
		);
		expect(raw).toContain(`To: <${TO}>\r\n`);
		expect(raw).toContain("Reply-To: <ada@example.org>\r\n");
		expect(raw).toContain(
			"Subject: Early access: Honeycomb Hill Academy (school)\r\n",
		);
		expect(raw).toMatch(/\r\nMessage-ID: <[0-9a-f-]+@trifold\.app>\r\n/);
		const text = decodedBody(raw);
		for (const line of [
			"Name: Ada Lovelace",
			"Email: ada@example.org",
			"Organization: Honeycomb Hill Academy",
			"Families, members or clients: 120",
			"Payments on Stripe: yes",
			"Source: flyer",
		])
			expect(text).toContain(line);
	});

	test("accepts multipart, as the page's fetch of FormData sends it", async () => {
		const { sent } = setup();
		const form = new FormData();
		for (const [key, value] of Object.entries(fields)) form.set(key, value);
		const response = await handle(
			new Request(ENDPOINT, {
				method: "POST",
				headers: { origin: "https://trifold.app" },
				body: form,
			}),
			{ ...env, EARLY_ACCESS_TO: TO },
			async () => new Response("never"),
			async (from, to, raw) => {
				sent.push({ from, to, raw });
			},
		);
		expect(response.status).toBe(200);
		expect(sent.length).toBe(1);
	});

	test("encodes a non-ASCII subject and body", async () => {
		const { sent, post } = setup();
		await post({ ...fields, organization: "École Sainte-Thérèse" });
		const raw = sent[0]?.raw ?? "";
		expect(raw).toMatch(/\r\nSubject: =\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=/);
		expect(decodedBody(raw)).toContain("Organization: École Sainte-Thérèse");
	});

	test("a filled honeypot answers ok and sends nothing", async () => {
		const { sent, post } = setup();
		const response = await post({ ...fields, website: "https://spam.example" });
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ ok: true });
		expect(sent).toEqual([]);
	});

	test("another origin, or none, is refused", async () => {
		const { sent, post } = setup();
		expect(
			(await post(fields, { origin: "https://evil.example" })).status,
		).toBe(403);
		expect(
			(await post(fields, { origin: "https://tfd-ledger.pages.dev" })).status,
		).toBe(403);
		const response = await handle(
			new Request(ENDPOINT, {
				method: "POST",
				body: new URLSearchParams(fields),
			}),
			env,
		);
		expect(response.status).toBe(403);
		expect(sent).toEqual([]);
	});

	test("only POST", async () => {
		const response = await handle(new Request(ENDPOINT), env);
		expect(response.status).toBe(405);
	});

	test("a bad email, a missing field or a bad value is refused", async () => {
		const { sent, post } = setup({ limit: 100 });
		for (const body of [
			{ ...fields, email: "not-an-email" },
			{ ...fields, email: "a@b.c\r\nBcc: x@y.z" },
			{ ...fields, name: "" },
			{ ...fields, organization: "   " },
			{ ...fields, size: "lots" },
			{ ...fields, stripe: "maybe" },
		]) {
			const response = await post(body);
			expect(response.status).toBe(400);
			expect((await response.json()).ok).toBe(false);
		}
		expect(sent).toEqual([]);
	});

	test("an oversize field or body is refused", async () => {
		const { sent, post } = setup({ limit: 100 });
		expect((await post({ ...fields, name: "a".repeat(121) })).status).toBe(400);
		expect(
			(await post({ ...fields, website: "", name: "a".repeat(20_000) })).status,
		).toBe(413);
		expect(sent).toEqual([]);
	});

	test("a JSON body is refused", async () => {
		const { post } = setup();
		const response = await post(JSON.stringify(fields), {
			"content-type": "application/json",
		});
		expect(response.status).toBe(415);
	});

	test("more than the limit is refused", async () => {
		const { sent, post } = setup({ limit: 2 });
		expect((await post()).status).toBe(200);
		expect((await post()).status).toBe(200);
		expect((await post()).status).toBe(429);
		expect(sent.length).toBe(2);
	});

	test("without the binding, a per-isolate limiter allows five a minute per IP", async () => {
		const sent: string[] = [];
		const request = () =>
			new Request(ENDPOINT, {
				method: "POST",
				headers: {
					origin: "https://trifold.app",
					"content-type": "application/x-www-form-urlencoded",
					"cf-connecting-ip": "198.51.100.42",
				},
				body: new URLSearchParams(fields),
			});
		const statuses: number[] = [];
		for (let index = 0; index < 6; index++)
			statuses.push(
				(
					await handle(
						request(),
						{ ...env, EARLY_ACCESS_TO: TO },
						fetch,
						async (_from, _to, raw) => {
							sent.push(raw);
						},
					)
				).status,
			);
		expect(statuses).toEqual([200, 200, 200, 200, 200, 429]);
	});

	test("a failed send, such as an unverified destination, answers 503", async () => {
		const { post } = setup({
			fail: new Error("destination address not verified"),
		});
		const response = await post();
		expect(response.status).toBe(503);
		expect(await response.json()).toEqual({ ok: false, error: "unavailable" });
	});

	test("no destination configured answers 503", async () => {
		const { sent, post } = setup({ to: null });
		expect((await post()).status).toBe(503);
		expect(sent).toEqual([]);
	});

	test("never logs the submitter's name or email", async () => {
		const logged: unknown[] = [];
		const original = { log: console.log, error: console.error };
		console.log = (...args: unknown[]) => logged.push(...args);
		console.error = (...args: unknown[]) => logged.push(...args);
		try {
			await setup().post();
			await setup({ fail: new Error(`bad ${fields.email}`) }).post();
		} finally {
			console.log = original.log;
			console.error = original.error;
		}
		expect(logged).toEqual([
			"early-access sent",
			"early-access failed",
			"Error",
		]);
	});
});
