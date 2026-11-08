import { describe, expect, test } from "bun:test";
import { AdapterError } from "../../src/http/errors.ts";
import { createLedgerTokenSource } from "../../src/http/ledger-token.ts";
import { createApiClient } from "../../src/http/transport.ts";
import {
	apiBase,
	fakeFetch,
	manualScheduler,
	otherSchoolId,
	profileId,
	schoolId,
} from "./helpers.ts";
import {
	issuedAt,
	ledgerTokenAnswer,
	refusal,
	tokenLifetime,
} from "./recorded.ts";

const client = () => {
	const http = fakeFetch();
	const scheduler = manualScheduler();
	return {
		http,
		scheduler,
		api: createApiClient({ fetch: http.fetch, base: apiBase, scheduler }),
	};
};

const rejection = async (promise: Promise<unknown>): Promise<AdapterError> => {
	try {
		await promise;
	} catch (error) {
		if (error instanceof AdapterError) return error;
		throw error;
	}
	throw new Error("expected a rejection");
};

describe("the api.b4uni.com client", () => {
	test("a POST sends the cookie, the CSRF header and the Idempotency-Key; a GET sends neither header", async () => {
		const { http, api } = client();
		http.always("POST", /./, { status: 200, body: { ok: true } });
		http.always("GET", /./, { status: 200, body: { ok: true } });
		await api.post(
			"/school-admin/key-revoke",
			{ school: schoolId, id: "k1" },
			{ idempotencyKey: "action-0001" },
		);
		await api.get("/school-admin/schools/x/bookings", {
			from: "2026-11-01",
			to: "2026-11-30",
			cursor: undefined,
		});
		const [post, get] = http.calls;
		expect(post).toEqual({
			url: `${apiBase}/school-admin/key-revoke`,
			method: "POST",
			credentials: "include",
			headers: {
				accept: "application/json",
				"content-type": "application/json",
				"x-b4u": "1",
				"idempotency-key": "action-0001",
			},
			body: { school: schoolId, id: "k1" },
		});
		expect(get).toEqual({
			url: `${apiBase}/school-admin/schools/x/bookings?from=2026-11-01&to=2026-11-30`,
			method: "GET",
			credentials: "include",
			headers: { accept: "application/json" },
			body: undefined,
		});
	});

	const cases: Array<[string, number, string, string]> = [
		[
			"/school-admin/schools/x/billing/refunds",
			403,
			"step_up_required",
			"step_up",
		],
		[
			"/school-admin/schools/x/billing/menu/publish",
			403,
			"pin_required",
			"pin_required",
		],
		["/family/pin/verify", 403, "pin_wrong", "pin_wrong"],
		["/family/pin/verify", 429, "rate_limited", "pin_locked"],
		[
			"/school-admin/schools/x/billing/refunds",
			429,
			"rate_limited",
			"rate_limited",
		],
		["/school-admin/ledger-token", 401, "unauthorized", "unauthenticated"],
		[
			"/school-admin/schools/x/billing/invoices",
			403,
			"owner_only",
			"forbidden",
		],
		[
			"/school-admin/schools/x/bookings/y/cancel",
			404,
			"not_found",
			"not_found",
		],
		["/school-admin/schools/x/bookings/y/cancel", 409, "not_open", "conflict"],
		["/school-admin/schools/x/billing/menu", 400, "bad_request", "bad_request"],
		["/school-admin/schools/x/billing/refunds", 502, "stripe_failed", "server"],
	];
	for (const [path, status, code, kind] of cases)
		test(`${status} ${code} on ${path} is ${kind}`, async () => {
			const { http, api } = client();
			http.on("POST", /./, {
				status,
				body: refusal(
					code,
					code === "bad_request" ? { fields: ["tiers.0.prices"] } : {},
				),
			});
			const error = await rejection(api.post(path, {}));
			expect(error.kind).toBe(kind as AdapterError["kind"]);
			expect(error.detail.status).toBe(status);
			expect(error.detail.code).toBe(code);
			if (code === "bad_request")
				expect(error.detail.field).toBe("tiers.0.prices");
		});

	test("a 503 is tried again, and answers when the service comes back", async () => {
		const { http, scheduler, api } = client();
		http.on(
			"POST",
			/refunds$/,
			{ status: 503, body: refusal("school_api_unavailable") },
			{ status: 200, body: { refundId: "re_1" } },
		);
		expect(
			await api.post(
				"/school-admin/schools/x/billing/refunds",
				{},
				{ idempotencyKey: "action-7" },
			),
		).toEqual({ refundId: "re_1" });
		expect(scheduler.waits).toEqual([2]);
		// The retry is the same request: the same Idempotency-Key.
		expect(http.calls.map(({ headers }) => headers["idempotency-key"])).toEqual(
			["action-7", "action-7"],
		);
	});

	test("a 503 that lasts rejects as unavailable (try again), never as an empty answer", async () => {
		const { http, api } = client();
		http.always("GET", /./, {
			status: 503,
			body: refusal("school_api_unavailable"),
		});
		const error = await rejection(
			api.get("/school-admin/schools/x/ledger/school"),
		);
		expect(error.kind).toBe("unavailable");
		expect(error.detail.code).toBe("school_api_unavailable");
		expect(http.calls).toHaveLength(3);
	});

	test("no answer at all is network", async () => {
		const { http, api } = client();
		http.on("GET", /./, "network");
		expect((await rejection(api.get("/x"))).kind).toBe("network");
	});
});

describe("the ledger token", () => {
	const source = () => {
		const { http, scheduler, api } = client();
		return {
			http,
			scheduler,
			tokens: createLedgerTokenSource({ api, scheduler }),
		};
	};

	test("is read once from POST /school-admin/ledger-token and kept while fresh", async () => {
		const { http, tokens } = source();
		const schools = [
			{ id: schoolId, role: "owner" as const, finance: true },
			{ id: otherSchoolId, role: "admin" as const, finance: false },
		];
		http.on("POST", /ledger-token$/, {
			status: 200,
			body: ledgerTokenAnswer(schools),
		});
		const token = await tokens.current();
		expect(token).toEqual({
			token: ledgerTokenAnswer(schools).token,
			expiresAt: issuedAt + tokenLifetime,
			issuedAt,
			subject: profileId,
			schools,
		});
		await tokens.current();
		expect(http.calls).toHaveLength(1);
		expect(http.calls[0]?.headers["x-b4u"]).toBe("1");
	});

	test("is refreshed a minute before exp, without reading a clock", async () => {
		const { http, scheduler, tokens } = source();
		http.on(
			"POST",
			/ledger-token$/,
			{ status: 200, body: ledgerTokenAnswer(undefined, issuedAt) },
			{ status: 200, body: ledgerTokenAnswer(undefined, issuedAt + 240) },
		);
		expect((await tokens.current())?.issuedAt).toBe(issuedAt);
		scheduler.advance(tokenLifetime - 61);
		expect(http.calls).toHaveLength(1);
		scheduler.advance(1);
		expect(http.calls).toHaveLength(2);
		expect((await tokens.current())?.issuedAt).toBe(issuedAt + 240);
		expect(scheduler.pending()).toBe(1);
		tokens.stop();
		expect(scheduler.pending()).toBe(0);
	});

	test("a 404 is no school at all; a 503 rejects, never an empty list", async () => {
		const nowhere = source();
		nowhere.http.on("POST", /ledger-token$/, {
			status: 404,
			body: refusal("not_found"),
		});
		expect(await nowhere.tokens.current()).toBeNull();

		const down = source();
		down.http.always("POST", /ledger-token$/, {
			status: 503,
			body: refusal("school_api_unavailable"),
		});
		expect((await rejection(down.tokens.current())).kind).toBe("unavailable");
	});

	test("a token that is not a JWT is a schema mismatch", async () => {
		const { http, tokens } = source();
		http.on("POST", /ledger-token$/, {
			status: 200,
			body: { ...ledgerTokenAnswer(), token: "opaque" },
		});
		expect((await rejection(tokens.current())).kind).toBe("schema_mismatch");
	});
});
