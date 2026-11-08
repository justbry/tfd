/** Every row of the error table (contract section 11): the status, the `code`, the headers and the body. */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { buildViews, type R2BucketBinding } from "tfd/worker";
import { base64urlEncode } from "../src/auth/jwt.js";
import { answersPointerKey } from "../src/data/answers.js";
import {
	type LedgerHarness,
	startLedgerWorker,
} from "../src/testing/harness.js";
import { presetEvents } from "../src/testing/seed.js";
import { signToken, testSigner } from "../src/testing/signer.js";
import { createLedgerWorker } from "../src/worker.js";
import { call, type Reply } from "./support.js";

const OWNER = { id: "monthly-members", role: "owner", finance: true } as const;
const LEDGER =
	"/v1/schools/monthly-members/ledger?from=2026-03-01&to=2026-03-31";
const KPI = (audience: string, pin = "open") =>
	`/v1/schools/monthly-members/kpi?audience=${audience}&pin=${pin}`;

let harness: LedgerHarness;
beforeAll(async () => {
	harness = await startLedgerWorker({
		presets: ["monthly-members", "tiny-school"],
	});
}, 120_000);
afterAll(async () => {
	await harness.stop();
});

const mint = (
	schools: { id: string; role: string; finance: boolean }[] = [OWNER],
	expiresInSeconds?: number,
) => harness.mintToken({ sub: "profile_x", schools, expiresInSeconds });

const expectError = (
	reply: Reply,
	status: number,
	code: string,
	extra: Record<string, unknown> = {},
) => {
	expect(reply.status).toBe(status);
	expect(reply.body.error).toMatchObject({ code, ...extra });
	expect(typeof reply.body.error?.message).toBe("string");
	expect(reply.headers.get("cache-control")).toBe("private, no-store");
};

const expectUnauthorized = (reply: Reply, code: string) => {
	expectError(reply, 401, code);
	expect(reply.headers.get("www-authenticate")).toBe(
		'Bearer error="invalid_token"',
	);
};

const nowSeconds = () => Math.floor(Date.parse(harness.clock.now()) / 1000);
const claims = (over: Record<string, unknown> = {}) => ({
	iss: harness.issuer,
	aud: "atm-ledger",
	sub: "profile_x",
	iat: nowSeconds(),
	nbf: nowSeconds(),
	exp: nowSeconds() + 300,
	schools: [OWNER],
	...over,
});

describe("401: the token", () => {
	test("missing: no header, another scheme, an empty bearer", async () => {
		expectUnauthorized(await call(harness, null, LEDGER), "token_missing");
		expectUnauthorized(
			await call(harness, null, LEDGER, {
				headers: { authorization: "Basic abc" },
			}),
			"token_missing",
		);
		expectUnauthorized(
			await call(harness, null, LEDGER, {
				headers: { authorization: "Bearer " },
			}),
			"token_missing",
		);
	});

	test("expired", async () => {
		expectUnauthorized(
			await call(harness, await mint([OWNER], -1), LEDGER),
			"token_expired",
		);
	});

	test("wrong aud, wrong iss, aud as an array", async () => {
		expectUnauthorized(
			await call(
				harness,
				await harness.signRaw(claims({ aud: "other" })),
				LEDGER,
			),
			"token_invalid",
		);
		expectUnauthorized(
			await call(
				harness,
				await harness.signRaw(claims({ iss: "https://api.elsewhere.example" })),
				LEDGER,
			),
			"token_invalid",
		);
		expectUnauthorized(
			await call(
				harness,
				await harness.signRaw(claims({ aud: ["atm-ledger"] })),
				LEDGER,
			),
			"token_invalid",
		);
	});

	test("no iat, an iat in the future, a lifetime over 300 seconds", async () => {
		expectUnauthorized(
			await call(
				harness,
				await harness.signRaw(claims({ iat: undefined })),
				LEDGER,
			),
			"token_invalid",
		);
		expectUnauthorized(
			await call(
				harness,
				await harness.signRaw(
					claims({
						iat: nowSeconds() + 3600,
						nbf: undefined,
						exp: nowSeconds() + 3900,
					}),
				),
				LEDGER,
			),
			"token_invalid",
		);
		expectUnauthorized(
			await call(harness, await mint([OWNER], 301), LEDGER),
			"token_invalid",
		);
		expect((await call(harness, await mint([OWNER], 300), LEDGER)).status).toBe(
			200,
		);
	});

	test("tampered: another body under the same signature, a changed signature", async () => {
		const token = await mint([{ ...OWNER, finance: false }]);
		const [head, , signature] = token.split(".") as [string, string, string];
		const forged = base64urlEncode(
			new TextEncoder().encode(JSON.stringify(claims({ schools: [OWNER] }))),
		);
		expectUnauthorized(
			await call(harness, `${head}.${forged}.${signature}`, LEDGER),
			"token_invalid",
		);
		const flipped =
			signature.slice(0, -2) + (signature.endsWith("AA") ? "BB" : "AA");
		expectUnauthorized(
			await call(harness, `${head}.${token.split(".")[1]}.${flipped}`, LEDGER),
			"token_invalid",
		);
	});

	test("unknown kid, and a key the token carries is not used", async () => {
		const stranger = await testSigner(7);
		expectUnauthorized(
			await call(harness, await signToken(stranger, claims()), LEDGER),
			"token_invalid",
		);
		expectUnauthorized(
			await call(
				harness,
				await signToken(stranger, claims(), {
					jwk: stranger.jwk,
					kid: harness.signer.kid,
				}),
				LEDGER,
			),
			"token_invalid",
		);
	});

	test("alg none, alg HS256, garbage", async () => {
		const part = (value: unknown) =>
			base64urlEncode(new TextEncoder().encode(JSON.stringify(value)));
		const body = part(claims());
		expectUnauthorized(
			await call(
				harness,
				`${part({ alg: "none", kid: harness.signer.kid })}.${body}.`,
				LEDGER,
			),
			"token_invalid",
		);
		expectUnauthorized(
			await call(
				harness,
				`${part({ alg: "HS256", kid: harness.signer.kid })}.${body}.${base64urlEncode(new Uint8Array(32))}`,
				LEDGER,
			),
			"token_invalid",
		);
		expectUnauthorized(
			await call(harness, "not-a-token", LEDGER),
			"token_invalid",
		);
	});

	test("a token whose schools claim is the wrong shape", async () => {
		for (const schools of [
			undefined,
			"monthly-members",
			[{ id: "x" }],
			[{ id: "../x", role: "owner", finance: true }],
			[null],
		])
			expectUnauthorized(
				await call(harness, await harness.signRaw(claims({ schools })), LEDGER),
				"token_invalid",
			);
	});

	test("every /v1 path asks for the token first, even one that does not exist", async () => {
		expectUnauthorized(
			await call(harness, null, "/v1/nothing"),
			"token_missing",
		);
		expectUnauthorized(
			await call(harness, null, "/v1/schools"),
			"token_missing",
		);
	});
});

describe("keys: the JWKS is fetched again for an unknown kid, at most every 30 seconds", () => {
	test("a rotated-in key works once the cache may refetch, and not before", async () => {
		const next = await testSigner(5);
		const nextToken = () => signToken(next, claims());
		expect((await call(harness, await mint(), "/v1/schools")).status).toBe(200);
		harness.jwks.setKeys([harness.signer.jwk, next.jwk]);
		const fetchesBefore = harness.jwks.fetches();
		// inside the 30 seconds since the last fetch: refused, and not fetched
		expectUnauthorized(
			await call(harness, await nextToken(), LEDGER),
			"token_invalid",
		);
		expect(harness.jwks.fetches()).toBe(fetchesBefore);
		harness.clock.advance(31_000);
		const later = await signToken(next, claims());
		expect((await call(harness, later, "/v1/schools")).status).toBe(200);
		expect(harness.jwks.fetches()).toBe(fetchesBefore + 1);
		// a flood of tokens with made-up kids costs no further fetch inside the next 30 seconds
		const stranger = await testSigner(8);
		for (let n = 0; n < 3; n++)
			expectUnauthorized(
				await call(harness, await signToken(stranger, claims()), LEDGER),
				"token_invalid",
			);
		expect(harness.jwks.fetches()).toBe(fetchesBefore + 1);
		harness.jwks.setKeys([harness.signer.jwk]);
	});
});

describe("403 and 404: who and what", () => {
	test("finance_required: every finance endpoint, for a school without the grant", async () => {
		const token = await mint([{ ...OWNER, role: "admin", finance: false }]);
		for (const path of [
			LEDGER,
			"/v1/schools/monthly-members/income-statement?from=2026-03-01&to=2026-03-31",
			"/v1/schools/monthly-members/members-income?from=2026-03-01&to=2026-03-31",
			"/v1/schools/monthly-members/members/family%3Afam_001/money",
			"/v1/schools/monthly-members/fundraising?from=2026-03-01&to=2026-03-31",
		])
			expectError(await call(harness, token, path), 403, "finance_required");
	});

	test("audience_not_allowed: finer than the caller's maximum", async () => {
		const admin = await mint([{ ...OWNER, role: "admin", finance: false }]);
		const financeAdmin = await mint([
			{ ...OWNER, role: "admin", finance: true },
		]);
		for (const audience of ["member", "governance", "finance", "owner"])
			expectError(
				await call(harness, admin, KPI(audience)),
				403,
				"audience_not_allowed",
			);
		expectError(
			await call(
				harness,
				admin,
				"/v1/schools/monthly-members/audience-report?audience=member&from=2026-06-01&to=2026-06-30",
			),
			403,
			"audience_not_allowed",
		);
		expect((await call(harness, admin, KPI("public"))).status).toBe(200);
		expect((await call(harness, financeAdmin, KPI("finance"))).status).toBe(
			200,
		);
		expectError(
			await call(harness, financeAdmin, KPI("owner")),
			403,
			"audience_not_allowed",
		);
		expect((await call(harness, await mint(), KPI("owner"))).status).toBe(200);
	});

	test("not_found: a school the token does not list and one that does not exist have the same body", async () => {
		const token = await mint();
		const unlisted = await call(
			harness,
			token,
			"/v1/schools/tiny-school/kpi?audience=public&pin=open",
		);
		const unknown = await call(
			harness,
			token,
			"/v1/schools/no-such-school/kpi?audience=public&pin=open",
		);
		expectError(unlisted, 404, "not_found");
		expectError(unknown, 404, "not_found");
		expect(unlisted.body).toEqual(unknown.body);
		// the gates come after: an unlisted school is a 404 even for a finance endpoint
		expectError(
			await call(
				harness,
				token,
				"/v1/schools/tiny-school/ledger?from=2026-03-01&to=2026-03-31",
			),
			404,
			"not_found",
		);
	});

	test("not_found: an endpoint that does not exist; method_not_allowed for anything but GET", async () => {
		const token = await mint();
		expectError(
			await call(harness, token, "/v1/schools/monthly-members/nothing"),
			404,
			"not_found",
		);
		expectError(await call(harness, token, "/v1/nothing"), 404, "not_found");
		expectError(
			await call(
				harness,
				token,
				"/v1/schools/monthly-members/kpi?audience=public&pin=open",
				{ method: "POST" },
			),
			405,
			"method_not_allowed",
		);
	});

	test("no_data: a school in the token with no views yet, with null asOf and lagMinutes", async () => {
		const reply = await call(
			harness,
			await mint([{ id: "fresh-school", role: "owner", finance: true }]),
			"/v1/schools/fresh-school/kpi?audience=owner&pin=open",
		);
		expectError(reply, 404, "no_data");
		expect(reply.body.asOf).toBeNull();
		expect(reply.body.lagMinutes).toBeNull();
	});

	test("disclosure before a first views run: the B4 Uni defaults, never no_data, with null asOf and lagMinutes", async () => {
		for (const grant of [
			{ id: "fresh-school", role: "owner", finance: true },
			{ id: "fresh-school", role: "admin", finance: false },
		] as const) {
			const reply = await call(
				harness,
				await mint([grant]),
				"/v1/schools/fresh-school/disclosure",
			);
			expect(reply.status).toBe(200);
			expect(reply.body.asOf).toBeNull();
			expect(reply.body.lagMinutes).toBeNull();
			const data = reply.body.data as Record<string, unknown>;
			expect(data.school).toBe("fresh-school");
			expect(data.source).toBe("defaults");
			expect(data.override).toBeNull();
			expect(Object.keys(data.views as object).sort()).toEqual([
				"finance",
				"governance",
				"member",
				"owner",
				"public",
			]);
			expect(Object.keys(data.viewAs as object).length).toBeGreaterThan(0);
		}
	});
});

describe("400: the query", () => {
	test("kpi: audience and pin are required and checked", async () => {
		const token = await mint();
		const base = "/v1/schools/monthly-members/kpi";
		expectError(await call(harness, token, base), 400, "bad_request", {
			field: "audience",
		});
		expectError(
			await call(harness, token, `${base}?audience=everyone&pin=open`),
			400,
			"bad_request",
			{ field: "audience" },
		);
		expectError(
			await call(harness, token, `${base}?audience=owner`),
			400,
			"bad_request",
			{ field: "pin" },
		);
		expectError(
			await call(harness, token, `${base}?audience=owner&pin=maybe`),
			400,
			"bad_request",
			{ field: "pin" },
		);
		// locked is always allowed; below governance it is the same document as open
		const locked = await call(
			harness,
			token,
			`${base}?audience=public&pin=locked`,
		);
		const open = await call(harness, token, `${base}?audience=public&pin=open`);
		expect(locked.status).toBe(200);
		expect(locked.body.data).toEqual(open.body.data);
		expect(
			(await call(harness, token, `${base}?audience=governance&pin=locked`))
				.status,
		).toBe(200);
	});

	test("audience-report: public, member or governance, and a day range", async () => {
		const token = await mint();
		const base = "/v1/schools/monthly-members/audience-report";
		expectError(
			await call(
				harness,
				token,
				`${base}?audience=finance&from=2026-06-01&to=2026-06-30`,
			),
			400,
			"bad_request",
			{ field: "audience" },
		);
		expectError(
			await call(
				harness,
				token,
				`${base}?audience=public&from=June&to=2026-06-30`,
			),
			400,
			"bad_request",
			{ field: "from" },
		);
	});
});

describe("409: the views changed under the read", () => {
	test("an object that differs from the manifest is view_mismatch with retryAfterSeconds 5", async () => {
		const token = await mint();
		const key = "schools/monthly-members/views/finance/months/2026-03.json";
		const original = await harness.bucket.get(key);
		if (!original) throw new Error("no such object");
		const text = new TextDecoder().decode(await original.arrayBuffer());
		await harness.bucket.put(key, new TextEncoder().encode("{}\n"), {});
		try {
			const reply = await call(
				harness,
				token,
				"/v1/schools/monthly-members/income-statement?from=2026-03-01&to=2026-03-31",
			);
			expectError(reply, 409, "view_mismatch", { retryAfterSeconds: 5 });
			expect(reply.headers.get("retry-after")).toBe("5");
			// the KPI document stored with the generation does not read the object: it answers
			expect((await call(harness, token, KPI("owner"))).status).toBe(200);
			// without its stored answers it is worked out from the views, and meets the changed object
			const pointerKey = answersPointerKey("monthly-members");
			const pointer = await harness.bucket.get(pointerKey);
			if (!pointer) throw new Error("no stored answers");
			const pointerText = new TextDecoder().decode(await pointer.arrayBuffer());
			await harness.bucket.delete(pointerKey);
			try {
				expectError(
					await call(harness, token, KPI("owner")),
					409,
					"view_mismatch",
					{ retryAfterSeconds: 5 },
				);
			} finally {
				await harness.bucket.put(
					pointerKey,
					new TextEncoder().encode(pointerText),
					{},
				);
			}
			// an endpoint that reads other objects is not affected
			expect((await call(harness, token, LEDGER)).status).toBe(200);
		} finally {
			await harness.bucket.put(key, new TextEncoder().encode(text), {});
		}
		expect(
			(
				await call(
					harness,
					token,
					"/v1/schools/monthly-members/income-statement?from=2026-03-01&to=2026-03-31",
				)
			).status,
		).toBe(200);
	});
});

describe("501: not available", () => {
	test("a promo filter on the ledger (a school in another currency is in endpoints.test.ts)", async () => {
		const token = await mint();
		expectError(
			await call(harness, token, `${LEDGER}&promo=spring`),
			501,
			"not_available",
		);
	});
});

describe("503: the views", () => {
	test("a log that cannot be replayed is views_unavailable once the job has tried, and no_data before", async () => {
		const events = presetEvents("monthly-members").filter(
			(event) =>
				event.event_type !== "plan.changed" &&
				event.event_type !== "catalog.published",
		);
		// the log is there, the views are not: the cron job finds it cannot replay it
		const built = buildViews(events, {
			school: "broken",
			asOf: new Date(events.at(-1)?.event_time as string),
		});
		expect(built.ok).toBe(false);
		await harness.seedEvents("broken", events, { views: false });
		const token = await mint([{ id: "broken", role: "owner", finance: true }]);
		const path = "/v1/schools/broken/kpi?audience=owner&pin=open";
		expectError(await call(harness, token, path), 404, "no_data");
		await harness.runCron();
		const reply = await call(harness, token, path);
		expectError(reply, 503, "views_unavailable");
		expect(reply.body.error?.message).toMatch(
			/cannot be replayed \((replay|replay-gap|no-catalog)\)/,
		);
		// the healthy school beside it was still served
		expect((await call(harness, await mint(), KPI("owner"))).status).toBe(200);
	});

	test("a manifest this code cannot read", async () => {
		await harness.bucket.put(
			"schools/old-format/views/manifest.json",
			new TextEncoder().encode('{"asOf":1}\n'),
			{},
		);
		const token = await mint([
			{ id: "old-format", role: "owner", finance: true },
		]);
		expectError(
			await call(
				harness,
				token,
				"/v1/schools/old-format/kpi?audience=owner&pin=open",
			),
			503,
			"views_unavailable",
		);
	});
});

describe("the Worker run in-process, with a bucket or a JWKS that fails", () => {
	const failing = (): R2BucketBinding => {
		const fail = () => Promise.reject(new Error("R2 is down: secret detail"));
		return {
			get: fail,
			head: fail,
			put: fail,
			delete: fail,
			list: fail,
		} as unknown as R2BucketBinding;
	};

	test("an R2 failure is views_unavailable and logs nothing about the request", async () => {
		const signer = await testSigner(1);
		const worker = createLedgerWorker({
			clock: () => 1_000_000_000,
			fetchJwks: async () =>
				new Response(JSON.stringify({ keys: [signer.jwk] })),
		});
		const logged: unknown[][] = [];
		const original = console.error;
		console.error = (...args: unknown[]) => void logged.push(args);
		try {
			const token = await signToken(signer, {
				iss: "https://api.test",
				aud: "atm-ledger",
				sub: "profile_secret",
				iat: 1_000_000,
				nbf: 1_000_000,
				exp: 1_000_100,
				schools: [{ id: "s1", role: "owner", finance: true }],
			});
			const response = await worker.fetch(
				new Request(
					"https://ledger.test/v1/schools/s1/kpi?audience=owner&pin=open",
					{ headers: { authorization: `Bearer ${token}` } },
				),
				{
					LEDGER_BUCKET: failing(),
					LEDGER_ISS: "https://api.test",
					LEDGER_JWKS_URL: "https://jwks.test",
				},
			);
			expect(response.status).toBe(503);
			expect(((await response.json()) as Reply["body"]).error?.code).toBe(
				"views_unavailable",
			);
			expect(JSON.stringify(logged)).not.toMatch(
				/profile_secret|secret detail|s1/,
			);
		} finally {
			console.error = original;
		}
	});

	test("a JWKS that cannot be fetched is jwks_unavailable, 503", async () => {
		const signer = await testSigner(1);
		const worker = createLedgerWorker({
			clock: () => 1_000_000_000,
			fetchJwks: async () => {
				throw new Error("network");
			},
		});
		const token = await signToken(signer, {
			iss: "https://api.test",
			aud: "atm-ledger",
			iat: 1_000_000,
			exp: 1_000_100,
			schools: [],
		});
		const response = await worker.fetch(
			new Request("https://ledger.test/v1/schools", {
				headers: { authorization: `Bearer ${token}` },
			}),
			{
				LEDGER_BUCKET: failing(),
				LEDGER_ISS: "https://api.test",
				LEDGER_JWKS_URL: "https://jwks.test",
			},
		);
		expect(response.status).toBe(503);
		expect(((await response.json()) as Reply["body"]).error?.code).toBe(
			"jwks_unavailable",
		);
	});
});

describe("429", () => {
	test("is not implemented: a burst of requests is not limited", async () => {
		const token = await mint();
		const replies = await Promise.all(
			Array.from({ length: 30 }, () => call(harness, token, "/v1/schools")),
		);
		expect(replies.every((reply) => reply.status === 200)).toBe(true);
	});
});

describe("outside /v1", () => {
	test("a path that is not the API is a 404 when no assets are bound, and the assets' answer when they are", async () => {
		const worker = createLedgerWorker();
		const bare = await worker.fetch(
			new Request("https://ledger.test/index.html"),
			{
				LEDGER_BUCKET: {} as R2BucketBinding,
				LEDGER_ISS: "x",
				LEDGER_JWKS_URL: "y",
			},
		);
		expect(bare.status).toBe(404);
		expect(((await bare.json()) as Reply["body"]).error?.code).toBe(
			"not_found",
		);
		const response = await worker.fetch(
			new Request("https://ledger.test/index.html"),
			{
				LEDGER_BUCKET: {} as R2BucketBinding,
				LEDGER_ISS: "x",
				LEDGER_JWKS_URL: "y",
				ASSETS: { fetch: async () => new Response("<html>", { status: 200 }) },
			},
		);
		expect(await response.text()).toBe("<html>");
	});
});

describe("sub is never kept", () => {
	test("after traffic under a distinctive sub, no object in the bucket holds it", async () => {
		const sub = "profile_NEVER_STORE_THIS_9f3a";
		const token = await harness.mintToken({ sub, schools: [OWNER] });
		for (const path of [
			"/v1/schools",
			KPI("owner"),
			LEDGER,
			"/v1/schools/monthly-members/disclosure",
		])
			await call(harness, token, path);
		await harness.runCron();
		const decoder = new TextDecoder();
		let cursor: string | undefined;
		let checked = 0;
		do {
			const page = await harness.bucket.list({ cursor });
			for (const object of page.objects) {
				const body = await harness.bucket.get(object.key);
				expect(decoder.decode(await body?.arrayBuffer())).not.toContain(sub);
				checked += 1;
			}
			cursor = page.truncated ? page.cursor : undefined;
		} while (cursor !== undefined);
		expect(checked).toBeGreaterThan(100);
	}, 120_000);
});
