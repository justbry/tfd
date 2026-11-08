/** Stage 6 (S8d) of the staging script: its gating, its readers of `ledger-status`, the bucket and the events, and a run on fakes. */
import { afterAll, beforeAll, expect, test } from "bun:test";
import {
	type Context,
	DEFAULT_STAGES,
	type Inputs,
	inputsFrom,
	newReport,
	parseArgs,
	type Result,
	resolveTargets,
	runStages,
} from "../scripts/staging-e2e.js";
import {
	catalogEntryIn,
	type EventBucket,
	emailFieldsOf,
	envOfEvent,
	eventKeysSince,
	findS8dEvents,
	newestVersionOf,
	outboxOf,
	outboxShipped,
	parseEnvFile,
	parseLedgerStatus,
	parseWatermark,
	refundSinceIn,
	S8D_CHECKS,
	type S8dDependencies,
	type SchoolOutbox,
	stage6,
	withBlurb,
} from "../scripts/staging-s8d.js";

const SCHOOL = "666b4767-7006-4ab0-85e8-d7071053f9af";
const OTHER_SCHOOL = "00000000-0000-4000-8000-000000000001";
const PAYMENT = "ch_3UZCWVDrNLsdrUCj2jydqvCG";
const START = Date.parse("2026-11-07T18:00:00.000Z");
const MINUTE = 60_000;

const NO_INPUTS: Inputs = inputsFrom({});
const S8D_INPUTS: Inputs = inputsFrom({
	S8F_QA_EMAIL: "qa-owner@example.test",
	S8F_PIN: "13579",
	S8F_SCHOOL_ID: SCHOOL,
	S8F_PAYMENT_ID: PAYMENT,
	S8F_REFUND_CENTS: "25",
});

const at = (offsetMs: number): string =>
	new Date(START + offsetMs).toISOString();

const event = (fields: Record<string, unknown>): Record<string, unknown> => ({
	v: 1,
	id: "01JX0000000000000000000000",
	school: SCHOOL,
	source: "family",
	key: SCHOOL,
	labels: {},
	text: "",
	postings: [],
	...fields,
});

const catalogEvent = (version: number, offsetMs: number) =>
	event({
		event_type: "catalog.published",
		event_time: at(offsetMs),
		date: at(offsetMs).slice(0, 10),
		payload: {
			version,
			plans: [`s8f-monthly@v${version}`],
			menu: {
				tiers: [{ id: "s8f-monthly", name: "Monthly", blurb: "S8d run" }],
				addons: [{ id: "s8f-pack", name: "Pack" }],
			},
		},
	});

const refundEvent = (amount: number, offsetMs: number) =>
	event({
		event_type: "payment.refunded",
		event_time: at(offsetMs),
		date: at(offsetMs).slice(0, 10),
		key: "family:fam_1",
		payload: { id: "evt_1", amount, currency: "usd", charge: PAYMENT },
	});

/** A bucket in memory: S3's listing order, `startAfter`, and pages of `pageSize` keys with a continuation token. */
const fakeBucket = (
	objects: Record<string, string>,
	pageSize = 2,
): EventBucket & { listed: string[] } => {
	const listed: string[] = [];
	return {
		listed,
		async list({ prefix, startAfter, continuationToken }) {
			const after = continuationToken ?? startAfter ?? "";
			const keys = Object.keys(objects)
				.filter((key) => key.startsWith(prefix) && key > after)
				.sort();
			const page = keys.slice(0, pageSize);
			listed.push(...page);
			const truncated = keys.length > pageSize;
			return {
				contents: page.map((key) => ({ key })),
				isTruncated: truncated,
				...(truncated ? { nextContinuationToken: page.at(-1) } : {}),
			};
		},
		async text(key) {
			return objects[key] ?? null;
		},
	};
};

const lines = (...events: Record<string, unknown>[]): string =>
	`${events.map((each) => JSON.stringify(each)).join("\n")}\n`;

// ---- gating

const offlineContext = (inputs: Inputs): Context => ({
	targets: resolveTargets({}),
	report: newReport(() => undefined),
	inputs,
	qaLink: async () => {
		throw new Error("no sign-in may happen here");
	},
	sleep: async () => undefined,
	log: () => undefined,
});

test("stage 6 runs only when asked: not in the default, and --stage 6 takes it", () => {
	expect(DEFAULT_STAGES).not.toContain(6);
	expect(parseArgs([]).stages).not.toContain(6);
	expect(parseArgs(["--stage", "6"]).stages).toEqual([6]);
	expect(parseArgs(["--stage", "1,6"]).stages).toEqual([1, 6]);
	expect(() => parseArgs(["--stage", "7"])).toThrow("1 to 4 or 6");
});

test("--stage 6 without its inputs is BLOCKED on all seven checks, names them and signs in nowhere", async () => {
	const context = offlineContext(NO_INPUTS);
	await runStages(context, [6]);
	const { results } = context.report;
	expect(results.map((result) => result.check)).toEqual([...S8D_CHECKS]);
	expect(
		results.every(
			(result) => result.stage === 6 && result.status === "BLOCKED",
		),
	).toBe(true);
	for (const name of [
		"S8F_QA_EMAIL",
		"S8F_SCHOOL_ID",
		"S8F_PAYMENT_ID",
		"S8F_REFUND_CENTS",
	])
		expect(results[0]?.why).toContain(name);
});

// ---- ledger-status

const statusLine = (rows: Partial<SchoolOutbox>[]): string =>
	JSON.stringify({
		env: "test",
		schools: rows.map((row) => ({
			school: SCHOOL,
			total: 0,
			shipped: 0,
			unshipped: 0,
			lastShippedAt: null,
			oldestUnshippedDate: null,
			oldestUnshippedId: null,
			oldestUnshippedAgeMs: null,
			...row,
		})),
		unshippedWrongEnv: 0,
		switch: true,
		bucket: true,
	});

test("ledger-status: the JSON line among fly's own lines, per school", () => {
	const stdout = [
		"Connecting to fdaa:0:1::2... complete",
		statusLine([
			{ total: 7, shipped: 7, lastShippedAt: START },
			{ school: OTHER_SCHOOL, total: 3, shipped: 1, unshipped: 2 },
		]),
		"",
	].join("\n");
	const report = parseLedgerStatus(stdout);
	expect(report?.env).toBe("test");
	expect(report?.schools).toHaveLength(2);
	expect(report && outboxOf(report, SCHOOL)).toEqual({
		school: SCHOOL,
		total: 7,
		shipped: 7,
		unshipped: 0,
		lastShippedAt: START,
	});
	// a school with no outbox row yet counts as zeros
	expect(
		report && outboxOf(report, "11111111-1111-4111-8111-111111111111"),
	).toMatchObject({ total: 0, unshipped: 0, lastShippedAt: null });
});

test("ledger-status: nothing parsed from an answer that is not it", () => {
	expect(parseLedgerStatus("")).toBeNull();
	expect(parseLedgerStatus("Error: no machines\n")).toBeNull();
	expect(parseLedgerStatus('{"error":"usage"}\n')).toBeNull();
	expect(parseLedgerStatus("{not json\n")).toBeNull();
	// a school row of the wrong shape refuses the whole answer
	expect(
		parseLedgerStatus(
			JSON.stringify({
				env: "test",
				schools: [{ school: SCHOOL, total: "7" }],
			}),
		),
	).toBeNull();
});

test("shipped: the outbox grew by two since the start and nothing waits", () => {
	const row = (total: number, unshipped: number): SchoolOutbox => ({
		school: SCHOOL,
		total,
		shipped: total - unshipped,
		unshipped,
		lastShippedAt: START,
	});
	expect(outboxShipped(row(12, 0), row(10, 0))).toBe(true);
	expect(outboxShipped(row(13, 0), row(10, 0))).toBe(true);
	expect(outboxShipped(row(11, 0), row(10, 0))).toBe(false);
	expect(outboxShipped(row(12, 1), row(10, 0))).toBe(false);
});

// ---- the bucket

test("event keys: every listing page, from the day before the start, the watermark left out", async () => {
	const prefix = `schools/${SCHOOL}/events/`;
	const bucket = fakeBucket({
		[`${prefix}date=2026-11-01/batch-01A-aaaa.jsonl`]: "",
		[`${prefix}date=2026-11-06/batch-01B-bbbb.jsonl`]: "",
		[`${prefix}date=2026-11-07/batch-01C-cccc.jsonl`]: "",
		[`${prefix}date=2026-11-07/batch-01D-dddd.jsonl`]: "",
		[`${prefix}date=2026-11-08/day.jsonl`]: "",
		[`${prefix}_shipped-through.json`]: "{}",
		[`schools/${OTHER_SCHOOL}/events/date=2026-11-07/batch-01E-eeee.jsonl`]: "",
	});
	const keys = await eventKeysSince(bucket, SCHOOL, START);
	expect(keys).toEqual([
		`${prefix}date=2026-11-06/batch-01B-bbbb.jsonl`,
		`${prefix}date=2026-11-07/batch-01C-cccc.jsonl`,
		`${prefix}date=2026-11-07/batch-01D-dddd.jsonl`,
		`${prefix}date=2026-11-08/day.jsonl`,
	]);
	expect(bucket.listed).not.toContain(
		`${prefix}date=2026-11-01/batch-01A-aaaa.jsonl`,
	);
});

test("the events of this run: the published version and the refunded amount, at or after the start", async () => {
	const prefix = `schools/${SCHOOL}/events/`;
	const bucket = fakeBucket({
		[`${prefix}date=2026-11-07/batch-01A-aaaa.jsonl`]: lines(
			catalogEvent(4, -MINUTE), // the version before, published before the run
			refundEvent(25, -MINUTE), // stage 4's earlier refund of the same amount
			catalogEvent(5, 2 * MINUTE),
		),
		[`${prefix}date=2026-11-07/batch-01B-bbbb.jsonl`]: `${lines(
			refundEvent(30, 3 * MINUTE), // another amount
			refundEvent(25, 4 * MINUTE),
			{ ...refundEvent(25, 5 * MINUTE), school: OTHER_SCHOOL },
		)}not json\n`,
	});
	const found = await findS8dEvents(bucket, {
		school: SCHOOL,
		since: START,
		version: 5,
		refundCents: 25,
	});
	expect(found.catalog?.event_time).toBe(at(2 * MINUTE));
	expect(found.refund?.event_time).toBe(at(4 * MINUTE));
	expect(found).toMatchObject({ files: 2, lines: 7, unreadable: 1 });
	const none = await findS8dEvents(bucket, {
		school: SCHOOL,
		since: START,
		version: 6,
		refundCents: 99,
	});
	expect(none.catalog).toBeNull();
	expect(none.refund).toBeNull();
});

test("the watermark as the shipper writes it", () => {
	expect(
		parseWatermark(
			JSON.stringify({ school: SCHOOL, env: "test", shippedThrough: at(0) }),
		),
	).toEqual({ school: SCHOOL, env: "test", shippedThrough: START });
	expect(parseWatermark(null)).toBeNull();
	expect(parseWatermark("nope")).toBeNull();
	expect(parseWatermark("{}")).toEqual({
		school: null,
		env: null,
		shippedThrough: null,
	});
});

// ---- the email check and the env

test("an email address anywhere in an event is found by its path, never printed", () => {
	const leaky = {
		...refundEvent(25, 0),
		payload: {
			amount: 25,
			billing_email: "parent@example.com",
			nested: [{ note: "write to Kim <kim@school.example.org>" }],
		},
	};
	expect(emailFieldsOf(leaky)).toEqual([
		"payload.billing_email",
		"payload.nested.0.note",
	]);
	expect(emailFieldsOf(refundEvent(25, 0))).toEqual([]);
});

test("a product's name inside the menu is the school's own text; a name outside it is not", () => {
	const catalog = catalogEvent(5, 0);
	const payload = catalog.payload as {
		menu: { tiers: { name: string; blurb: string }[] };
		name?: string;
	};
	payload.menu.tiers[0] = { name: "hello@studio.example", blurb: "plain" };
	expect(emailFieldsOf(catalog)).toEqual([]);
	payload.menu.tiers[0] = { name: "Monthly", blurb: "hello@studio.example" };
	expect(emailFieldsOf(catalog)).toEqual(["payload.menu.tiers.0.blurb"]);
	payload.menu.tiers[0] = { name: "Monthly", blurb: "plain" };
	payload.name = "owner@studio.example";
	expect(emailFieldsOf(catalog)).toEqual(["payload.name"]);
});

test("env: the event's own, else its labels', else the watermark's, and which one it was", () => {
	expect(envOfEvent({ env: "test" }, "live")).toEqual({
		env: "test",
		from: "event",
	});
	expect(envOfEvent({ labels: { env: "test" } }, null)).toEqual({
		env: "test",
		from: "labels",
	});
	expect(envOfEvent({ labels: {} }, "test")).toEqual({
		env: "test",
		from: "watermark",
	});
	expect(envOfEvent({}, null)).toEqual({ env: null, from: "none" });
});

// ---- the menu and the Worker's rows

test("the menu change is one blurb on the S8f tier, prices untouched", () => {
	const menu = {
		currency: "usd",
		tiers: [
			{ id: "other", blurb: "x", prices: [{ amount: 900 }] },
			{ id: "s8f-monthly", blurb: "old", prices: [{ amount: 1000 }] },
		],
		addons: [{ id: "s8f-pack", price: { amount: 500, every: "once" } }],
	};
	const changed = withBlurb(menu, "S8d run now");
	expect(changed?.tierId).toBe("s8f-monthly");
	expect(changed?.menu).toEqual({
		...menu,
		tiers: [menu.tiers[0], { ...menu.tiers[1], blurb: "S8d run now" }],
	});
	expect(withBlurb({ tiers: [{ id: "solo" }] }, "b")?.tierId).toBe("solo");
	expect(withBlurb({ tiers: [] }, "b")).toBeNull();
	expect(newestVersionOf({ versions: [{ version: 3 }, { version: 5 }] })).toBe(
		5,
	);
	expect(newestVersionOf({ versions: [] })).toBeNull();
});

const ledgerPage = (...entries: Record<string, unknown>[]) => ({
	days: [{ date: "2026-11-07", entries }],
});

test("the Worker's rows: this run's refund and the published version, not earlier ones", () => {
	const page = ledgerPage(
		{ event: refundEvent(25, -MINUTE), paymentId: PAYMENT, amountCents: -25 },
		{ event: catalogEvent(5, -MINUTE) },
	);
	expect(refundSinceIn(page, PAYMENT, 25, START).found).toBe(false);
	expect(catalogEntryIn(page, 5, START).found).toBe(false);
	const later = ledgerPage(
		{ event: refundEvent(25, MINUTE), paymentId: "pi_other", amountCents: -25 },
		{ event: catalogEvent(5, MINUTE) },
	);
	expect(refundSinceIn(later, PAYMENT, 25, START)).toMatchObject({
		found: true,
		entryTime: at(MINUTE),
	});
	expect(catalogEntryIn(later, 5, START).found).toBe(true);
	expect(catalogEntryIn(later, 6, START).found).toBe(false);
});

test("an env file: comments, export and quotes", () => {
	expect(
		parseEnvFile(
			'# the key\nexport R2_LEDGER_BUCKET=b4uni-stg-ledger\nR2_LEDGER_ENDPOINT="https://x.r2.cloudflarestorage.com"\n\n',
		),
	).toEqual({
		R2_LEDGER_BUCKET: "b4uni-stg-ledger",
		R2_LEDGER_ENDPOINT: "https://x.r2.cloudflarestorage.com",
	});
});

// ---- a whole run on a fake family service, a fake Worker, a fake outbox and a fake bucket

type Fake = {
	published: number;
	draft: number;
	menu: Record<string, unknown>;
	refunds: { key: string | null; amountCents: number; at: number }[];
	saved: Record<string, unknown>[];
	catalogAt: number | null;
};

let fake: Fake;
let api: ReturnType<typeof Bun.serve>;
let worker: ReturnType<typeof Bun.serve>;

beforeAll(() => {
	fake = {
		published: 4,
		draft: 4,
		menu: {
			currency: "usd",
			timeZone: "America/Denver",
			features: [],
			tiers: [{ id: "s8f-monthly", name: "Monthly", blurb: "old" }],
			addons: [],
		},
		refunds: [],
		saved: [],
		catalogAt: null,
	};
	const billing = `/school-admin/schools/${SCHOOL}/billing`;
	const state = () => ({
		connected: true,
		published: { version: fake.published, at: 0 },
		menu: fake.menu,
	});
	api = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		async fetch(request) {
			const path = new URL(request.url).pathname;
			if (path === "/family/verify")
				return Response.json(
					{ ok: true },
					{ headers: { "set-cookie": "b4u_session=fake-session; Path=/" } },
				);
			if (path === "/family/pin/verify") return Response.json({ ok: true });
			if (path === "/school-admin/ledger-token")
				return Response.json({
					token: "fake-ledger-token",
					expiresAt: Math.floor(Date.now() / 1000) + 300,
					schools: [{ id: SCHOOL, role: "owner", finance: true }],
				});
			if (path === billing) return Response.json(state());
			if (path === `${billing}/menu/versions`)
				return Response.json({
					versions: [{ version: fake.draft, publishedAt: 1, savedAt: 1 }],
				});
			if (path === `${billing}/menu/versions/${fake.draft}`)
				return Response.json({ version: fake.draft, menu: fake.menu });
			if (path === `${billing}/menu`) {
				const body = (await request.json()) as Record<string, unknown>;
				fake.saved.push(body);
				fake.menu = body;
				fake.draft = fake.published + 1;
				return Response.json(state());
			}
			if (path === `${billing}/menu/publish`) {
				fake.published = fake.draft;
				fake.catalogAt = Date.now();
				return Response.json(state());
			}
			if (path === `${billing}/refunds`) {
				const body = (await request.json()) as { amountCents: number };
				fake.refunds.push({
					key: request.headers.get("idempotency-key"),
					amountCents: body.amountCents,
					at: Date.now(),
				});
				return Response.json({
					refundId: "re_fake",
					status: "succeeded",
					refundedCents: body.amountCents,
					remainingCents: 275,
					replayed: false,
				});
			}
			return new Response(null, { status: 404 });
		},
	});
	worker = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		fetch() {
			const entries: Record<string, unknown>[] = fake.refunds.map((refund) => ({
				event: {
					...refundEvent(refund.amountCents, 0),
					event_time: new Date(refund.at).toISOString(),
				},
				paymentId: PAYMENT,
				amountCents: -refund.amountCents,
			}));
			if (fake.catalogAt !== null)
				entries.push({
					event: {
						...catalogEvent(fake.published, 0),
						event_time: new Date(fake.catalogAt).toISOString(),
					},
				});
			return Response.json({
				asOf: new Date(Date.now() + MINUTE).toISOString(),
				lagMinutes: 0,
				data: ledgerPage(...entries),
			});
		},
	});
});

afterAll(() => {
	api.stop(true);
	worker.stop(true);
});

test("a whole stage 6 on fakes: seven PASS lines in order, one refund, the menu's prices kept", async () => {
	const apiOrigin = `http://127.0.0.1:${api.port}`;
	const workerOrigin = `http://127.0.0.1:${worker.port}`;
	const printed: string[] = [];
	const context: Context = {
		targets: resolveTargets(
			{ worker: workerOrigin, api: apiOrigin },
			{ extraAllowedOrigins: [workerOrigin, apiOrigin] },
		),
		report: newReport((line) => printed.push(line)),
		inputs: S8D_INPUTS,
		qaLink: async () => ({ token: "fake-link-token" }),
		sleep: async () => undefined,
		log: () => undefined,
	};
	let statusCalls = 0;
	const dependencies: S8dDependencies = {
		now: () => Date.now(),
		ledgerStatus: async () => {
			statusCalls += 1;
			// the start, then a poll with one row still waiting, then shipped
			const rows =
				statusCalls === 1
					? { total: 10, shipped: 10 }
					: statusCalls === 2
						? { total: 12, shipped: 11, unshipped: 1 }
						: { total: 12, shipped: 12, lastShippedAt: Date.now() };
			const report = parseLedgerStatus(statusLine([rows]));
			return report === null ? { error: "unparsed" } : { report };
		},
		openBucket: async () => {
			const catalog = {
				...catalogEvent(fake.published, 0),
				event_time: new Date(fake.catalogAt ?? 0).toISOString(),
			};
			const refund = {
				...refundEvent(25, 0),
				event_time: new Date(fake.refunds[0]?.at ?? 0).toISOString(),
			};
			const today = new Date().toISOString().slice(0, 10);
			return {
				bucket: fakeBucket({
					[`schools/${SCHOOL}/events/date=${today}/batch-01A-aaaa.jsonl`]:
						lines(catalog, refund),
					[`schools/${SCHOOL}/events/_shipped-through.json`]: JSON.stringify({
						school: SCHOOL,
						env: "test",
						shippedThrough: new Date(Date.now()).toISOString(),
					}),
				}),
			};
		},
	};
	await stage6(context, dependencies);
	const results: Result[] = context.report.results;
	const own = results.filter((result) =>
		(S8D_CHECKS as readonly string[]).includes(result.check),
	);
	expect(own.map((result) => `${result.status} ${result.check}`)).toEqual(
		S8D_CHECKS.map((name) => `PASS ${name}`),
	);
	expect(fake.published).toBe(5);
	expect(fake.refunds).toHaveLength(1);
	expect(fake.refunds[0]?.amountCents).toBe(25);
	expect(fake.refunds[0]?.key?.startsWith("s8d-")).toBe(true);
	const [saved] = fake.saved;
	expect(
		(saved?.tiers as { blurb: string }[] | undefined)?.[0]?.blurb,
	).toStartWith("S8d run ");
	expect(statusCalls).toBe(3);
	expect(own[2]?.why).toContain("total 12 (was 10)");
	expect(own[3]?.why).toContain("from the watermark");
	expect(printed.every((line) => !line.includes("fake-ledger-token"))).toBe(
		true,
	);
});
