/**
 * Stage 6 of the staging end-to-end, S8d: buzz-school's own routes put money and catalog events into the ledger.
 *
 *   bun run --cwd packages/ledger-worker staging-e2e --stage 6
 *
 * It moves (test) money, so only `--stage 6` runs it (never the default). As the school's owner, with the PIN open, it
 * saves the school's latest menu with one visible change (the tier blurb) and publishes it, refunds `S8F_REFUND_CENTS`
 * of `S8F_PAYMENT_ID` through the refund route stage 4 uses, then follows both events: the family service's outbox
 * (`ledger-status` over `fly ssh`), the bucket's event files and watermark (Bun's S3 client with the R2 key file), and
 * the Worker's ledger. Same lines, exit codes, allow-list and redaction as `staging-e2e.ts`, whose exports it uses.
 * Runbook: plans/ledger-ui/S8f-staging-runbook.md, "Stage 6".
 */
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { watermarkKey } from "../src/data/watermark.js";
import type { BucketConnection } from "./seed-r2.js";
import {
	asArray,
	asRecord,
	type Context,
	check,
	dayOffset,
	describe,
	errorCodeOf,
	FLY_APP,
	type LedgerHit,
	MS_PER_SECOND,
	missingForRefund,
	ownerSession,
	POLL_INTERVAL_MS,
	POLL_TIMEOUT_MS,
	pollLedger,
	postRefund,
	type Reply,
	refundOutcome,
	registerSecret,
	runFly,
	type Session,
	type Status,
	scrub,
	targetSchool,
} from "./staging-e2e.js";

const STAGE = 6;
/** The order the checks run and print in. */
export const S8D_CHECKS = [
	"menu-publish",
	"refund",
	"outbox-shipped",
	"r2-events",
	"watermark",
	"worker-ledger",
	"worker-catalog",
] as const;
/** The publish (`catalog.published`) and the refund (`payment.refunded`): the outbox grows by at least this many rows. */
const EXPECTED_NEW_ROWS = 2;
const EXPECTED_ENV = "test";
const STRIPE_DONE = new Set(["succeeded", "pending"]);
const PREFERRED_TIER = "s8f-monthly";
const LEDGER_STATUS_COMMAND = "bun src/ops/cli.ts ledger-status";
const R2_ENV_FILE = join(homedir(), ".config/b4uni/r2-stg-ledger-s3.env");
const R2_NAMES = [
	"R2_LEDGER_ENDPOINT",
	"R2_LEDGER_BUCKET",
	"R2_LEDGER_ACCESS_KEY_ID",
	"R2_LEDGER_SECRET_ACCESS_KEY",
] as const;
const DAY_MS = 86_400_000;
const SECONDS_PER_MINUTE = 60;
const STDERR_PREFIX_LENGTH = 160;
/** An address anywhere in a string, not only a whole one. */
const EMAIL_IN_TEXT = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const ENV_LINE = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*?)\s*$/;
const QUOTED = /^(["'])(.*)\1$/;

// ---- ledger-status

/** One school's row in `ledger-status` (atm's `OutboxStatus`, the fields this stage reads). */
export type SchoolOutbox = {
	school: string;
	total: number;
	shipped: number;
	unshipped: number;
	/** Milliseconds, or null when nothing has shipped. */
	lastShippedAt: number | null;
};

export type LedgerStatusReport = {
	env: string;
	schools: SchoolOutbox[];
	unshippedWrongEnv: number;
};

const isCount = (value: unknown): value is number =>
	typeof value === "number" && Number.isInteger(value) && value >= 0;

const schoolOutboxOf = (raw: unknown): SchoolOutbox | null => {
	const entry = asRecord(raw);
	const { school, total, shipped, unshipped, lastShippedAt } = entry;
	if (
		typeof school !== "string" ||
		!isCount(total) ||
		!isCount(shipped) ||
		!isCount(unshipped)
	)
		return null;
	if (lastShippedAt !== null && typeof lastShippedAt !== "number") return null;
	return { school, total, shipped, unshipped, lastShippedAt };
};

/**
 * The JSON line `ledger-status` prints, from everything `fly ssh console` wrote (its own banner lines included): the last
 * line that is a JSON object with a `schools` array. Null when there is none or a school's row is not the expected shape.
 */
export const parseLedgerStatus = (
	stdout: string,
): LedgerStatusReport | null => {
	for (const line of stdout.split("\n").reverse()) {
		const trimmed = line.trim();
		if (!trimmed.startsWith("{")) continue;
		let parsed: Record<string, unknown>;
		try {
			parsed = asRecord(JSON.parse(trimmed));
		} catch {
			continue;
		}
		if (!Array.isArray(parsed.schools)) continue;
		const schools = parsed.schools.map(schoolOutboxOf);
		if (schools.some((school) => school === null)) return null;
		return {
			env: typeof parsed.env === "string" ? parsed.env : "",
			schools: schools as SchoolOutbox[],
			unshippedWrongEnv: isCount(parsed.unshippedWrongEnv)
				? parsed.unshippedWrongEnv
				: 0,
		};
	}
	return null;
};

/** The school's row; a school with no outbox row yet is all zeros. */
export const outboxOf = (
	report: LedgerStatusReport,
	school: string,
): SchoolOutbox =>
	report.schools.find((entry) => entry.school === school) ?? {
		school,
		total: 0,
		shipped: 0,
		unshipped: 0,
		lastShippedAt: null,
	};

/** Shipped: the school's outbox has grown by `expected` rows since `baseline` and none waits. */
export const outboxShipped = (
	now: SchoolOutbox,
	baseline: SchoolOutbox,
	expected: number = EXPECTED_NEW_ROWS,
): boolean => now.total >= baseline.total + expected && now.unshipped === 0;

const instantText = (milliseconds: number | null): string =>
	milliseconds === null ? "never" : new Date(milliseconds).toISOString();

// ---- the bucket's event files

/** The part of an S3 client this stage uses: a listing page and an object's text (Bun's `S3Client`, or a test's fake). */
export type EventBucket = {
	list(options: {
		prefix: string;
		startAfter?: string;
		continuationToken?: string;
	}): Promise<{
		contents?: { key: string }[];
		isTruncated?: boolean;
		nextContinuationToken?: string;
	}>;
	/** The object's text, or null when there is no such object. */
	text(key: string): Promise<string | null>;
};

export const eventsPrefixOf = (school: string): string =>
	`schools/${school}/events/date=`;

/**
 * The keys of the school's event files dated from the day before `since` (an event's `date` is the school's local day,
 * which can be the UTC day before) onwards, every listing page. `_shipped-through.json` sits outside `date=`.
 */
export const eventKeysSince = async (
	bucket: EventBucket,
	school: string,
	since: number,
): Promise<string[]> => {
	const prefix = eventsPrefixOf(school);
	const startAfter = `${prefix}${new Date(since - DAY_MS).toISOString().slice(0, 10)}`;
	const keys: string[] = [];
	let continuationToken: string | undefined;
	do {
		const page = await bucket.list(
			continuationToken === undefined
				? { prefix, startAfter }
				: { prefix, continuationToken },
		);
		for (const entry of page.contents ?? [])
			if (entry.key.endsWith(".jsonl")) keys.push(entry.key);
		continuationToken = page.isTruncated
			? page.nextContinuationToken
			: undefined;
	} while (continuationToken !== undefined);
	return keys;
};

export type LedgerEvent = Record<string, unknown> & {
	event_type: string;
	event_time: string;
};

export type FoundEvents = {
	catalog: LedgerEvent | null;
	refund: LedgerEvent | null;
	files: number;
	lines: number;
	/** Lines that were not a JSON object: the log is meant to hold none. */
	unreadable: number;
};

const timeOf = (event: Record<string, unknown>): number =>
	typeof event.event_time === "string"
		? Date.parse(event.event_time)
		: Number.NaN;

const later = (
	held: LedgerEvent | null,
	candidate: LedgerEvent,
): LedgerEvent =>
	held === null || timeOf(candidate) > timeOf(held) ? candidate : held;

/**
 * Reads the school's event files since `since` and picks, the latest of each: the `catalog.published` of menu `version`
 * and the `payment.refunded` of `refundCents`, both of this school with `event_time` at or after `since`.
 */
export const findS8dEvents = async (
	bucket: EventBucket,
	wanted: {
		school: string;
		since: number;
		version: number;
		refundCents: number;
	},
): Promise<FoundEvents> => {
	const found: FoundEvents = {
		catalog: null,
		refund: null,
		files: 0,
		lines: 0,
		unreadable: 0,
	};
	for (const key of await eventKeysSince(bucket, wanted.school, wanted.since)) {
		const text = await bucket.text(key);
		if (text === null) continue;
		found.files += 1;
		for (const line of text.split("\n")) {
			if (line.trim() === "") continue;
			found.lines += 1;
			let event: Record<string, unknown>;
			try {
				event = asRecord(JSON.parse(line));
			} catch {
				found.unreadable += 1;
				continue;
			}
			if (event.school !== wanted.school || !(timeOf(event) >= wanted.since))
				continue;
			const payload = asRecord(event.payload);
			if (
				event.event_type === "catalog.published" &&
				String(payload.version) === String(wanted.version)
			)
				found.catalog = later(found.catalog, event as LedgerEvent);
			if (
				event.event_type === "payment.refunded" &&
				payload.amount === wanted.refundCents
			)
				found.refund = later(found.refund, event as LedgerEvent);
		}
	}
	return found;
};

/**
 * The paths of every string in `value` that holds an email address (the paths only: the addresses are never printed).
 * A `name` inside a `menu` is a product's name the school typed and is left out.
 */
export const emailFieldsOf = (
	value: unknown,
	path: string[] = [],
): string[] => {
	if (typeof value === "string") {
		const key = path.at(-1);
		const productName = key === "name" && path.includes("menu");
		return !productName && EMAIL_IN_TEXT.test(value) ? [path.join(".")] : [];
	}
	if (Array.isArray(value))
		return value.flatMap((item, index) =>
			emailFieldsOf(item, [...path, String(index)]),
		);
	if (typeof value === "object" && value !== null)
		return Object.entries(value).flatMap(([key, item]) =>
			emailFieldsOf(item, [...path, key]),
		);
	return [];
};

/**
 * The Stripe mode an event names: its own `env`, else its `labels.env`. atm's log has no env field yet
 * (packages/atm/docs/log-and-r2.md, "Still open"), so `fallback`, the env the watermark of the same ship names, stands in
 * when the event names none, and the line says so.
 */
export const envOfEvent = (
	event: Record<string, unknown>,
	fallback: string | null,
): { env: string | null; from: "event" | "labels" | "watermark" | "none" } => {
	if (typeof event.env === "string") return { env: event.env, from: "event" };
	const labels = asRecord(event.labels);
	if (typeof labels.env === "string")
		return { env: labels.env, from: "labels" };
	return fallback === null
		? { env: null, from: "none" }
		: { env: fallback, from: "watermark" };
};

export type Watermark = {
	school: string | null;
	env: string | null;
	shippedThrough: number | null;
};

/** `_shipped-through.json` as written, `{ school, env, shippedThrough }`; null when it is missing or not JSON. */
export const parseWatermark = (text: string | null): Watermark | null => {
	if (text === null) return null;
	let body: Record<string, unknown>;
	try {
		body = asRecord(JSON.parse(text));
	} catch {
		return null;
	}
	const instant =
		typeof body.shippedThrough === "string"
			? Date.parse(body.shippedThrough)
			: Number.NaN;
	return {
		school: typeof body.school === "string" ? body.school : null,
		env: typeof body.env === "string" ? body.env : null,
		shippedThrough: Number.isNaN(instant) ? null : instant,
	};
};

// ---- the menu

/** The menu with one visible change: `blurb` on the tier `s8f-monthly`, else the first tier. Null without a tier. */
export const withBlurb = (
	menu: Record<string, unknown>,
	blurb: string,
): { menu: Record<string, unknown>; tierId: string } | null => {
	const tiers = asArray(menu.tiers).map(asRecord);
	const index = Math.max(
		0,
		tiers.findIndex((tier) => tier.id === PREFERRED_TIER),
	);
	const tier = tiers[index];
	if (tier === undefined || typeof tier.id !== "string") return null;
	return {
		menu: {
			...menu,
			tiers: tiers.map((each, position) =>
				position === index ? { ...each, blurb } : each,
			),
		},
		tierId: tier.id,
	};
};

const publishedVersionOf = (reply: Reply): number | null => {
	const version = asRecord(asRecord(reply.json).published).version;
	return typeof version === "number" ? version : null;
};

/** The newest version in `GET …/billing/menu/versions` (`{ versions: [{ version, publishedAt, savedAt }] }`). */
export const newestVersionOf = (body: unknown): number | null => {
	const versions = asArray(asRecord(body).versions)
		.map((entry) => asRecord(entry).version)
		.filter((version): version is number => typeof version === "number");
	return versions.length === 0 ? null : Math.max(...versions);
};

/** A `catalog.published` row of menu `version` in a Worker ledger page, at or after `since`. */
export const catalogEntryIn = (
	page: unknown,
	version: number,
	since: number,
): LedgerHit => {
	for (const day of asArray(asRecord(page).days))
		for (const raw of asArray(asRecord(day).entries)) {
			const event = asRecord(asRecord(raw).event);
			if (event.event_type !== "catalog.published") continue;
			if (String(asRecord(event.payload).version) !== String(version)) continue;
			if (!(timeOf(event) >= since)) continue;
			return {
				found: true,
				detail: `catalog.published of menu version ${version}`,
				entryTime: String(event.event_time),
			};
		}
	return { found: false, detail: "", entryTime: null };
};

/**
 * This run's `payment.refunded` row in a Worker ledger page: at or after `since`, for `paymentId` or for `-refundCents`.
 * Stage 4's matcher takes a row of the payment at any time; the charge here has earlier refunds, so time comes first.
 */
export const refundSinceIn = (
	page: unknown,
	paymentId: string,
	refundCents: number,
	since: number,
): LedgerHit => {
	for (const day of asArray(asRecord(page).days))
		for (const raw of asArray(asRecord(day).entries)) {
			const entry = asRecord(raw);
			const event = asRecord(entry.event);
			if (event.event_type !== "payment.refunded" || !(timeOf(event) >= since))
				continue;
			if (entry.paymentId !== paymentId && entry.amountCents !== -refundCents)
				continue;
			return {
				found: true,
				detail: `payment.refunded of ${-Number(entry.amountCents)} cents for payment ${String(entry.paymentId)}`,
				entryTime: String(event.event_time),
			};
		}
	return { found: false, detail: "", entryTime: null };
};

// ---- what the live run reaches: fly ssh and the bucket

export type S8dDependencies = {
	/** `ledger-status` on the family service's machine. */
	ledgerStatus(): Promise<{ report: LedgerStatusReport } | { error: string }>;
	/** The staging bucket, or why it cannot be opened (the line is BLOCKED). */
	openBucket(): Promise<{ bucket: EventBucket } | { blocked: string }>;
	now(): number;
};

const flyLedgerStatus: S8dDependencies["ledgerStatus"] = async () => {
	const answer = await runFly(LEDGER_STATUS_COMMAND);
	if ("error" in answer) return answer;
	const report = parseLedgerStatus(answer.stdout);
	return report === null
		? {
				error: `fly ssh exited ${answer.exitCode} with no ledger-status answer: ${scrub(answer.stderr).trim().slice(0, STDERR_PREFIX_LENGTH)}`,
			}
		: { report };
};

/** `KEY=value` lines of an env file (comments, `export` and quotes allowed). */
export const parseEnvFile = (text: string): Record<string, string> => {
	const values: Record<string, string> = {};
	for (const line of text.split("\n")) {
		if (line.trim().startsWith("#")) continue;
		const match = ENV_LINE.exec(line);
		if (match === null) continue;
		const [, name = "", raw = ""] = match;
		values[name] = raw.replace(QUOTED, "$2");
	}
	return values;
};

/**
 * The R2 key: the four `R2_LEDGER_*` variables from the environment, else from `~/.config/b4uni/r2-stg-ledger-s3.env`.
 * seed:r2's `connectionOf` refuses every bucket but `b4uni-stg-ledger` and every host outside R2. No value is printed.
 */
export const openLiveConnection = async (): Promise<
	{ connection: BucketConnection } | { blocked: string }
> => {
	let values: Record<string, string | undefined> = process.env;
	if (R2_NAMES.some((name) => !process.env[name]))
		try {
			values = parseEnvFile(await readFile(R2_ENV_FILE, "utf8"));
		} catch {
			return {
				blocked: `the R2 key is not in the environment and ${R2_ENV_FILE} cannot be read: the owner writes it (runbook, owner step 1)`,
			};
		}
	const { connectionOf } = await import("./seed-r2.js");
	let connection: BucketConnection;
	try {
		connection = connectionOf(values);
	} catch (error) {
		return { blocked: error instanceof Error ? error.message : "no R2 key" };
	}
	registerSecret(connection.accessKeyId);
	registerSecret(connection.secretAccessKey);
	return { connection };
};

const openLiveBucket: S8dDependencies["openBucket"] = async () => {
	const opened = await openLiveConnection();
	if ("blocked" in opened) return opened;
	const client = new Bun.S3Client({ ...opened.connection, region: "auto" });
	return {
		bucket: {
			list: (options) => client.list(options),
			text: async (key) => {
				const file = client.file(key);
				return (await file.exists()) ? file.text() : null;
			},
		},
	};
};

export const liveDependencies: S8dDependencies = {
	ledgerStatus: flyLedgerStatus,
	openBucket: openLiveBucket,
	now: () => Date.now(),
};

// ---- stage 6

/** `call`, and once more after `POST /family/pin/verify` when the PIN has locked again (403 `pin_required`). */
const withPinOpen = async (
	owner: Session,
	call: () => Promise<Reply>,
): Promise<Reply> => {
	const reply = await call();
	if (reply.status !== 403 || errorCodeOf(reply) !== "pin_required")
		return reply;
	const pin = await owner.verifyPin();
	return pin.ok ? call() : reply;
};

const blockAll = (context: Context, why: string): void => {
	for (const name of S8D_CHECKS)
		context.report.add(STAGE, name, "BLOCKED", why);
};

type Outcome = { status: Status; why: string };

const needs = (what: string): Outcome => ({
	status: "BLOCKED",
	why: `needs ${what} (lines above)`,
});

export const stage6 = async (
	context: Context,
	dependencies: S8dDependencies = liveDependencies,
): Promise<void> => {
	const { report, inputs } = context;
	const missing = missingForRefund(inputs);
	const owner = ownerSession(context);
	if (missing.length > 0 || owner === null) {
		blockAll(context, `missing: ${missing.join("; ")}`);
		return;
	}
	const startedAt = dependencies.now();
	const startedText = new Date(startedAt).toISOString();
	context.log(`  S8d run started ${startedText}`);
	if (!(await owner.open(STAGE, report))) return;
	const chosen = targetSchool(context, owner);
	if ("blocked" in chosen) {
		report.add(STAGE, "school", "BLOCKED", chosen.blocked);
		return;
	}
	const school = chosen.grant;
	const schoolId = school.id;
	const paymentId = inputs.paymentId as string;
	const refundCents = inputs.refundCents as number;
	const billing = `/school-admin/schools/${schoolId}/billing`;

	const baseline = await dependencies
		.ledgerStatus()
		.catch((error: unknown) => ({ error: String(error) }));

	let publishedVersion: number | null = null;
	let publishedAt = 0;
	await check(context, STAGE, "menu-publish", async () => {
		const state = await owner.api(billing);
		if (state.status !== 200)
			return { status: "FAIL", why: `GET billing answered ${describe(state)}` };
		const before = publishedVersionOf(state);
		const versions = await owner.api(`${billing}/menu/versions`);
		const newest = newestVersionOf(versions.json);
		if (versions.status !== 200 || newest === null)
			return {
				status: versions.status === 200 ? "BLOCKED" : "FAIL",
				why:
					versions.status === 200
						? `school ${schoolId} has no saved menu: the owner saves and publishes one (runbook, owner step 2)`
						: `GET menu/versions answered ${describe(versions)}`,
			};
		const latest = await owner.api(`${billing}/menu/versions/${newest}`);
		const menu = asRecord(latest.json).menu;
		if (latest.status !== 200 || typeof menu !== "object" || menu === null)
			return {
				status: "FAIL",
				why: `GET menu/versions/${newest} answered ${describe(latest)}${latest.status === 200 ? " with no menu" : ""}`,
			};
		const blurb = `S8d run ${startedText}`;
		const changed = withBlurb(asRecord(menu), blurb);
		if (changed === null)
			return {
				status: "FAIL",
				why: `menu version ${newest} has no tier to change`,
			};
		const saved = await withPinOpen(owner, () =>
			owner.api(`${billing}/menu`, { method: "POST", body: changed.menu }),
		);
		if (saved.status !== 200)
			return {
				status: "FAIL",
				why: `POST billing/menu answered ${describe(saved)}`,
			};
		const published = await withPinOpen(owner, () =>
			owner.api(`${billing}/menu/publish`, { method: "POST", body: {} }),
		);
		publishedAt = dependencies.now();
		if (published.status !== 200)
			return {
				status: "FAIL",
				why: `menu saved; POST billing/menu/publish answered ${describe(published)}`,
			};
		const after = publishedVersionOf(published);
		const wentUp = after !== null && (before === null || after > before);
		if (wentUp) publishedVersion = after;
		return {
			status: wentUp ? "PASS" : "FAIL",
			why: `saved tier ${changed.tierId} blurb "${blurb}" on version ${newest} and published: version ${String(after)} (was ${String(before)})${wentUp ? "" : ", the version did not go up"}`,
		};
	});

	let refundedAt = 0;
	let refunded = false;
	await check(context, STAGE, "refund", async () => {
		const step = await owner.redeem("step_up");
		if (!step.ok) return { status: step.status, why: `step-up: ${step.why}` };
		const outcome = refundOutcome(
			await withPinOpen(owner, () =>
				postRefund(owner, {
					schoolId,
					paymentId,
					refundCents,
					idempotencyKey: `s8d-${randomUUID()}`,
					note: "S8d staging e2e",
				}),
			),
		);
		refundedAt = dependencies.now();
		if (outcome.refundId === null) return { status: "FAIL", why: outcome.why };
		refunded = STRIPE_DONE.has(outcome.stripeStatus ?? "");
		return {
			status: refunded ? "PASS" : "FAIL",
			why: `${refundCents} cents of ${paymentId}: ${outcome.why}`,
		};
	});

	await check(context, STAGE, "outbox-shipped", async () => {
		if (publishedVersion === null || !refunded)
			return needs("the menu publish and the refund");
		if ("error" in baseline)
			return {
				status: "FAIL",
				why: `ledger-status at the start: ${baseline.error}`,
			};
		const before = outboxOf(baseline.report, schoolId);
		const attempts = Math.floor(POLL_TIMEOUT_MS / POLL_INTERVAL_MS) + 1;
		let last = "no answer yet";
		for (let attempt = 1; attempt <= attempts; attempt += 1) {
			const answer = await dependencies.ledgerStatus();
			if ("error" in answer) last = answer.error;
			else {
				const now = outboxOf(answer.report, schoolId);
				last = `total ${now.total} (was ${before.total}), shipped ${now.shipped}, unshipped ${now.unshipped}, lastShippedAt ${instantText(now.lastShippedAt)}${answer.report.unshippedWrongEnv > 0 ? `, unshippedWrongEnv ${answer.report.unshippedWrongEnv}` : ""}`;
				if (outboxShipped(now, before))
					return {
						status: "PASS",
						why: `school ${schoolId} ${last} (poll ${attempt})`,
					};
			}
			context.log(`  ledger-status poll ${attempt}: ${last}`);
			if (attempt < attempts) await context.sleep(POLL_INTERVAL_MS);
		}
		return {
			status: "FAIL",
			why: `the outbox did not grow by ${EXPECTED_NEW_ROWS} and ship within ${POLL_TIMEOUT_MS / MS_PER_SECOND / SECONDS_PER_MINUTE} minutes; last: ${last} (check ledger_export and fly logs -a ${FLY_APP} for ledger.ship_)`,
		};
	});

	let bucket: EventBucket | null = null;
	let found: FoundEvents | null = null;
	let watermark: Watermark | null = null;
	await check(context, STAGE, "r2-events", async () => {
		if (publishedVersion === null || !refunded)
			return needs("the menu publish and the refund");
		const opened = await dependencies.openBucket();
		if ("blocked" in opened) return { status: "BLOCKED", why: opened.blocked };
		bucket = opened.bucket;
		watermark = parseWatermark(await bucket.text(watermarkKey(schoolId)));
		found = await findS8dEvents(bucket, {
			school: schoolId,
			since: startedAt,
			version: publishedVersion,
			refundCents,
		});
		const problems: string[] = [];
		const seen: string[] = [];
		const named: [string, LedgerEvent | null, string][] = [
			["catalog.published", found.catalog, `of version ${publishedVersion}`],
			["payment.refunded", found.refund, `of ${refundCents} cents`],
		];
		for (const [type, event, what] of named) {
			if (event === null) {
				problems.push(`no ${type} ${what} since ${startedText}`);
				continue;
			}
			const env = envOfEvent(event, watermark?.env ?? null);
			if (env.env !== EXPECTED_ENV)
				problems.push(
					`${type} env ${String(env.env)} (from the ${env.from}), not ${EXPECTED_ENV}`,
				);
			const emails = emailFieldsOf(event);
			if (emails.length > 0)
				problems.push(`${type} holds an email address in ${emails.join(", ")}`);
			seen.push(
				`${type} ${what} at ${event.event_time} env ${String(env.env)}${env.from === "event" ? "" : ` (from the ${env.from}: the event names none)`}`,
			);
		}
		const read = `${found.files} file(s), ${found.lines} line(s)${found.unreadable > 0 ? `, ${found.unreadable} not JSON` : ""}`;
		return problems.length === 0
			? {
					status: "PASS",
					why: `${seen.join("; ")}; no email address (${read})`,
				}
			: { status: "FAIL", why: `${problems.join("; ")} (${read})` };
	});

	await check(context, STAGE, "watermark", async () => {
		const events = found as FoundEvents | null;
		if (
			bucket === null ||
			events === null ||
			events.catalog === null ||
			events.refund === null
		)
			return needs("both events in the bucket");
		const mark = watermark as Watermark | null;
		if (mark === null)
			return {
				status: "FAIL",
				why: `${watermarkKey(schoolId)} is missing or not JSON`,
			};
		const latestEvent = Math.max(timeOf(events.catalog), timeOf(events.refund));
		const ofSchool = mark.school === schoolId;
		const past =
			mark.shippedThrough !== null && mark.shippedThrough >= latestEvent;
		return {
			status: ofSchool && past ? "PASS" : "FAIL",
			why: `watermark school ${String(mark.school)}${ofSchool ? "" : ` (not ${schoolId})`}, env ${String(mark.env)}, shippedThrough ${instantText(mark.shippedThrough)} ${past ? "at or past" : "BEFORE"} the later event ${new Date(latestEvent).toISOString()}`,
		};
	});

	const ledgerPath = `/v1/schools/${schoolId}/ledger?from=${dayOffset(-2)}&to=${dayOffset(1)}`;
	const financeBlocked = {
		status: "BLOCKED" as const,
		why: `the account has finance:false on ${schoolId}: the Worker's ledger needs the owner or an admin with the finance grant`,
	};
	await check(context, STAGE, "worker-ledger", async () => {
		if (!refunded) return needs("the refund");
		if (!school.finance) return financeBlocked;
		return pollLedger(context, owner, {
			path: ledgerPath,
			find: (page) => refundSinceIn(page, paymentId, refundCents, startedAt),
			after: refundedAt,
			label: "payment.refunded entry",
			afterWhat: "the refund",
		});
	});

	await check(context, STAGE, "worker-catalog", async () => {
		const version = publishedVersion as number | null;
		if (version === null) return needs("the menu publish");
		if (!school.finance) return financeBlocked;
		return pollLedger(context, owner, {
			path: ledgerPath,
			find: (page) => catalogEntryIn(page, version, startedAt),
			after: publishedAt,
			label: `catalog.published entry of version ${version}`,
			afterWhat: "the publish",
		});
	});
};
