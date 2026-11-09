/**
 * S8f: the staging end-to-end for the ledger Worker and the family service that mints its tokens.
 *
 *   bun run --cwd packages/ledger-worker staging-e2e [--stage N[,N]] [--json] [--strict]
 *
 * STAGING ONLY. The two base URLs are checked against a hard allow-list (`resolveTargets`): any other host, the
 * production hosts included, is refused before a request is made. Inputs come from environment variables, never argv
 * (runbook: plans/ledger-ui/S8f-staging-runbook.md). Every check prints one line `PASS|FAIL|BLOCKED  <stage>.<check>
 * <why>`; BLOCKED says what is missing and who supplies it. Tokens, cookies, links and PINs are never printed in full
 * (the first four characters at most) and the cookie jar lives in memory.
 *
 * Stage 5, the ledger UI's own HTTP adapters on staging, runs from the UI package (`bun run --cwd packages/ledger-ui
 * staging-ui`, `packages/ledger-ui/scripts/staging-ui.ts`): Bun takes the JSX settings of the directory it starts in.
 * It signs in with this file's `Session` and prints the same lines.
 *
 * Stage 6, S8d (buzz-school's own money and catalog routes to the ledger), is `scripts/staging-s8d.ts`; it moves test
 * money, so only `--stage 6` runs it.
 *
 * Stage 7, the credits engine's S8f (the views build for logs of credit events, two menu versions included), is
 * `scripts/staging-credits.ts`; it seeds its own `demo-s8f-*` schools in the staging bucket, so only `--stage 7` runs it.
 */
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const STAGING_WORKER = "https://ledger-staging.b4uni.com";
export const STAGING_API = "https://api-staging.b4uni.com";
/** The origin the browser UI calls the family service from, and the one production must not have there. */
export const LEDGER_ORIGIN = STAGING_WORKER;
export const PRODUCTION_LEDGER_ORIGIN = "https://ledger.b4uni.com";
/** The web app's origin: a person signs in there, and the session cookie then carries to the ledger origin (same site).
 * `/family/verify` is outside LEDGER_ROUTES, so the family service refuses it from the ledger origin (403 origin). */
export const STAGING_WEB_ORIGIN = "https://staging.b4uni.com";
export const FLY_APP = "b4uni-stg-family";
const QA_OPERATOR = "s8f";
const FIXTURE_READER = join(
	import.meta.dir,
	"../../ledger-ui/src/fixtures/reader.ts",
);

const REQUEST_TIMEOUT_MS = 30_000;
const FLY_TIMEOUT_MS = 120_000;
export const MS_PER_SECOND = 1000;
const SECONDS_PER_DAY = 86_400;
const TOKEN_REFRESH_MARGIN_SECONDS = 60;
const MS_PER_MINUTE = 60_000;
export const POLL_INTERVAL_MS = 30_000;
export const POLL_TIMEOUT_MS = 15 * MS_PER_MINUTE;
/** Days each side of today for the bookings listing: the route takes at most 62 days from `from` to `to` inclusive
 * (buzz-school `MAX_BOOKING_DAYS`, 400 `bad_range` beyond), so ±30 is 61. */
export const BOOKING_WINDOW_DAYS = 30;
const SECRET_PREFIX_LENGTH = 4;
const EMAIL_PREFIX_LENGTH = 3;
const STATUS_WIDTH = 7;
const TOKEN_LIFETIME_CLAIM_SECONDS = 120;
const SESSION_COOKIE = "b4u_session";

const JWT_PATTERN = /eyJ[\w-]{6,}\.[\w-]{6,}\.[\w-]*/g;
const COOKIE_PATTERN = /b4u_session=[^;\s]+/g;
const EMAIL_PATTERN = /^[A-Za-z0-9._+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
const UUID_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAYMENT_PATTERN = /^(pi|ch|py)_[A-Za-z0-9_]{6,80}$/;
const PIN_PATTERN = /^\d{4,12}$/;
const SCRIPT_TAG_PATTERN = /<script\b[^>]*?\bsrc\s*=\s*["']([^"']+)["']/gi;
const LINK_TAG_PATTERN = /<link\b[^>]*?\bhref\s*=\s*["']([^"']+)["']/gi;
/** Text only the HTTP build carries: the signed-out demo alert (`ledger-ui/src/http/demo-banner.tsx`). Since that build
 * shows the fixture schools as a demo to a signed-out visitor, fixture names alone no longer mean the fixture build. */
const HTTP_BUILD_MARKER = "I have signed in";
const FIXTURE_SCHOOL_PATTERN =
	/\bid:\s*"([^"]+)",\s*name:\s*"([^"]+)",\s*timeZone:/g;
const PROD_API_PATTERN = /(?<![\w-])api\.b4uni\.com/;
const JS_ASSET_PATTERN = /\.m?js(\?|$)/;
/** A lazy chunk a bundle imports by relative path (`import("./DemoBanner-ab12.js")`): the bundle checks follow these, since the
 * Svelte build keeps the signed-out alert's words out of the entry. */
const CHUNK_IMPORT_PATTERN = /["'`](\.{1,2}\/[\w./-]+\.m?js)["'`]/g;
const MAX_LAZY_CHUNKS = 60;
const STRING_QUOTES = ['"', "'", "`"] as const;

/** Names that are also the product's own words ("The school uses the B4 Uni file"): only a whole string literal counts. */
const BRAND_NAMES = ["B4 Uni"] as const;

// ---- redaction

const knownSecrets = new Set<string>();

/** Registers a value (token, PIN, link) so `scrub` shows at most its first four characters. */
export const registerSecret = (value: string | null | undefined): void => {
	if (value !== null && value !== undefined && value.length >= 4)
		knownSecrets.add(value);
};

export const prefixOf = (value: string): string =>
	`${value.slice(0, SECRET_PREFIX_LENGTH)}…`;

export const maskEmail = (email: string): string =>
	`${email.slice(0, EMAIL_PREFIX_LENGTH)}…`;

export const scrub = (text: string): string => {
	let out = text;
	for (const secret of [...knownSecrets].sort((a, b) => b.length - a.length))
		out = out.split(secret).join(prefixOf(secret));
	return out
		.replace(JWT_PATTERN, (match) => prefixOf(match))
		.replace(COOKIE_PATTERN, `${SESSION_COOKIE}=${"…"}`);
};

// ---- the allow-list

export type Targets = { worker: string; api: string };

export type TargetOptions = {
	/** Extra origins a test may allow (the local Miniflare Worker and a fake family service). Never read from the environment. */
	extraAllowedOrigins?: readonly string[];
};

export class UsageError extends Error {}

const originOf = (raw: string, role: string): string => {
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		throw new UsageError(`${role} URL is not a URL`);
	}
	const bare =
		url.username === "" &&
		url.password === "" &&
		url.search === "" &&
		url.hash === "" &&
		(url.pathname === "/" || url.pathname === "");
	if (!bare)
		throw new UsageError(
			`${role} URL must be an origin only (no credentials, path, query or fragment)`,
		);
	return url.origin;
};

/**
 * The only hosts this script talks to: the staging Worker as `worker` and the staging family service as `api`.
 * Production (`ledger.b4uni.com`, `api.b4uni.com`), a look-alike, plain http, another port, or the right host in the
 * wrong role are refused. `extraAllowedOrigins` exists for the test suite alone: the CLI never passes it.
 */
export const resolveTargets = (
	raw: { worker?: string | undefined; api?: string | undefined },
	options: TargetOptions = {},
): Targets => {
	const extra = options.extraAllowedOrigins ?? [];
	const pick = (
		value: string | undefined,
		fallback: string,
		role: string,
	): string => {
		const origin = originOf(value ?? fallback, role);
		if (origin === fallback || extra.includes(origin)) return origin;
		throw new UsageError(
			`${role} host ${new URL(origin).host} is not the staging host ${new URL(fallback).host}: this script runs against staging only`,
		);
	};
	return {
		worker: pick(raw.worker, STAGING_WORKER, "S8F_WORKER"),
		api: pick(raw.api, STAGING_API, "S8F_API"),
	};
};

// ---- results

export type Status = "PASS" | "FAIL" | "BLOCKED";
export type Result = {
	stage: number;
	check: string;
	status: Status;
	why: string;
};

export type Report = {
	results: Result[];
	add(stage: number, check: string, status: Status, why: string): void;
};

export const newReport = (print: (line: string) => void): Report => {
	const results: Result[] = [];
	return {
		results,
		add(stage, check, status, why) {
			const result = { stage, check, status, why: scrub(why) };
			results.push(result);
			print(`${status.padEnd(STATUS_WIDTH)} ${stage}.${check}  ${result.why}`);
		},
	};
};

export const summarize = (
	results: readonly Result[],
): { stage: number; pass: number; fail: number; blocked: number }[] => {
	const stages = [...new Set(results.map((result) => result.stage))].sort();
	return stages.map((stage) => {
		const own = results.filter((result) => result.stage === stage);
		const count = (status: Status) =>
			own.filter((result) => result.status === status).length;
		return {
			stage,
			pass: count("PASS"),
			fail: count("FAIL"),
			blocked: count("BLOCKED"),
		};
	});
};

export const exitCodeOf = (
	results: readonly Result[],
	strict: boolean,
): number => {
	const failed = results.some(
		(result) =>
			result.status === "FAIL" || (strict && result.status === "BLOCKED"),
	);
	return failed ? 1 : 0;
};

// ---- http

export type Reply = {
	status: number;
	headers: Headers;
	text: string;
	json: unknown;
};

type Json = Record<string, unknown>;

export const asRecord = (value: unknown): Json =>
	typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Json)
		: {};

export const asArray = (value: unknown): unknown[] =>
	Array.isArray(value) ? value : [];

export const errorCodeOf = (reply: Reply): string => {
	const error = asRecord(asRecord(reply.json).error);
	if (typeof error.code === "string") return error.code;
	const flat = asRecord(reply.json).error;
	return typeof flat === "string" ? flat : "";
};

export const describe = (reply: Reply): string => {
	const code = errorCodeOf(reply);
	return code === "" ? `${reply.status}` : `${reply.status} ${code}`;
};

/**
 * `work` or a rejection after REQUEST_TIMEOUT_MS. Bun's own fetch and no `AbortSignal`: stage 5 runs under happy-dom,
 * whose `fetch` and `AbortSignal` replace the globals, and Bun's fetch takes no happy-dom signal. The request is not
 * aborted at the deadline; the check reports and the run moves on.
 */
const withDeadline = <Answer>(
	work: Promise<Answer>,
	url: string,
): Promise<Answer> => {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const deadline = new Promise<never>((_, reject) => {
		timer = setTimeout(
			() =>
				reject(
					new Error(
						`no answer from ${new URL(url).host} within ${REQUEST_TIMEOUT_MS / MS_PER_SECOND} s`,
					),
				),
			REQUEST_TIMEOUT_MS,
		);
	});
	return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
};

export const send = async (
	url: string,
	init: RequestInit = {},
): Promise<Reply> => {
	const { response, text } = await withDeadline(
		(async () => {
			const answer = await Bun.fetch(url, { redirect: "manual", ...init });
			return { response: answer, text: await answer.text() };
		})(),
		url,
	);
	let json: unknown = null;
	try {
		json = JSON.parse(text);
	} catch {
		json = null;
	}
	return { status: response.status, headers: response.headers, text, json };
};

// ---- ledger tokens (forged and tampered)

const base64url = (bytes: Uint8Array | string): string =>
	Buffer.from(bytes).toString("base64url");

const decodeSegment = (segment: string): Json =>
	asRecord(JSON.parse(Buffer.from(segment, "base64url").toString("utf8")));

const nowSeconds = (): number => Math.floor(Date.now() / MS_PER_SECOND);

type ForgeOptions = {
	kid: string;
	issuer: string;
	audience?: string;
	expiresInSeconds?: number;
	algorithm?: string;
};

/** A well-formed ledger token signed by a key the family service never published. */
const forgeToken = async (options: ForgeOptions): Promise<string> => {
	const issuedAt = nowSeconds();
	const algorithm = options.algorithm ?? "EdDSA";
	const header = { alg: algorithm, typ: "JWT", kid: options.kid };
	const claims = {
		iss: options.issuer,
		aud: options.audience ?? "atm-ledger",
		sub: "s8f-forged",
		iat: issuedAt,
		nbf: issuedAt,
		exp: issuedAt + (options.expiresInSeconds ?? TOKEN_LIFETIME_CLAIM_SECONDS),
		jti: randomUUID(),
		schools: [
			{
				id: "00000000-0000-0000-0000-000000000000",
				role: "owner",
				finance: true,
			},
		],
	};
	const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;
	if (algorithm === "none") return `${signingInput}.`;
	const pair = (await crypto.subtle.generateKey("Ed25519", false, [
		"sign",
		"verify",
	])) as CryptoKeyPair;
	const signature = await crypto.subtle.sign(
		"Ed25519",
		pair.privateKey,
		new TextEncoder().encode(signingInput),
	);
	return `${signingInput}.${base64url(new Uint8Array(signature))}`;
};

/** The real token with one claim changed and its signature kept: the signature no longer covers the payload. */
const tamperToken = (token: string, change: (claims: Json) => void): string => {
	const [header = "", payload = "", signature = ""] = token.split(".");
	const claims = decodeSegment(payload);
	change(claims);
	return `${header}.${base64url(JSON.stringify(claims))}.${signature}`;
};

// ---- the family service session (cookie jar in memory)

export type Grant = { id: string; role: string; finance: boolean };

export type Step =
	| { ok: true; reply: Reply }
	| { ok: false; status: "FAIL" | "BLOCKED"; why: string };

type QaLinkRunner = (
	email: string,
	purpose: "login" | "step_up",
) => Promise<{ token: string } | { error: string }>;

export type FlyAnswer =
	| { stdout: string; stderr: string; exitCode: number }
	| { error: string };

/** One ops command on the staging family service's machine, over `fly ssh console` (the `fly` CLI must be logged in). */
export const runFly = async (command: string): Promise<FlyAnswer> => {
	let process: ReturnType<typeof Bun.spawn>;
	try {
		process = Bun.spawn(
			["fly", "ssh", "console", "-a", FLY_APP, "-C", command],
			{
				stdout: "pipe",
				stderr: "pipe",
				timeout: FLY_TIMEOUT_MS,
			},
		);
	} catch {
		return { error: "the fly CLI is not installed or not on PATH" };
	}
	const [stdout, stderr] = await Promise.all([
		new Response(process.stdout as ReadableStream).text(),
		new Response(process.stderr as ReadableStream).text(),
	]);
	return { stdout, stderr, exitCode: await process.exited };
};

const flyQaLink: QaLinkRunner = async (email, purpose) => {
	if (!EMAIL_PATTERN.test(email))
		return { error: "the QA address is not a plain email address" };
	const answer = await runFly(
		`bun src/ops/cli.ts qa-link --email ${email} --purpose ${purpose} --by ${QA_OPERATOR} --apply`,
	);
	if ("error" in answer) return answer;
	const { stdout, stderr, exitCode } = answer;
	for (const line of stdout.split("\n").reverse()) {
		const trimmed = line.trim();
		if (!trimmed.startsWith("{")) continue;
		let parsed: Json;
		try {
			parsed = asRecord(JSON.parse(trimmed));
		} catch {
			continue;
		}
		if (typeof parsed.link === "string") {
			registerSecret(parsed.link);
			const fragment = new URL(parsed.link).hash.replace(/^#/, "");
			const token = new URLSearchParams(fragment).get("t");
			if (token === null || token === "")
				return { error: "the link has no #t= token" };
			registerSecret(token);
			return { token };
		}
		if (typeof parsed.error === "string") return { error: parsed.error };
	}
	return {
		error: `fly ssh exited ${exitCode} with no qa-link answer: ${scrub(stderr).trim().slice(0, 160)}`,
	};
};

export type Context = {
	targets: Targets;
	report: Report;
	inputs: Inputs;
	qaLink: QaLinkRunner;
	sleep(milliseconds: number): Promise<void>;
	log(line: string): void;
};

export type Inputs = {
	qaEmail: string | undefined;
	pin: string | undefined;
	adminEmail: string | undefined;
	adminPin: string | undefined;
	schoolId: string | undefined;
	paymentId: string | undefined;
	refundCents: number | undefined;
	bookingId: string | undefined;
	/** Stage 5: a school where the account's token is finance:false; else the token's first such school. */
	schoolIdNoFinance: string | undefined;
};

/** The headers of a `RequestInit` as a plain record, without the global `Headers` (happy-dom's under stage 5). */
const headerRecord = (
	headers: HeadersInit | undefined,
): Record<string, string> => {
	if (headers === undefined) return {};
	if (Array.isArray(headers)) return Object.fromEntries(headers);
	if (typeof (headers as Headers).forEach === "function") {
		const record: Record<string, string> = {};
		(headers as Headers).forEach((value, name) => {
			record[name] = value;
		});
		return record;
	}
	return { ...(headers as Record<string, string>) };
};

export class Session {
	readonly jar = new Map<string, string>();
	token: string | null = null;
	expiresAt = 0;
	schools: Grant[] = [];
	private signedIn = false;

	constructor(
		private readonly context: Context,
		readonly email: string,
		private readonly pin: string,
	) {
		registerSecret(pin);
	}

	private cookieHeader(): Record<string, string> {
		const cookie = [...this.jar].map(([name, value]) => `${name}=${value}`);
		return cookie.length === 0 ? {} : { cookie: cookie.join("; ") };
	}

	private keepCookies(headers: Headers): void {
		for (const line of headers.getSetCookie()) {
			const [pair = ""] = line.split(";");
			const separator = pair.indexOf("=");
			if (separator <= 0) continue;
			const name = pair.slice(0, separator).trim();
			const value = pair.slice(separator + 1).trim();
			if (value === "") this.jar.delete(name);
			else {
				this.jar.set(name, value);
				registerSecret(value);
			}
		}
	}

	async api(
		path: string,
		init: {
			method?: string;
			body?: unknown;
			headers?: Record<string, string>;
		} = {},
	): Promise<Reply> {
		const reply = await send(`${this.context.targets.api}${path}`, {
			method: init.method ?? "GET",
			headers: {
				origin: LEDGER_ORIGIN,
				"x-b4u": "1",
				...(init.body === undefined
					? {}
					: { "content-type": "application/json" }),
				...this.cookieHeader(),
				...init.headers,
			},
			body: init.body === undefined ? null : JSON.stringify(init.body),
		});
		this.keepCookies(reply.headers);
		return reply;
	}

	/**
	 * `fetch` as the ledger UI's browser build makes it from the ledger origin (stage 5): on the family service this
	 * session's cookies and the browser's `Origin` (LEDGER_ORIGIN), and the cookies it sets are kept; on the Worker
	 * nothing is added. A URL on any other origin is refused before a request is made.
	 */
	async browserFetch(url: string, init: RequestInit = {}): Promise<Response> {
		const { api, worker } = this.context.targets;
		const onApi = url.startsWith(`${api}/`);
		if (!(onApi || url.startsWith(`${worker}/`)))
			throw new UsageError(
				`${url.split("/")[2] ?? url} is not one of the two allow-listed hosts`,
			);
		const response = await withDeadline(
			Bun.fetch(url, {
				...init,
				redirect: "manual",
				headers: {
					...headerRecord(init.headers),
					...(onApi ? { origin: LEDGER_ORIGIN, ...this.cookieHeader() } : {}),
				},
			}),
			url,
		);
		if (onApi) this.keepCookies(response.headers);
		return response;
	}

	/** Mints a link over fly ssh and redeems it on the family service with this session's jar. */
	async redeem(purpose: "login" | "step_up"): Promise<Step> {
		const minted = await this.context.qaLink(this.email, purpose);
		if ("error" in minted) return qaLinkFailure(minted.error, this.email);
		const reply = await this.api("/family/verify", {
			method: "POST",
			body: { token: minted.token },
			headers: { origin: STAGING_WEB_ORIGIN },
		});
		if (reply.status !== 200)
			return {
				ok: false,
				status: "FAIL",
				why: `POST /family/verify answered ${describe(reply)}`,
			};
		return { ok: true, reply };
	}

	async verifyPin(): Promise<Step> {
		const reply = await this.api("/family/pin/verify", {
			method: "POST",
			body: { pin: this.pin },
		});
		if (reply.status !== 200)
			return {
				ok: false,
				status:
					reply.status === 403 || reply.status === 404 ? "BLOCKED" : "FAIL",
				why: `POST /family/pin/verify answered ${describe(reply)}${reply.status === 403 || reply.status === 404 ? " (S8F_PIN is wrong or no PIN is set: the account's owner supplies it)" : ""}`,
			};
		return { ok: true, reply };
	}

	/** POST /school-admin/ledger-token; one retry after a PIN unlock when the PIN has locked again. */
	async mint(): Promise<Step> {
		let reply = await this.api("/school-admin/ledger-token", {
			method: "POST",
			body: {},
		});
		if (reply.status === 403 && errorCodeOf(reply) === "pin_required") {
			const pin = await this.verifyPin();
			if (!pin.ok) return pin;
			reply = await this.api("/school-admin/ledger-token", {
				method: "POST",
				body: {},
			});
		}
		const body = asRecord(reply.json);
		if (reply.status === 404)
			return {
				ok: false,
				status: "BLOCKED",
				why: `account ${maskEmail(this.email)} administers no school on the staging relay (token mint 404): the owner makes this account a school owner or admin`,
			};
		if (reply.status === 403 && errorCodeOf(reply) === "pin_not_set")
			return {
				ok: false,
				status: "BLOCKED",
				why: `account ${maskEmail(this.email)} has no PIN set (403 pin_not_set): its owner sets one in the app; this script never sets a PIN`,
			};
		if (reply.status !== 200)
			return {
				ok: false,
				status: "FAIL",
				why: `POST /school-admin/ledger-token answered ${describe(reply)}${reply.status === 503 ? " (relay unavailable: try again)" : ""}`,
			};
		const schools = asArray(body.schools).map((entry) => {
			const grant = asRecord(entry);
			return {
				id: String(grant.id ?? ""),
				role: String(grant.role ?? ""),
				finance: grant.finance === true,
			};
		});
		if (typeof body.token !== "string" || typeof body.expiresAt !== "number")
			return {
				ok: false,
				status: "FAIL",
				why: "ledger-token answer lacks token or expiresAt",
			};
		if (schools.length === 0)
			return {
				ok: false,
				status: "BLOCKED",
				why: `account ${maskEmail(this.email)} administers no school on the staging relay (schools[] is empty): the owner makes this account a school owner or admin`,
			};
		registerSecret(body.token);
		this.token = body.token;
		this.expiresAt = body.expiresAt;
		this.schools = schools;
		return { ok: true, reply };
	}

	/** A token with more than a minute left, minted again when needed. */
	async freshToken(): Promise<string | null> {
		if (
			this.token !== null &&
			this.expiresAt - nowSeconds() > TOKEN_REFRESH_MARGIN_SECONDS
		)
			return this.token;
		const minted = await this.mint();
		return minted.ok ? this.token : null;
	}

	async worker(path: string): Promise<Reply> {
		const token = await this.freshToken();
		return send(`${this.context.targets.worker}${path}`, {
			headers: token === null ? {} : { authorization: `Bearer ${token}` },
		});
	}

	/** qa-link, verify, PIN, token: reports each step as `<stage>.<name>`; false when one did not pass. */
	async open(stage: number, report: Report): Promise<boolean> {
		if (this.signedIn && this.token !== null) return true;
		const steps: [string, () => Promise<Step>, (reply: Reply) => string][] = [
			[
				"qa-link-login",
				() => this.redeem("login"),
				() =>
					`minted over fly ssh and redeemed on ${new URL(this.context.targets.api).host} (cookie ${SESSION_COOKIE} ${this.jar.has(SESSION_COOKIE) ? "set" : "NOT set"})`,
			],
			["pin-verify", () => this.verifyPin(), () => "PIN accepted"],
			[
				"ledger-token",
				() => this.mint(),
				() => {
					const finance = this.schools.filter(
						(school) => school.finance,
					).length;
					return `token ${prefixOf(this.token ?? "")}, expires in ${this.expiresAt - nowSeconds()} s, schools[] ${this.schools.length} (finance on ${finance})`;
				},
			],
		];
		for (const [name, run, passed] of steps) {
			let step: Step;
			try {
				step = await run();
			} catch (error) {
				step = { ok: false, status: "FAIL", why: `error: ${String(error)}` };
			}
			if (!step.ok) {
				report.add(stage, name, step.status, step.why);
				return false;
			}
			report.add(stage, name, "PASS", passed(step.reply));
			if (name === "qa-link-login" && !this.jar.has(SESSION_COOKIE)) {
				report.add(
					stage,
					"session-cookie",
					"FAIL",
					`POST /family/verify set no ${SESSION_COOKIE} cookie`,
				);
				return false;
			}
		}
		this.signedIn = true;
		return true;
	}
}

const qaLinkFailure = (code: string, email: string): Step => {
	const who = maskEmail(email);
	const owner: Record<string, string> = {
		qa_links_off: `qa-link refused qa_links_off: the switch qa_links is off or ${who} is not in QA_EMAILS on ${FLY_APP}; the owner turns the switch on and lists the address`,
		not_qa_email: `qa-link refused not_qa_email: ${who} is not in QA_EMAILS on ${FLY_APP}; the owner adds it`,
		no_account: `qa-link refused no_account: ${who} is no guardian's or solo teen's login on staging; the owner creates the account`,
		limit: `qa-link refused limit: 50 links a day for ${who} are used`,
	};
	const blocked = owner[code];
	return blocked === undefined
		? { ok: false, status: "FAIL", why: `qa-link failed: ${code}` }
		: { ok: false, status: "BLOCKED", why: blocked };
};

// ---- helpers shared by the stages

export const currentMonthRange = (): { from: string; to: string } => {
	const today = new Date();
	const iso = (date: Date) => date.toISOString().slice(0, 10);
	return {
		from: iso(
			new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)),
		),
		to: iso(today),
	};
};

export const dayOffset = (days: number): string =>
	new Date(Date.now() + days * SECONDS_PER_DAY * MS_PER_SECOND)
		.toISOString()
		.slice(0, 10);

const requireEnvelope = (reply: Reply): string | null => {
	const body = asRecord(reply.json);
	if (!("asOf" in body && "lagMinutes" in body && "data" in body))
		return "answer is not the envelope {asOf, lagMinutes, data}";
	return null;
};

/** Runs one check; an exception is a FAIL with its message. */
export const check = async (
	context: Context,
	stage: number,
	name: string,
	run: () => Promise<{ status: Status; why: string }>,
): Promise<void> => {
	try {
		const result = await run();
		context.report.add(stage, name, result.status, result.why);
	} catch (error) {
		context.report.add(
			stage,
			name,
			"FAIL",
			`error: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
};

const expectStatus = (
	reply: Reply,
	status: number,
	code?: string,
): { status: Status; why: string } => {
	const matches =
		reply.status === status &&
		(code === undefined || errorCodeOf(reply) === code);
	return {
		status: matches ? "PASS" : "FAIL",
		why: `answered ${describe(reply)}${matches ? "" : `, expected ${status}${code === undefined ? "" : ` ${code}`}`}`,
	};
};

// ---- stage 1: no credential

/** A demo school's id (`src/demo.ts`). */
const DEMO_SCHOOL_PATTERN = /^demo-[a-z0-9-]+$/;
/** A school id of the real shape (a UUID) that no school has: without a token, the Worker refuses before it looks. */
const PLACEHOLDER_SCHOOL = "00000000-0000-4000-8000-000000000000";

/** The fixture schools' names, read from the UI's own fixture file. */
export const fixtureSchoolNames = async (
	path: string = FIXTURE_READER,
): Promise<string[]> => {
	const source = await readFile(path, "utf8");
	return [...source.matchAll(FIXTURE_SCHOOL_PATTERN)].map(
		(match) => match[2] as string,
	);
};

/** Which fixture names a bundle holds. A brand name counts only as a whole string literal, anything else as a substring. */
export const findFixtureNames = (
	bundle: string,
	names: readonly string[],
): string[] =>
	names.filter((name) => {
		if (!(BRAND_NAMES as readonly string[]).includes(name))
			return bundle.includes(name);
		return STRING_QUOTES.some((quote) =>
			bundle.includes(`${quote}${name}${quote}`),
		);
	});

type JwksKey = { kty?: string; crv?: string; kid?: string };

const fetchJwks = async (
	api: string,
): Promise<{ reply: Reply; keys: JwksKey[] }> => {
	const reply = await send(`${api}/.well-known/ledger-jwks.json`);
	return {
		reply,
		keys: asArray(asRecord(reply.json).keys).map(
			(key) => asRecord(key) as JwksKey,
		),
	};
};

const assetUrlsOf = (html: string, base: string): string[] => {
	const found = new Set<string>();
	for (const pattern of [SCRIPT_TAG_PATTERN, LINK_TAG_PATTERN])
		for (const match of html.matchAll(pattern))
			found.add(new URL(match[1] as string, `${base}/`).toString());
	return [...found];
};

export const stage1 = async (context: Context): Promise<void> => {
	const { worker, api } = context.targets;
	const stage = 1;

	await check(context, stage, "healthz", async () => {
		const reply = await send(`${worker}/healthz`);
		const ok = reply.status === 200 && asRecord(reply.json).ok === true;
		return {
			status: ok ? "PASS" : "FAIL",
			why: `GET /healthz answered ${describe(reply)}${ok ? " {ok:true}" : `: ${reply.text.slice(0, 80)}`}`,
		};
	});

	// Owner decision 2026-11-08: staging opens the demo schools to everyone, so no token lists those and nothing else.
	await check(context, stage, "no-token", async () => {
		const reply = await send(`${worker}/v1/schools`);
		const rows = asArray(asRecord(asRecord(reply.json).data).schools).map(
			asRecord,
		);
		const others = rows.filter(
			(row) =>
				row.demo !== true ||
				typeof row.id !== "string" ||
				!DEMO_SCHOOL_PATTERN.test(row.id),
		);
		const ok = reply.status === 200 && rows.length > 0 && others.length === 0;
		return {
			status: ok ? "PASS" : "FAIL",
			why: ok
				? `GET /v1/schools without a token lists only the ${rows.length} demo schools`
				: `GET /v1/schools without a token answered ${describe(reply)}, ${rows.length} rows, ${others.length} not demo schools`,
		};
	});

	await check(context, stage, "no-token-real-school", async () => {
		const reply = await send(
			`${worker}/v1/schools/${PLACEHOLDER_SCHOOL}/kpi?audience=public&pin=locked`,
		);
		const result = expectStatus(reply, 401, "token_missing");
		return {
			...result,
			why: `a real school's kpi without a token ${result.why}`,
		};
	});

	const { reply: jwksReply, keys } = await fetchJwks(api).catch(() => ({
		reply: null,
		keys: [] as JwksKey[],
	}));
	const kid = keys.find((key) => typeof key.kid === "string")?.kid;

	const forged: [string, ForgeOptions | null][] = [
		["forged-signature", kid ? { kid, issuer: api } : null],
		[
			"forged-expired",
			kid ? { kid, issuer: api, expiresInSeconds: -3600 } : null,
		],
		["alg-none", kid ? { kid, issuer: api, algorithm: "none" } : null],
		["wrong-aud", kid ? { kid, issuer: api, audience: "atm-other" } : null],
	];
	for (const [name, options] of forged) {
		await check(context, stage, name, async () => {
			if (options === null)
				return {
					status: "BLOCKED",
					why: `needs the real kid from ${api}/.well-known/ledger-jwks.json (the family service supplies it; the JWKS check below says why it is missing)`,
				};
			const token = await forgeToken(options);
			registerSecret(token);
			const reply = await send(`${worker}/v1/schools`, {
				headers: { authorization: `Bearer ${token}` },
			});
			const refused = reply.status === 401;
			return {
				status: refused ? "PASS" : "FAIL",
				why: `${name} token (real kid ${prefixOf(options.kid)}) ${refused ? "refused" : "NOT refused"}: ${describe(reply)}`,
			};
		});
	}

	await check(context, stage, "cors-preflight", async () => {
		const reply = await send(`${api}/school-admin/ledger-token`, {
			method: "OPTIONS",
			headers: {
				origin: LEDGER_ORIGIN,
				"access-control-request-method": "POST",
				"access-control-request-headers": "content-type,x-b4u",
			},
		});
		const origin = reply.headers.get("access-control-allow-origin");
		const credentials = reply.headers.get("access-control-allow-credentials");
		const ok =
			reply.status === 204 &&
			origin === LEDGER_ORIGIN &&
			credentials === "true";
		return {
			status: ok ? "PASS" : "FAIL",
			why: `preflight from ${LEDGER_ORIGIN}: ${reply.status}, allow-origin ${origin ?? "(none)"}, allow-credentials ${credentials ?? "(none)"}`,
		};
	});

	await check(context, stage, "cors-prod-origin", async () => {
		const reply = await send(`${api}/school-admin/ledger-token`, {
			method: "OPTIONS",
			headers: {
				origin: PRODUCTION_LEDGER_ORIGIN,
				"access-control-request-method": "POST",
			},
		});
		const origin = reply.headers.get("access-control-allow-origin");
		const allowed = origin === PRODUCTION_LEDGER_ORIGIN || origin === "*";
		return {
			status: allowed ? "FAIL" : "PASS",
			why: `preflight from ${PRODUCTION_LEDGER_ORIGIN}: ${reply.status}, allow-origin ${origin ?? "(none)"}${allowed ? " (production origin allowed on staging)" : ""}`,
		};
	});

	let html = "";
	let assets: string[] = [];
	await check(context, stage, "index-html", async () => {
		const reply = await send(`${worker}/`);
		const type = reply.headers.get("content-type") ?? "";
		const ok = reply.status === 200 && type.includes("text/html");
		html = reply.text;
		assets = assetUrlsOf(html, worker);
		return {
			status: ok ? "PASS" : "FAIL",
			why: `GET / answered ${reply.status} ${type.split(";")[0]}, ${assets.length} asset reference(s)`,
		};
	});

	const bundles: { url: string; text: string }[] = [];
	await check(context, stage, "assets", async () => {
		if (assets.length === 0)
			return {
				status: html === "" ? "BLOCKED" : "FAIL",
				why:
					html === ""
						? "needs GET / to load first"
						: "GET / references no script or stylesheet",
			};
		const problems: string[] = [];
		for (const url of assets) {
			if (!url.startsWith(`${worker}/`)) {
				problems.push(`${url} is not on ${worker}`);
				continue;
			}
			const reply = await send(url);
			if (reply.status !== 200)
				problems.push(`${new URL(url).pathname} ${reply.status}`);
			else if (JS_ASSET_PATTERN.test(url))
				bundles.push({ url, text: reply.text });
		}
		const seen = new Set(bundles.map((bundle) => bundle.url));
		let lazyChunks = 0;
		for (
			let index = 0;
			index < bundles.length && lazyChunks < MAX_LAZY_CHUNKS;
			index++
		) {
			const bundle = bundles[index];
			if (bundle === undefined) continue;
			for (const match of bundle.text.matchAll(CHUNK_IMPORT_PATTERN)) {
				const url = new URL(match[1] ?? "", bundle.url).href;
				if (seen.has(url) || !url.startsWith(`${worker}/`)) continue;
				seen.add(url);
				const reply = await send(url);
				if (reply.status !== 200) continue;
				bundles.push({ url, text: reply.text });
				lazyChunks++;
			}
		}
		return {
			status: problems.length === 0 ? "PASS" : "FAIL",
			why:
				problems.length === 0
					? `${assets.length} asset(s) load 200 (${bundles.length - lazyChunks} script, ${lazyChunks} lazy chunk(s) followed)`
					: problems.join("; "),
		};
	});

	await check(context, stage, "bundle-api-host", async () => {
		if (bundles.length === 0)
			return {
				status: "BLOCKED",
				why: "needs a JS bundle from the assets check",
			};
		const host = new URL(STAGING_API).host;
		const holds = bundles.some((bundle) => bundle.text.includes(host));
		const production = bundles.some((bundle) =>
			PROD_API_PATTERN.test(bundle.text),
		);
		const status: Status = holds && !production ? "PASS" : "FAIL";
		return {
			status,
			why: `bundle ${holds ? "contains" : "does NOT contain"} ${host}${production ? " and mentions the production api host" : ""}`,
		};
	});

	await check(context, stage, "bundle-http-build", async () => {
		if (bundles.length === 0)
			return {
				status: "BLOCKED",
				why: "needs a JS bundle from the assets check",
			};
		if (bundles.some((bundle) => bundle.text.includes(HTTP_BUILD_MARKER)))
			return {
				status: "PASS",
				why: "bundle is the HTTP build (it carries the signed-out demo alert)",
			};
		let names: string[];
		try {
			names = await fixtureSchoolNames();
		} catch {
			return {
				status: "BLOCKED",
				why: `cannot read ${FIXTURE_READER}: run this from the atm checkout`,
			};
		}
		if (names.length === 0)
			return {
				status: "FAIL",
				why: "no fixture school names found in the fixture file: the extraction pattern is stale",
			};
		const hits = new Set<string>();
		for (const bundle of bundles)
			for (const name of findFixtureNames(bundle.text, names)) hits.add(name);
		return {
			status: "FAIL",
			why:
				hits.size === 0
					? "bundle is not the HTTP build: no signed-out demo alert"
					: `fixture build deployed: fixture school name(s) ${[...hits].join(", ")} and no signed-out demo alert`,
		};
	});

	await check(context, stage, "spa-fallback", async () => {
		const reply = await send(`${worker}/ledger/members/42`);
		const type = reply.headers.get("content-type") ?? "";
		const ok =
			reply.status === 200 &&
			type.includes("text/html") &&
			(html === "" || reply.text === html);
		return {
			status: ok ? "PASS" : "FAIL",
			why: `GET /ledger/members/42 answered ${reply.status} ${type.split(";")[0]}${ok ? " (the app shell)" : ""}`,
		};
	});

	await check(context, stage, "jwks", async () => {
		if (jwksReply === null)
			return {
				status: "FAIL",
				why: `cannot reach ${api}/.well-known/ledger-jwks.json`,
			};
		const ed = keys.filter((key) => key.kty === "OKP" && key.crv === "Ed25519");
		const ok =
			jwksReply.status === 200 && ed.length >= 1 && ed.length === keys.length;
		return {
			status: ok ? "PASS" : "FAIL",
			why: `JWKS answered ${jwksReply.status} with ${keys.length} key(s), ${ed.length} Ed25519${keys.length > 1 ? " (a rotation window)" : ""}${kid ? `, kid ${prefixOf(kid)}` : ""}`,
		};
	});
};

// ---- stage 2: a QA account, the token and the Worker

export const missingAccount = (inputs: Inputs): string | null =>
	inputs.qaEmail === undefined || inputs.pin === undefined
		? "S8F_QA_EMAIL and S8F_PIN are not set: the owner supplies a QA address listed in QA_EMAILS on b4uni-stg-family whose account owns or administers a staging school and has a PIN set"
		: null;

const sessions = new WeakMap<Context, { owner?: Session; admin?: Session }>();

export const ownerSession = (context: Context): Session | null => {
	const { qaEmail, pin } = context.inputs;
	if (qaEmail === undefined || pin === undefined) return null;
	const held = sessions.get(context) ?? {};
	held.owner ??= new Session(context, qaEmail, pin);
	sessions.set(context, held);
	return held.owner;
};

const adminSession = (context: Context): Session | null => {
	const { adminEmail, adminPin, pin } = context.inputs;
	const effective = adminPin ?? pin;
	if (adminEmail === undefined || effective === undefined) return null;
	const held = sessions.get(context) ?? {};
	held.admin ??= new Session(context, adminEmail, effective);
	sessions.set(context, held);
	return held.admin;
};

/** The school this run works on: S8F_SCHOOL_ID when it is in the token, else the first. */
export const targetSchool = (
	context: Context,
	session: Session,
): { grant: Grant } | { blocked: string } => {
	const wanted = context.inputs.schoolId;
	if (wanted === undefined) {
		const first = session.schools[0];
		return first === undefined
			? { blocked: "the token lists no school" }
			: { grant: first };
	}
	const grant = session.schools.find((school) => school.id === wanted);
	return grant === undefined
		? {
				blocked: `account ${maskEmail(session.email)} does not administer S8F_SCHOOL_ID ${wanted} (token lists ${session.schools.map((school) => school.id).join(", ")}): the school's owner adds the account`,
			}
		: { grant };
};

export const stage2 = async (context: Context): Promise<void> => {
	const stage = 2;
	const { report } = context;
	const missing = missingAccount(context.inputs);
	const owner = ownerSession(context);
	if (missing !== null || owner === null) {
		report.add(stage, "session", "BLOCKED", missing ?? "no QA account");
		return;
	}
	if (!(await owner.open(stage, report))) return;
	const chosen = targetSchool(context, owner);
	if ("blocked" in chosen) {
		report.add(stage, "school", "BLOCKED", chosen.blocked);
		return;
	}
	const school = chosen.grant;
	report.add(
		stage,
		"school",
		"PASS",
		`working on school ${school.id} (${school.role}, finance ${school.finance})`,
	);

	await check(context, stage, "schools-envelope", async () => {
		const reply = await owner.worker("/v1/schools");
		const problem = requireEnvelope(reply);
		const listed = asArray(asRecord(asRecord(reply.json).data).schools).some(
			(entry) => asRecord(entry).id === school.id,
		);
		const ok = reply.status === 200 && problem === null && listed;
		const asOf = asRecord(reply.json).asOf;
		return {
			status: ok ? "PASS" : "FAIL",
			why: ok
				? `GET /v1/schools 200 envelope {asOf,lagMinutes,data}, asOf ${asOf === null ? "null (no views yet)" : String(asOf)}, lists ${school.id}`
				: `GET /v1/schools answered ${describe(reply)}${problem ? `: ${problem}` : ""}${listed ? "" : `; ${school.id} not in data.schools`}`,
		};
	});

	const real = owner.token;
	if (real !== null) {
		await check(context, stage, "tampered-token", async () => {
			const token = tamperToken(real, (claims) => {
				claims.jti = "tampered";
			});
			registerSecret(token);
			const reply = await send(`${context.targets.worker}/v1/schools`, {
				headers: { authorization: `Bearer ${token}` },
			});
			return {
				...expectStatus(reply, 401),
				why: `tampered copy of the real token ${expectStatus(reply, 401).why}`,
			};
		});
		await check(context, stage, "expired-looking-token", async () => {
			const token = tamperToken(real, (claims) => {
				const issuedAt = Number(claims.iat ?? nowSeconds());
				claims.exp = issuedAt - 10;
			});
			registerSecret(token);
			const reply = await send(`${context.targets.worker}/v1/schools`, {
				headers: { authorization: `Bearer ${token}` },
			});
			return {
				...expectStatus(reply, 401),
				why: `expired-looking copy ${expectStatus(reply, 401).why}`,
			};
		});
	}

	// Finance gating needs a token that is finance:false on some school. A second QA admin without the grant gives one;
	// so does the first account's own token when it lists a school it administers without the grant.
	let gate: { session: Session; schoolId: string; source: string } | null =
		null;
	const admin = adminSession(context);
	if (admin !== null) {
		if (!(await admin.open(stage, report))) return;
		const adminChoice = targetSchool(
			{ ...context, inputs: { ...context.inputs, schoolId: school.id } },
			admin,
		);
		if ("blocked" in adminChoice) {
			report.add(stage, "finance-gating", "BLOCKED", adminChoice.blocked);
			return;
		}
		if (adminChoice.grant.finance) {
			report.add(
				stage,
				"finance-gating",
				"BLOCKED",
				`S8F_QA_EMAIL_ADMIN holds the finance grant (or owns) on ${school.id}: the school's owner removes the grant, or supplies an admin without it`,
			);
			return;
		}
		gate = {
			session: admin,
			schoolId: school.id,
			source: "S8F_QA_EMAIL_ADMIN",
		};
	} else {
		const withoutGrant = owner.schools.find((grant) => !grant.finance);
		if (withoutGrant)
			gate = {
				session: owner,
				schoolId: withoutGrant.id,
				source: "the first account's token, finance:false on this school",
			};
	}
	if (gate === null) {
		report.add(
			stage,
			"finance-gating",
			"BLOCKED",
			"needs a token that is finance:false on a school: a second QA account that administers the school without the finance grant (S8F_QA_EMAIL_ADMIN, and S8F_PIN_ADMIN when its PIN differs), or a school the first account administers without the grant",
		);
		return;
	}
	const { session: gatedSession, schoolId: gatedSchool, source } = gate;
	const { from, to } = currentMonthRange();
	const gated: [string, string, number, string][] = [
		[
			"finance-ledger",
			`/v1/schools/${gatedSchool}/ledger?from=${from}&to=${to}`,
			403,
			"finance_required",
		],
		[
			"finance-income-statement",
			`/v1/schools/${gatedSchool}/income-statement?from=${from}&to=${to}`,
			403,
			"finance_required",
		],
		[
			"audience-finance",
			`/v1/schools/${gatedSchool}/kpi?audience=finance&pin=open`,
			403,
			"audience_not_allowed",
		],
	];
	for (const [name, path, status, code] of gated)
		await check(context, stage, name, async () => {
			const result = expectStatus(
				await gatedSession.worker(path),
				status,
				code,
			);
			return {
				...result,
				why: `finance:false (${source}) ${path.split("?")[0]?.split("/").pop()} ${result.why}`,
			};
		});
};

// ---- stage 3: views exist

export const stage3 = async (context: Context): Promise<void> => {
	const stage = 3;
	const { report } = context;
	const missing = missingAccount(context.inputs);
	const owner = ownerSession(context);
	if (missing !== null || owner === null) {
		report.add(stage, "session", "BLOCKED", missing ?? "no QA account");
		return;
	}
	if (!(await owner.open(stage, report))) return;
	const chosen = targetSchool(context, owner);
	if ("blocked" in chosen) {
		report.add(stage, "school", "BLOCKED", chosen.blocked);
		return;
	}
	const school = chosen.grant;

	const noViews =
		"no views yet: the R2 key (owner, ~/.config/b4uni/r2-stg-ledger-s3.env) and the switch ledger_export must be on and a school event shipped, see plans/ledger-ui/S8f-staging-runbook.md";
	let hasViews = false;
	await check(context, stage, "views-present", async () => {
		const reply = await owner.worker("/v1/schools");
		const entry = asArray(asRecord(asRecord(reply.json).data).schools)
			.map(asRecord)
			.find((candidate) => candidate.id === school.id);
		if (reply.status !== 200 || entry === undefined)
			return {
				status: "FAIL",
				why: `GET /v1/schools answered ${describe(reply)}`,
			};
		if (entry.asOf === null || entry.asOf === undefined)
			return { status: "BLOCKED", why: noViews };
		hasViews = true;
		const fresh = entry.stale === false;
		return {
			status: fresh ? "PASS" : "FAIL",
			why: `${school.id} asOf ${String(entry.asOf)}, lagMinutes ${String(entry.lagMinutes)}, stale ${String(entry.stale)}${fresh ? "" : " (the ship or the views job is behind: more than 15 minutes)"}`,
		};
	});

	const waiting = { status: "BLOCKED" as const, why: noViews };
	await check(context, stage, "kpi-owner", async () => {
		if (!hasViews) return waiting;
		const reply = await owner.worker(
			`/v1/schools/${school.id}/kpi?audience=owner&pin=open`,
		);
		const asOf = asRecord(reply.json).asOf;
		const ok = reply.status === 200 && typeof asOf === "string";
		return {
			status: ok ? "PASS" : "FAIL",
			why: `kpi audience=owner pin=open answered ${describe(reply)}, asOf ${String(asOf)}`,
		};
	});
	await check(context, stage, "ledger-month", async () => {
		if (!hasViews) return waiting;
		if (!school.finance)
			return {
				status: "BLOCKED",
				why: `account ${maskEmail(owner.email)} has finance:false on ${school.id}: the ledger needs the owner or an admin with the finance grant`,
			};
		const { from, to } = currentMonthRange();
		const reply = await owner.worker(
			`/v1/schools/${school.id}/ledger?from=${from}&to=${to}`,
		);
		const body = asRecord(reply.json);
		const ok =
			reply.status === 200 &&
			typeof body.asOf === "string" &&
			typeof body.lagMinutes === "number";
		return {
			status: ok ? "PASS" : "FAIL",
			why: `ledger ${from}..${to} answered ${describe(reply)}, asOf ${String(body.asOf)}, lagMinutes ${String(body.lagMinutes)}, ${asArray(asRecord(body.data).days).length} day group(s)`,
		};
	});
};

// ---- stage 4: a refund and a booking cancel (staging, Stripe TEST mode)

export const missingForRefund = (inputs: Inputs): string[] => {
	const missing: string[] = [];
	if (inputs.qaEmail === undefined || inputs.pin === undefined)
		missing.push(
			"S8F_QA_EMAIL/S8F_PIN (the owner supplies a QA owner account)",
		);
	if (inputs.schoolId === undefined)
		missing.push(
			"S8F_SCHOOL_ID (the staging school with Stripe TEST mode connected: the owner names or creates it)",
		);
	if (inputs.paymentId === undefined)
		missing.push(
			"S8F_PAYMENT_ID (a pi_ or ch_ of a Stripe TEST-mode charge for a paid member: the owner supplies it after connecting a restricted test key and paying)",
		);
	if (inputs.refundCents === undefined)
		missing.push(
			"S8F_REFUND_CENTS (the amount to refund, set explicitly by whoever runs this)",
		);
	return missing;
};

/** A ledger entry a poll looks for: `detail` names it in the line ("payment.refunded for payment ch_…"). */
export type LedgerHit = {
	found: boolean;
	detail: string;
	entryTime: string | null;
};

const refundEntryIn = (
	page: unknown,
	paymentId: string,
	refundCents: number,
	since: number,
): LedgerHit => {
	for (const day of asArray(asRecord(page).days))
		for (const raw of asArray(asRecord(day).entries)) {
			const entry = asRecord(raw);
			const event = asRecord(entry.event);
			if (event.event_type !== "payment.refunded") continue;
			const time = Date.parse(String(event.event_time));
			const byPayment = entry.paymentId === paymentId;
			const byAmount = entry.amountCents === -refundCents && time >= since;
			if (byPayment || byAmount)
				return {
					found: true,
					entryTime: String(event.event_time),
					detail: byPayment
						? `payment.refunded for payment ${paymentId}`
						: `payment.refunded for payment ${String(entry.paymentId)} (matched by amount -${refundCents} and time: the event names another id than S8F_PAYMENT_ID)`,
				};
		}
	return { found: false, detail: "", entryTime: null };
};

export type RefundRequest = {
	schoolId: string;
	paymentId: string;
	refundCents: number;
	idempotencyKey: string;
	note: string;
};

/** `POST /school-admin/schools/<id>/billing/refunds` with the Idempotency-Key (the PIN open and a step-up first). */
export const postRefund = (
	owner: Session,
	request: RefundRequest,
): Promise<Reply> =>
	owner.api(`/school-admin/schools/${request.schoolId}/billing/refunds`, {
		method: "POST",
		body: {
			...(request.paymentId.startsWith("pi_")
				? { paymentIntentId: request.paymentId }
				: { chargeId: request.paymentId }),
			amountCents: request.refundCents,
			reason: "requested_by_customer",
			note: request.note,
		},
		headers: { "idempotency-key": request.idempotencyKey },
	});

/** The refund route's answer: the refund id and Stripe's status, or why there is none. */
export const refundOutcome = (
	reply: Reply,
):
	| { refundId: string; stripeStatus: string | null; why: string }
	| { refundId: null; why: string } => {
	const answer = asRecord(reply.json);
	if (reply.status !== 200 || typeof answer.refundId !== "string")
		return {
			refundId: null,
			why: `POST billing/refunds answered ${describe(reply)}`,
		};
	return {
		refundId: answer.refundId,
		stripeStatus: typeof answer.status === "string" ? answer.status : null,
		why: `refund ${answer.refundId} Stripe status ${String(answer.status)}, refunded ${String(answer.refundedCents)} cents, remaining ${String(answer.remainingCents)}, replayed ${String(answer.replayed)}`,
	};
};

/**
 * Polls the Worker's ledger at `path` every 30 s for up to 15 minutes until `find` sees the entry and `asOf` is after
 * `after` (ms): what a write must reach before the UI's pending state clears. Each poll is logged.
 */
export const pollLedger = async (
	context: Context,
	owner: Session,
	options: {
		path: string;
		find: (page: unknown) => LedgerHit;
		after: number;
		label: string;
		afterWhat: string;
	},
): Promise<{ status: Status; why: string }> => {
	const started = Date.now();
	let attempt = 0;
	let last = "no answer yet";
	while (Date.now() - started < POLL_TIMEOUT_MS) {
		attempt += 1;
		const reply = await owner.worker(options.path);
		const body = asRecord(reply.json);
		const hit = options.find(body.data);
		const asOf = typeof body.asOf === "string" ? Date.parse(body.asOf) : null;
		last = `ledger ${describe(reply)}, asOf ${String(body.asOf)}, ${options.label} ${hit.found ? "present" : "absent"}`;
		context.log(
			`  poll ${attempt} (${Math.round((Date.now() - started) / MS_PER_SECOND)} s): ${last}`,
		);
		if (hit.found && asOf !== null && asOf > options.after)
			return {
				status: "PASS",
				why: `${hit.detail} at ${hit.entryTime} is in the ledger and asOf ${String(body.asOf)} is after ${options.afterWhat} (${Math.round((Date.now() - started) / MS_PER_SECOND)} s)`,
			};
		await context.sleep(POLL_INTERVAL_MS);
	}
	return {
		status: "FAIL",
		why: `no ${options.label} with asOf after ${options.afterWhat} within ${POLL_TIMEOUT_MS / MS_PER_MINUTE} minutes; last: ${last} (check ledger_export, the webhook, ledger-status and the cron)`,
	};
};

export const stage4 = async (context: Context): Promise<void> => {
	const stage = 4;
	const { report, inputs } = context;
	const owner = ownerSession(context);
	const missing = missingForRefund(inputs);
	const bookingMissing =
		inputs.bookingId === undefined
			? "S8F_BOOKING_ID (a booking of the staging school: the owner books one)"
			: null;
	if (missing.length > 0 || owner === null) {
		report.add(stage, "refund", "BLOCKED", `missing: ${missing.join("; ")}`);
		report.add(
			stage,
			"booking-cancel",
			"BLOCKED",
			`missing: ${[...missing.slice(0, 3).filter((item) => !item.startsWith("S8F_PAYMENT_ID")), ...(bookingMissing === null ? [] : [bookingMissing])].join("; ")}`,
		);
		return;
	}
	if (!(await owner.open(stage, report))) return;
	const chosen = targetSchool(context, owner);
	if ("blocked" in chosen) {
		report.add(stage, "school", "BLOCKED", chosen.blocked);
		return;
	}
	const schoolId = chosen.grant.id;
	const paymentId = inputs.paymentId as string;
	const refundCents = inputs.refundCents as number;

	let stripeReady = false;
	await check(context, stage, "stripe-connected", async () => {
		const reply = await owner.api(
			`/school-admin/schools/${schoolId}/ledger/capabilities`,
		);
		const connected = asRecord(reply.json).stripeConnected === true;
		stripeReady = reply.status === 200 && connected;
		return reply.status !== 200
			? { status: "FAIL", why: `capabilities answered ${describe(reply)}` }
			: {
					status: connected ? "PASS" : "BLOCKED",
					why: connected
						? `school ${schoolId} has Stripe connected`
						: `school ${schoolId} has no Stripe connected: the owner connects a TEST-mode restricted key (docs/features/school-billing.md, "Connect, publish, webhook")`,
				};
	});

	let steppedUp = false;
	await check(context, stage, "step-up", async () => {
		const step = await owner.redeem("step_up");
		steppedUp = step.ok;
		return step.ok
			? {
					status: "PASS",
					why: "step-up link minted and verified with the same session (good for 10 minutes)",
				}
			: { status: step.status, why: step.why };
	});

	let refundId: string | null = null;
	let refundedAt = 0;
	const refundRequest: RefundRequest = {
		schoolId,
		paymentId,
		refundCents,
		idempotencyKey: `s8f-${randomUUID()}`,
		note: "S8f staging e2e",
	};
	await check(context, stage, "refund", async () => {
		if (!(stripeReady && steppedUp))
			return {
				status: "BLOCKED",
				why: "needs Stripe connected on the school and a step-up (lines above)",
			};
		const outcome = refundOutcome(await postRefund(owner, refundRequest));
		refundedAt = Date.now();
		if (outcome.refundId === null) return { status: "FAIL", why: outcome.why };
		refundId = outcome.refundId;
		return {
			status: outcome.stripeStatus === null ? "FAIL" : "PASS",
			why: outcome.why,
		};
	});

	await check(context, stage, "refund-replay", async () => {
		if (refundId === null)
			return { status: "BLOCKED", why: "needs the refund line above to pass" };
		const reply = await postRefund(owner, refundRequest);
		const answer = asRecord(reply.json);
		const same = reply.status === 200 && answer.refundId === refundId;
		return {
			status: same ? "PASS" : "FAIL",
			why: `same Idempotency-Key answered ${describe(reply)}, refund ${same ? "the same" : "NOT the same"}, replayed ${String(answer.replayed)}`,
		};
	});

	await check(context, stage, "ledger-refund", async () => {
		if (refundId === null)
			return { status: "BLOCKED", why: "needs the refund line above to pass" };
		if (!chosen.grant.finance)
			return {
				status: "BLOCKED",
				why: `account ${maskEmail(owner.email)} has finance:false on ${schoolId}: the ledger needs finance`,
			};
		return pollLedger(context, owner, {
			path: `/v1/schools/${schoolId}/ledger?from=${dayOffset(-2)}&to=${dayOffset(1)}`,
			find: (page) =>
				refundEntryIn(
					page,
					paymentId,
					refundCents,
					refundedAt - POLL_INTERVAL_MS,
				),
			after: refundedAt,
			label: "payment.refunded entry",
			afterWhat: "the refund",
		});
	});

	await check(context, stage, "booking-cancel", async () => {
		if (bookingMissing !== null)
			return { status: "BLOCKED", why: `missing: ${bookingMissing}` };
		const bookingId = inputs.bookingId as string;
		const reply = await owner.api(
			`/school-admin/schools/${schoolId}/bookings/${bookingId}/cancel`,
			{ method: "POST", body: { reason: "S8f staging e2e" } },
		);
		if (reply.status !== 200)
			return {
				status: "FAIL",
				why: `POST bookings/<id>/cancel answered ${describe(reply)}`,
			};
		const listing = await owner.api(
			`/school-admin/schools/${schoolId}/bookings?from=${dayOffset(-BOOKING_WINDOW_DAYS)}&to=${dayOffset(BOOKING_WINDOW_DAYS)}`,
		);
		const booking = asArray(asRecord(listing.json).bookings)
			.map(asRecord)
			.find((candidate) => candidate.id === bookingId);
		if (listing.status !== 200)
			return {
				status: "FAIL",
				why: `GET bookings answered ${describe(listing)}`,
			};
		if (booking === undefined)
			return {
				status: "FAIL",
				why: `cancel answered 200 but the booking is not in GET bookings for ±${BOOKING_WINDOW_DAYS} days`,
			};
		const cancelled = booking.state === "cancelled";
		return {
			status: cancelled ? "PASS" : "FAIL",
			why: `cancel answered 200; GET bookings shows state ${String(booking.state)}`,
		};
	});
};

// ---- the run

/**
 * Stage 6 (S8d) is loaded when it runs: `staging-s8d.ts` imports this file. The path is a constant so that the UI
 * package's type check, which reaches this file through stage 5's script, does not follow it into the Worker's R2 code.
 */
const S8D_MODULE = "./staging-s8d.js";
const stage6 = async (context: Context): Promise<void> => {
	const loaded = (await import(S8D_MODULE)) as {
		stage6(context: Context): Promise<void>;
	};
	await loaded.stage6(context);
};

/**
 * Stage 7 (credit events, T12 of the credits engine) is loaded when it runs, like stage 6: it seeds three fixture schools
 * under `demo-s8f-*` in the staging bucket and needs the bundles and the R2 key.
 */
const CREDITS_MODULE = "./staging-credits.js";
const stage7 = async (context: Context): Promise<void> => {
	const loaded = (await import(CREDITS_MODULE)) as {
		stage7(context: Context): Promise<void>;
	};
	await loaded.stage7(context);
};

const STAGES: Record<number, (context: Context) => Promise<void>> = {
	1: stage1,
	2: stage2,
	3: stage3,
	4: stage4,
	6: stage6,
	7: stage7,
};
/** Stages 4 and 6 move (test) money and stage 7 writes fixture schools to the bucket, so only `--stage N` runs them. */
export const DEFAULT_STAGES: readonly number[] = [1, 2, 3];
/** packages/ledger-ui/scripts/staging-ui.ts. */
const UI_STAGE = 5;

export const runStages = async (
	context: Context,
	stages: readonly number[],
): Promise<void> => {
	for (const stage of stages) {
		const run = STAGES[stage];
		if (run === undefined) throw new UsageError(`no stage ${stage}`);
		await run(context);
	}
};

export const parseArgs = (
	argv: readonly string[],
): { stages: number[]; json: boolean; strict: boolean } => {
	let stages = [...DEFAULT_STAGES];
	let json = false;
	let strict = false;
	for (let index = 0; index < argv.length; index += 1) {
		const argument = argv[index] as string;
		if (argument === "--json") json = true;
		else if (argument === "--strict") strict = true;
		else if (argument === "--stage") {
			const value = argv[index + 1];
			index += 1;
			stages = (value ?? "").split(",").map(Number);
			if (stages.includes(UI_STAGE))
				throw new UsageError(
					`stage ${UI_STAGE} (the ledger UI's HTTP adapters) runs from the UI package: bun run --cwd packages/ledger-ui staging-ui`,
				);
			if (stages.some((stage) => !STAGES[stage]))
				throw new UsageError("--stage takes 1 to 4, 6 or 7, e.g. --stage 1,2");
		} else throw new UsageError(`unknown argument ${argument}`);
	}
	return { stages, json, strict };
};

const inputFrom = (
	env: Record<string, string | undefined>,
	name: string,
	valid: (value: string) => boolean,
): string | undefined => {
	const value = env[name]?.trim();
	if (value === undefined || value === "") return undefined;
	if (!valid(value))
		throw new UsageError(`${name} is set but not in the expected form`);
	return value;
};

export const inputsFrom = (env: Record<string, string | undefined>): Inputs => {
	const cents = inputFrom(
		env,
		"S8F_REFUND_CENTS",
		(value) => /^\d{1,8}$/.test(value) && Number(value) > 0,
	);
	return {
		qaEmail: inputFrom(env, "S8F_QA_EMAIL", (value) =>
			EMAIL_PATTERN.test(value),
		),
		pin: inputFrom(env, "S8F_PIN", (value) => PIN_PATTERN.test(value)),
		adminEmail: inputFrom(env, "S8F_QA_EMAIL_ADMIN", (value) =>
			EMAIL_PATTERN.test(value),
		),
		adminPin: inputFrom(env, "S8F_PIN_ADMIN", (value) =>
			PIN_PATTERN.test(value),
		),
		schoolId: inputFrom(env, "S8F_SCHOOL_ID", (value) =>
			UUID_PATTERN.test(value),
		)?.toLowerCase(),
		paymentId: inputFrom(env, "S8F_PAYMENT_ID", (value) =>
			PAYMENT_PATTERN.test(value),
		),
		refundCents: cents === undefined ? undefined : Number(cents),
		bookingId: inputFrom(env, "S8F_BOOKING_ID", (value) =>
			UUID_PATTERN.test(value),
		)?.toLowerCase(),
		schoolIdNoFinance: inputFrom(env, "S8F_SCHOOL_ID_NO_FINANCE", (value) =>
			UUID_PATTERN.test(value),
		)?.toLowerCase(),
	};
};

export type Arguments = { stages: number[]; json: boolean; strict: boolean };

/**
 * The command line around a run: the inputs from `env`, the allow-list, the lines, the table and the exit code. Stage
 * 5's script (packages/ledger-ui/scripts/staging-ui.ts) runs through it with its own `parse` and `run`.
 */
export const runCommand = async (options: {
	title: string;
	argv: readonly string[];
	env: Record<string, string | undefined>;
	parse(argv: readonly string[]): Arguments;
	run(context: Context, stages: readonly number[]): Promise<void>;
}): Promise<number> => {
	const { env } = options;
	let args: Arguments;
	let context: Context;
	try {
		args = options.parse(options.argv);
		const targets = resolveTargets({
			worker: env.S8F_WORKER,
			api: env.S8F_API,
		});
		const inputs = inputsFrom(env);
		registerSecret(inputs.pin);
		registerSecret(inputs.adminPin);
		const print = args.json
			? (line: string) => console.error(line)
			: (line: string) => console.log(line);
		context = {
			targets,
			report: newReport(print),
			inputs,
			qaLink: flyQaLink,
			sleep: (milliseconds) =>
				new Promise((resolve) => setTimeout(resolve, milliseconds)),
			log: print,
		};
	} catch (error) {
		if (error instanceof UsageError) {
			console.error(`usage: ${error.message}`);
			return 2;
		}
		throw error;
	}
	console.error(
		`${options.title}: worker ${context.targets.worker}, api ${context.targets.api}, stages ${args.stages.join(",")}`,
	);
	await options.run(context, args.stages);
	const { results } = context.report;
	const table = summarize(results);
	if (args.json)
		console.log(
			JSON.stringify({ results, summary: table, strict: args.strict }, null, 2),
		);
	else {
		console.log("");
		console.log("stage  PASS  FAIL  BLOCKED");
		for (const row of table)
			console.log(
				`${String(row.stage).padEnd(5)}  ${String(row.pass).padEnd(4)}  ${String(row.fail).padEnd(4)}  ${row.blocked}`,
			);
	}
	return exitCodeOf(results, args.strict);
};

if (import.meta.main)
	process.exit(
		await runCommand({
			title: "S8f staging e2e",
			argv: process.argv.slice(2),
			env: process.env,
			parse: parseArgs,
			run: runStages,
		}),
	);
