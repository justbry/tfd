import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import {
	type Context,
	type Inputs,
	LEDGER_ORIGIN,
	newReport,
	type Result,
	resolveTargets,
	STAGING_WEB_ORIGIN,
	UsageError,
} from "../../../ledger-worker/scripts/staging-e2e.ts";
import {
	leaksIn,
	parseUiArgs,
	rejectionVerdict,
	stage5,
} from "../../scripts/staging-ui.ts";
import { AdapterError, notAvailable } from "../../src/http/errors.ts";
import type { LedgerSchoolClaim } from "../../src/http/ledger-token.ts";
import {
	bookingRow,
	bookingsAnswer,
	capabilitiesAnswer,
	pinVerifiedAnswer,
	refusal,
	versionsAnswer,
} from "../s8e/recorded.ts";
import {
	fakeBuzzSchool,
	harness,
	harnessTimeoutMilliseconds,
	type LedgerHarness,
} from "../worker-e2e/worker-harness.ts";

/**
 * The S8e staging check (`scripts/staging-ui.ts`, S8f stage 5) on the local Worker: S8c's harness on Miniflare stands
 * for `ledger-staging.b4uni.com`, and a fake family service on a local port for `api-staging.b4uni.com`. The fake keeps
 * the parts the stage leans on: the QA link redeemed from the web origin sets the session cookie, every other route
 * wants that cookie, the ledger token wants the PIN open, and the token is a real EdDSA token the Worker checks. The
 * run goes through the S8f `Session` and the allow-list, with both local origins allowed in code as S8f's tests do.
 *
 * The family service's answers must be the process's own `Response` (Bun.serve takes no other), so happy-dom is taken
 * off once here to keep it, and put back with the process's timers as `worker-harness.ts` does.
 */
await GlobalRegistrator.unregister();
const NativeResponse = globalThis.Response;
const nativeTimers = {
	setTimeout: globalThis.setTimeout,
	clearTimeout: globalThis.clearTimeout,
};
GlobalRegistrator.register({ url: "https://ledger.test/" });
Object.assign(globalThis, nativeTimers);

const owned = "monthly-members";
const gated = "disputes";
const grants: LedgerSchoolClaim[] = [
	{ id: owned, role: "owner", finance: true },
	{ id: gated, role: "admin", finance: false },
];
const pin = "246810";
const qaLinkToken = ["qa", "link", "for", "stage", "five"].join("-");
const sessionCookie = ["session", "of", "the", "qa", "account"].join("-");
const stageBudgetMilliseconds = 600_000;

const noInputs: Inputs = {
	qaEmail: undefined,
	pin: undefined,
	adminEmail: undefined,
	adminPin: undefined,
	schoolId: undefined,
	paymentId: undefined,
	refundCents: undefined,
	bookingId: undefined,
	schoolIdNoFinance: undefined,
};

const skip = typeof harness === "string";
let worker: LedgerHarness;
let api: ReturnType<typeof Bun.serve>;
let apiOrigin: string;
const apiOrigins: string[] = [];
let mintedTokens: string[] = [];

const answer = (body: unknown, status = 200, headers: HeadersInit = {}) =>
	NativeResponse.json(body, { status, headers });

/** The family service as stage 5 reaches it: sign-in, PIN and token, and the school-admin reads the Reader makes. */
const startFamilyService = (seeded: LedgerHarness) => {
	const buzzSchool = fakeBuzzSchool(seeded, grants);
	mintedTokens = buzzSchool.minted;
	let pinOpen = false;
	return Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		async fetch(request) {
			const { pathname } = new URL(request.url);
			const origin = request.headers.get("origin") ?? "";
			if (pathname === "/family/verify" && request.method === "POST") {
				const body = (await request.json()) as { token?: string };
				if (body.token !== qaLinkToken || origin !== STAGING_WEB_ORIGIN)
					return answer(refusal("invalid_link"), 401);
				return answer({ ok: true }, 200, {
					"set-cookie": `b4u_session=${sessionCookie}; Path=/; HttpOnly; Secure`,
				});
			}
			if (
				!(request.headers.get("cookie") ?? "").includes(
					`b4u_session=${sessionCookie}`,
				)
			)
				return answer(refusal("unauthenticated"), 401);
			apiOrigins.push(origin);
			if (pathname === "/family/pin/verify" && request.method === "POST") {
				const body = (await request.json()) as { pin?: string };
				if (body.pin !== pin) return answer(refusal("pin_wrong"), 403);
				pinOpen = true;
				return answer(pinVerifiedAnswer);
			}
			if (pathname === "/school-admin/ledger-token" && !pinOpen)
				return answer(refusal("pin_required"), 403);
			const route = /^\/school-admin\/schools\/([^/]+)\/(.+)$/.exec(pathname);
			const school = grants.find(({ id }) => id === route?.[1]);
			if (route && school && route[2] === "ledger/capabilities")
				return answer({ ...capabilitiesAnswer, role: school.role });
			if (route && school && route[2] === "billing/menu/versions")
				return answer(versionsAnswer);
			if (route && school && route[2] === "bookings")
				return answer(bookingsAnswer([bookingRow({ attendance: null })]));
			const faked = await buzzSchool.fetch(request.url, {
				method: request.method,
			});
			const body = (await faked.json()) as {
				members?: Array<{
					familyId: string;
					balances: Array<{ available: number }>;
				}>;
			};
			// The contract's members-list row carries the membership id (the recorded route does not send it yet).
			if (route?.[2] === "billing/members-list" && body.members)
				body.members = body.members.map((member) => ({
					...member,
					membershipId: `membership-${member.familyId}`,
					balances: member.balances.map((balance) => ({
						...balance,
						granted: balance.available,
						rolledOver: 0,
						used: 0,
					})),
				}));
			return answer(body, faked.status);
		},
	});
};

beforeAll(async () => {
	if (typeof harness === "string") return;
	worker = await harness.startLedgerWorker({ presets: [owned, gated] });
	api = startFamilyService(worker);
	apiOrigin = `http://127.0.0.1:${api.port}`;
}, harnessTimeoutMilliseconds);
afterAll(async () => {
	api?.stop(true);
	await worker?.stop();
});

const contextFor = (lines: string[]): Context => ({
	targets: resolveTargets(
		{ worker: worker.url, api: apiOrigin },
		{ extraAllowedOrigins: [worker.url, apiOrigin] },
	),
	report: newReport((line) => lines.push(line)),
	inputs: { ...noInputs, qaEmail: "qa@example.test", pin, schoolId: owned },
	qaLink: async () => ({ token: qaLinkToken }),
	sleep: async () => undefined,
	log: (line) => lines.push(line),
});

const byCheck = (results: readonly Result[]) =>
	Object.fromEntries(results.map((result) => [result.check, result]));

describe.skipIf(skip)("stage 5 on the local Worker", () => {
	test(
		"every check passes through the UI's adapters, the Reader, C5, C4, the gating and the HTTP build's entry",
		async () => {
			const lines: string[] = [];
			const context = contextFor(lines);
			await stage5(context, { now: () => Date.parse(worker.clock.now()) });
			const { results } = context.report;
			expect(
				results.filter((result) => result.status !== "PASS"),
				lines.join("\n"),
			).toEqual([]);
			const checks = byCheck(results);
			for (const name of [
				"qa-link-login",
				"pin-verify",
				"ledger-token",
				"school",
				"pin-open",
				"adapters",
				"reader-schools",
				"reader-disclosure",
				"reader-audience-report-public",
				"reader-audience-report-member",
				"reader-audience-report-governance",
				"reader-ledger",
				"reader-income-statement",
				"reader-income-statement-compare",
				"reader-members-income",
				"reader-members",
				"reader-bookings",
				"reader-capabilities",
				"reader-menu-versions",
				"reader-settings",
				"c5-public",
				"c5-member",
				"c5-governance",
				"gating-ledger",
				"gating-income-statement",
				"gating-ledger-mount",
				"http-app-dashboard",
				"http-app-ledger",
			])
				expect(checks[name]?.status, name).toBe("PASS");
			// The owner holds every audience: each one's document, PIN open and locked, and C4 on every preview.
			for (const audience of [
				"public",
				"member",
				"governance",
				"finance",
				"owner",
			]) {
				expect(checks[`reader-kpi-${audience}-open`]?.status).toBe("PASS");
				expect(checks[`reader-kpi-${audience}-locked`]?.status).toBe("PASS");
				expect(checks[`c4-${audience}-open`]?.status).toBe("PASS");
			}
			for (const audience of ["governance", "finance", "owner"])
				expect(checks[`c4-${audience}-locked`]?.status).toBe("PASS");
			expect(checks["c4-owner-open"]?.why).toContain("render(s)");
			expect(checks["reader-settings"]?.why).toContain("not_available");
			expect(checks["gating-ledger"]?.why).toContain("finance_required");
			expect(checks["gating-ledger-mount"]?.why).toContain("lock shown");
			expect(checks["gating-ledger-mount"]?.why).toContain("0 ledger row(s)");
			// The family service saw the browser build's Origin on every call after the sign-in.
			expect(apiOrigins.length).toBeGreaterThan(0);
			expect(new Set(apiOrigins)).toEqual(new Set([LEDGER_ORIGIN]));
			// No secret reached a line: not the PIN, the link, the cookie or a minted token.
			const printed = lines.join("\n");
			for (const secret of [pin, qaLinkToken, sessionCookie, ...mintedTokens])
				expect(printed).not.toContain(secret);
		},
		stageBudgetMilliseconds,
	);
});

test("C5 names what leaks without printing it", () => {
	expect(leaksIn('{"kpi":"gross","value":1200}')).toEqual([]);
	expect(leaksIn('{"key":"family:abc"}')).toEqual(["a family: key"]);
	expect(leaksIn('{"customer":"cus_Q1w2e3"}')).toEqual(["a cus_ id"]);
	expect(leaksIn('{"who":"sam@example.org"}')).toEqual(["an email address"]);
});

test("a Reader rejection passes only as the contract's not_available", () => {
	expect(
		rejectionVerdict(notAvailable("settings", "no route"), true).status,
	).toBe("PASS");
	expect(
		rejectionVerdict(
			new AdapterError("forbidden", "403 finance_required", {
				status: 403,
				code: "finance_required",
			}),
			true,
		).status,
	).toBe("FAIL");
	expect(
		rejectionVerdict(new AdapterError("no_data", "404 no_data"), false).status,
	).toBe("BLOCKED");
	expect(
		rejectionVerdict(new AdapterError("no_data", "404 no_data"), true).status,
	).toBe("FAIL");
	expect(rejectionVerdict(new Error("boom"), true).status).toBe("FAIL");
});

test("the script runs stage 5 only and takes --json and --strict", () => {
	expect(parseUiArgs([])).toEqual({ stages: [5], json: false, strict: false });
	expect(parseUiArgs(["--json", "--strict"])).toEqual({
		stages: [5],
		json: true,
		strict: true,
	});
	expect(() => parseUiArgs(["--stage", "1"])).toThrow(UsageError);
});
