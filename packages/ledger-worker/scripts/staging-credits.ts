/**
 * Stage 7 of the staging end-to-end, S8f of the credits engine (plan `plans/credits-engine/plan.md` stage 5, T12): the
 * ledger views build for a school whose log holds credit events, a log on two menu versions included, and the Worker
 * reads the members' credits from them.
 *
 *   bun run --cwd packages/ledger-worker staging-e2e --stage 7
 *
 * No staging school holds credit events yet (buzz-school ships money and catalog events only until stage 4 of the plan),
 * so the stage owns its data: three fixture schools under `schools/demo-s8f-*` in the staging bucket, which no real
 * school's prefix can match (real ids are UUIDs; the Worker reads `demo-*` ids tokenless, as demo schools, on staging):
 *
 *   demo-s8f-credits-versions  the bundle `credits-menu-version`: two members on two menu versions; granted, expired
 *   demo-s8f-credits-adjust    the bundle `credits-adjust-never-expires`: granted, adjusted, expired
 *   demo-s8f-no-credits        money and menu events only: the control, whose credit screens must stay as they were
 *
 * The stage writes only those three prefixes (`seedDemoLog` refuses any other id, and `connectionOf` any bucket but the
 * staging one) with the R2 key stage 6 uses, then reads them back through the deployed Worker, no token. It compares
 * `members-credits` with `membersOf` run here over the same events at the `asOf` the Worker reports, so a replay that
 * differs between here and the Worker (a catalog chosen by the wrong menu version) shows. The views are built by
 * the seed (`runViews`, the cron job's own function); the cron job's run over a credit log is `tests/cron.test.ts`.
 * The schools stay in the bucket and show as demo schools in the staging UI ("Demo · S8f credits versions").
 *
 * Same lines, exit codes, allow-list and redaction as `staging-e2e.ts`, whose exports it uses.
 */

import type { AtmEvent } from "tfd";
import { R2Store, type Store } from "tfd";
import { bundleLog } from "tfd/scenarios";
import { type MemberSummary, membersOf } from "tfd/worker";
import { refreshDemoIndex } from "../src/data/demo-index.js";
import { seedDemoLog } from "../src/testing/demo-seed.js";
import { presetEvents } from "../src/testing/seed.js";
import {
	asArray,
	asRecord,
	type Context,
	check,
	describe,
	type Reply,
	type Status,
	send,
} from "./staging-e2e.js";
import { openLiveConnection } from "./staging-s8d.js";

const STAGE = 7;
const MONEY_AND_MENU = /^(payment|catalog)\./;
const CONTROL_PRESET = "tiny-school";

export type CreditFixture = {
	/** The check names' prefix. */
	tag: "versions" | "adjust" | "control";
	school: string;
	/** A committed bundle (`fixtures/scenarios/<id>`) for a log of credit events; null for the control. */
	bundle: string | null;
	/** The menu versions the log publishes. */
	versions: readonly string[];
	/** The credit event types the log holds (none for the control). */
	creditTypes: readonly string[];
};

/** The only prefixes this stage writes. */
export const CREDIT_FIXTURES: readonly CreditFixture[] = [
	{
		tag: "versions",
		school: "demo-s8f-credits-versions",
		bundle: "credits-menu-version",
		versions: ["1", "2"],
		creditTypes: ["credit.granted", "credit.expired"],
	},
	{
		tag: "adjust",
		school: "demo-s8f-credits-adjust",
		bundle: "credits-adjust-never-expires",
		versions: ["1"],
		creditTypes: ["credit.granted", "credit.adjusted", "credit.expired"],
	},
	{
		tag: "control",
		school: "demo-s8f-no-credits",
		bundle: null,
		versions: ["1"],
		creditTypes: [],
	},
];

export const S8F_CREDIT_CHECKS = [
	"seed",
	"versions-views",
	"versions-members",
	"versions-history",
	"adjust-views",
	"adjust-members",
	"adjust-history",
	"control-views",
	"control-members",
] as const;

export type CreditLogs = Record<string, AtmEvent[]>;

/** The events of each fixture school: a bundle's log, or the control's money and menu events. */
export const creditLogs = async (): Promise<CreditLogs> => {
	const logs: CreditLogs = {};
	for (const fixture of CREDIT_FIXTURES)
		logs[fixture.school] =
			fixture.bundle === null
				? presetEvents(CONTROL_PRESET).filter((event) =>
						MONEY_AND_MENU.test(event.event_type),
					)
				: (await bundleLog(fixture.bundle)).events;
	return logs;
};

export type CreditDependencies = {
	/** The staging bucket, or why it cannot be opened (every line is BLOCKED). */
	openStore(): Promise<{ store: Store } | { blocked: string }>;
	logs(): Promise<CreditLogs>;
	now(): number;
};

export const liveCreditDependencies: CreditDependencies = {
	openStore: async () => {
		const opened = await openLiveConnection();
		return "blocked" in opened
			? opened
			: { store: new R2Store(opened.connection) };
	},
	logs: creditLogs,
	now: () => Date.now(),
};

type Outcome = { status: Status; why: string };

const getJson = (context: Context, school: string, path: string) =>
	send(`${context.targets.worker}/v1/schools/${school}${path}`);

const dataOf = (reply: Reply): Record<string, unknown> =>
	asRecord(asRecord(reply.json).data);

/** What `GET /v1/schools` lists for the school (the demo index): its views' `asOf`. */
const listedAsOf = async (
	context: Context,
	school: string,
): Promise<string | null> => {
	const reply = await send(`${context.targets.worker}/v1/schools`);
	const entry = asArray(dataOf(reply).schools)
		.map(asRecord)
		.find((candidate) => candidate.id === school);
	return typeof entry?.asOf === "string" ? entry.asOf : null;
};

const sameJson = (a: unknown, b: unknown): boolean =>
	JSON.stringify(a) === JSON.stringify(b);

export const stage7 = async (
	context: Context,
	dependencies: CreditDependencies = liveCreditDependencies,
): Promise<void> => {
	const { report } = context;
	const blockAll = (why: string): void => {
		for (const name of S8F_CREDIT_CHECKS)
			report.add(STAGE, name, "BLOCKED", why);
	};
	const opened = await dependencies.openStore();
	if ("blocked" in opened) {
		blockAll(opened.blocked);
		return;
	}
	const logs = await dependencies.logs();
	const owned = new Set(CREDIT_FIXTURES.map((fixture) => fixture.school));

	let seeded = false;
	await check(context, STAGE, "seed", async () => {
		const lines: string[] = [];
		const now = new Date(dependencies.now());
		for (const [school, events] of Object.entries(logs)) {
			// the only prefixes this stage may write
			if (!owned.has(school))
				throw new Error(`${school} is not one of this stage's schools`);
			const done = await seedDemoLog(opened.store, school, events, {
				now,
				views: true,
			});
			lines.push(
				`${school} ${events.length} events (written ${done.written}, unchanged ${done.unchanged}) views ${done.viewsAsOf}`,
			);
		}
		await refreshDemoIndex(opened.store);
		seeded = true;
		return { status: "PASS", why: lines.join("; ") };
	});

	const waiting: Outcome = {
		status: "BLOCKED",
		why: "needs the seed (line above)",
	};
	for (const fixture of CREDIT_FIXTURES) {
		const events = logs[fixture.school] ?? [];
		let asOf: string | null = null;
		await check(context, STAGE, `${fixture.tag}-views`, async () => {
			if (!seeded) return waiting;
			asOf = await listedAsOf(context, fixture.school);
			if (asOf === null)
				return {
					status: "FAIL",
					why: `GET /v1/schools lists no views for ${fixture.school}: the views did not build`,
				};
			const kpi = await getJson(
				context,
				fixture.school,
				"/kpi?audience=owner&pin=open",
			);
			const ok =
				kpi.status === 200 && typeof asRecord(kpi.json).asOf === "string";
			const versions = new Set(
				events.flatMap((event) =>
					event.event_type === "catalog.published"
						? [String(event.payload.version)]
						: [],
				),
			);
			return {
				status:
					ok && sameJson([...versions].sort(), fixture.versions)
						? "PASS"
						: "FAIL",
				why: `${fixture.school} views asOf ${asOf}, kpi answered ${describe(kpi)}, ${events.length} events on menu version(s) ${[...versions].sort().join(",")}`,
			};
		});

		let members: MemberSummary[] = [];
		await check(context, STAGE, `${fixture.tag}-members`, async () => {
			if (!seeded || asOf === null) return waiting;
			const reply = await getJson(context, fixture.school, "/members-credits");
			if (reply.status !== 200)
				return {
					status: "FAIL",
					why: `members-credits answered ${describe(reply)}`,
				};
			const data = dataOf(reply);
			if (fixture.bundle === null)
				return {
					status: sameJson(data, { hasCreditEvents: false }) ? "PASS" : "FAIL",
					why: `a log with no credit event answered ${JSON.stringify(data).slice(0, 80)}`,
				};
			const answeredAsOf = asRecord(reply.json).asOf;
			const expected = membersOf(events, new Date(String(answeredAsOf)));
			if (!expected.ok)
				return {
					status: "FAIL",
					why: `membersOf cannot replay the fixture log here: ${expected.error.kind}`,
				};
			members = Object.values(expected.members);
			const same =
				data.hasCreditEvents === true && sameJson(data.members, members);
			return {
				status: same ? "PASS" : "FAIL",
				why: `${asArray(data.members).length} member(s), ${String(data.creditsOutstanding)} outstanding at ${String(answeredAsOf)}${same ? ", equal to membersOf run here over the same events" : ": differs from membersOf run here over the same events"}`,
			};
		});

		if (fixture.bundle === null) continue;
		await check(context, STAGE, `${fixture.tag}-history`, async () => {
			const first = members[0];
			if (!seeded || first === undefined) return waiting;
			const reply = await getJson(
				context,
				fixture.school,
				`/members/${encodeURIComponent(first.key)}/money`,
			);
			const types = new Set(
				asArray(dataOf(reply).history).map((row) => asRecord(row).type),
			);
			const own = new Set<string>(
				events
					.filter((event) => event.key === first.key)
					.map((event) => event.event_type),
			);
			const wanted = fixture.creditTypes.filter((type) => own.has(type));
			const missing = wanted.filter((type) => !types.has(type));
			return {
				status:
					reply.status === 200 && wanted.length > 0 && missing.length === 0
						? "PASS"
						: "FAIL",
				why: `${first.key} history answered ${describe(reply)}; credit types in the log ${wanted.join(",")}${missing.length === 0 ? "" : `; missing from the history: ${missing.join(",")}`}`,
			};
		});
	}
};
