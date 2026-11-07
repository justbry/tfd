/**
 * S8e on staging: stage 5 of the S8f script, the ledger UI's own HTTP adapters (`src/http`) against the staging ledger
 * Worker and the staging family service.
 *
 *   bun run --cwd packages/ledger-ui staging-ui [--json] [--strict]
 *
 * STAGING ONLY, and the same run as `packages/ledger-worker/scripts/staging-e2e.ts`: its allow-list, its sign-in
 * (`Session`: qa-link over fly ssh, `/family/verify`, the PIN, the ledger token), its inputs (`S8F_QA_EMAIL`, `S8F_PIN`,
 * `S8F_SCHOOL_ID`, and `S8F_SCHOOL_ID_NO_FINANCE` for the gating), its redaction and its `PASS|FAIL|BLOCKED
 * 5.<check> <why>` lines. It lives in this package because Bun takes the JSX settings of the directory it starts in.
 *
 * What it proves, all through the UI's code: `createHttpAdapters` on the session (the cookie jar and the browser's
 * Origin on the family service, the real ledger-token source, `createFetchWorkerSource` on the Worker's `/v1`); every
 * Reader call the working school's screens make answers its `src/data` type or rejects with the contract's typed
 * `not_available` (S8-contract section 11, D11, D12); C5 (no non-finance answer holds a family key, a `cus_` id or an
 * email); C4 (the Dashboard renders every KPI document the viewer may preview cell by cell, `test/consistency-checks.ts`);
 * the finance gating (the Reader refuses `finance_required`, the mounted Ledger shows its books lock); and the HTTP
 * build's entry (`mountHttpApp`) showing figures and this month's ledger rows. Nothing here writes.
 */
import { randomUUID } from "node:crypto";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { render } from "preact";
import {
	type Arguments,
	BOOKING_WINDOW_DAYS,
	type Context,
	check,
	type Grant,
	maskEmail,
	missingAccount,
	ownerSession,
	runCommand,
	type Session,
	type Status,
	scrub,
	targetSchool,
	UsageError,
} from "../../ledger-worker/scripts/staging-e2e.ts";
import { mountApp } from "../src/app/mount.tsx";
import { type Audience, ruledAudiences } from "../src/data/disclosure.ts";
import type { KpiDocument } from "../src/data/kpi-document.ts";
import type { Reader } from "../src/data/reader.ts";
import type { Clock } from "../src/data/types.ts";
import type { Writer } from "../src/data/writer.ts";
import { createHttpAdapters } from "../src/http/adapters.ts";
import { clockAt, mountHttpApp } from "../src/http/browser.ts";
import { viewerOf } from "../src/http/disclosure.ts";
import { AdapterError } from "../src/http/errors.ts";
import type { LedgerSchoolClaim } from "../src/http/ledger-token.ts";
import { memoryStorage } from "../src/http/pending.ts";
import { type Fetch, timerScheduler } from "../src/http/transport.ts";
import {
	createFetchWorkerSource,
	type WorkerSource,
} from "../src/http/worker-source.ts";
import { dashboardProblems } from "../test/consistency-checks.ts";

export const UI_STAGE = 5;
const MILLISECONDS_PER_SECOND = 1000;
const MILLISECONDS_PER_DAY = 86_400_000;
/** How long a mounted screen may take to show its data: every read is a round trip to staging. */
const SCREEN_WAIT_MILLISECONDS = 60_000;
const SCREEN_POLL_MILLISECONDS = 100;
const PROBLEMS_SHOWN = 3;
const NO_VIEWS =
	"no views yet: the R2 key, the switch ledger_export and a shipped event (plans/ledger-ui/S8f-staging-runbook.md)";
/** The audiences from which the PIN closes the books: below them `pin=locked` means nothing (the Worker's kpi route). */
const LOCKABLE_AUDIENCES: readonly Audience[] = [
	"governance",
	"finance",
	"owner",
];
const DIGIT = /\d/;
/** What C5 looks for in a non-finance answer: what the books know a person by. The match itself is never printed. */
const LEAK_PATTERNS: ReadonlyArray<readonly [string, RegExp]> = [
	["a family: key", /family:/],
	["a cus_ id", /\bcus_[A-Za-z0-9]/],
	[
		"an email address",
		/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/,
	],
];

export type StageOptions = {
	/** The instant the run reads the books at (milliseconds); a test passes the local Worker's clock. */
	now(): number;
};

type Verdict = { status: Status; why: string };

/** Which leak patterns `text` holds (C5). */
export const leaksIn = (text: string): string[] =>
	LEAK_PATTERNS.filter(([, pattern]) => pattern.test(text)).map(
		([what]) => what,
	);

const describeError = (error: unknown): string =>
	error instanceof AdapterError
		? `${error.kind}${error.detail.code && error.detail.code !== error.kind ? ` ${error.detail.code}` : ""}: ${error.message}`
		: `error: ${error instanceof Error ? error.message : String(error)}`;

/** A Reader rejection: the contract's `not_available` is an answer (D11, D12); `no_data` before any view is BLOCKED;
 * anything else is a FAIL. */
export const rejectionVerdict = (
	error: unknown,
	viewsPresent: boolean,
): Verdict => {
	if (error instanceof AdapterError && error.kind === "not_available")
		return {
			status: "PASS",
			why: `rejects not_available, as the contract names it: ${error.message}`,
		};
	if (
		error instanceof AdapterError &&
		error.kind === "no_data" &&
		!viewsPresent
	)
		return { status: "BLOCKED", why: NO_VIEWS };
	return { status: "FAIL", why: `rejects ${describeError(error)}` };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

/** The fields a `src/data` answer must have; the first one missing or of the wrong kind, else null. */
const missingField = (
	value: unknown,
	fields: Record<string, "string" | "number" | "boolean" | "object" | "array">,
): string | null => {
	if (!isRecord(value)) return "the answer is not an object";
	for (const [field, kind] of Object.entries(fields)) {
		const held = value[field];
		const matches =
			kind === "array"
				? Array.isArray(held)
				: kind === "object"
					? isRecord(held)
					: typeof held === kind;
		if (!matches)
			return `${field} is not ${kind === "array" ? "an" : "a"} ${kind}`;
	}
	return null;
};

const answered = (problem: string | null, summary: string): Verdict =>
	problem === null
		? { status: "PASS", why: `answers ${summary}` }
		: { status: "FAIL", why: `answers a shape the UI cannot take: ${problem}` };

const isoDay = (milliseconds: number): string =>
	new Date(milliseconds).toISOString().slice(0, 10);
const shiftDay = (day: string, days: number): string =>
	isoDay(Date.parse(`${day}T00:00:00Z`) + days * MILLISECONDS_PER_DAY);

/** The mounted screens and C4 use happy-dom: registered here when the run has no document (the command line), with
 * the process's own timers back, as `test/worker-e2e/worker-harness.ts` does. A test has one already. */
const ensureDocument = (url: string): void => {
	if (typeof document !== "undefined") return;
	const nativeTimers = {
		setTimeout: globalThis.setTimeout,
		clearTimeout: globalThis.clearTimeout,
	};
	GlobalRegistrator.register({ url });
	Object.assign(globalThis, nativeTimers);
};

const pause = (milliseconds: number): Promise<void> =>
	new Promise((resolve) => setTimeout(resolve, milliseconds));

const waitFor = async (ready: () => boolean): Promise<boolean> => {
	for (
		let waited = 0;
		waited < SCREEN_WAIT_MILLISECONDS && !ready();
		waited += SCREEN_POLL_MILLISECONDS
	)
		await pause(SCREEN_POLL_MILLISECONDS);
	return ready();
};

/** A query's fields in one order, so the app's query and the check's are one key. */
const sortedKeys = (_: string, value: unknown): unknown =>
	isRecord(value)
		? Object.fromEntries(
				Object.entries(value).sort(([first], [second]) =>
					first < second ? -1 : 1,
				),
			)
		: value;

/**
 * The Reader as the mounted app calls it, with each answer kept by its arguments, so the app renders from what the
 * checks read (no round trip to staging between a document and its render, no views rebuild in between) and every
 * rejection the app gets is noted. A rejection other than `not_available` is a mount error.
 */
const keptReader = (
	reader: Reader,
): { reader: Reader; errors: string[]; settled(): Promise<void> } => {
	const kept = new Map<string, Promise<unknown>>();
	const errors: string[] = [];
	const wrapped: Record<string, unknown> = {};
	for (const [name, method] of Object.entries(reader)) {
		if (typeof method !== "function") {
			wrapped[name] = method;
			continue;
		}
		wrapped[name] = (...args: unknown[]) => {
			const key = `${name}:${JSON.stringify(args, sortedKeys)}`;
			const held = kept.get(key);
			if (held) return held;
			const answer: unknown = method(...args);
			if (!(answer instanceof Promise)) return answer;
			kept.set(key, answer);
			answer.catch((error: unknown) => {
				if (!(error instanceof AdapterError && error.kind === "not_available"))
					errors.push(`${name}: ${describeError(error)}`);
			});
			return answer;
		};
	}
	return {
		reader: wrapped as unknown as Reader,
		errors,
		settled: async () => {
			await Promise.allSettled([...kept.values()]);
		},
	};
};

const ledgerRows = (root: HTMLElement): number =>
	root.querySelectorAll("[data-test=ledger-row]").length;

/** Mounts the app (`mountApp`, or the HTTP build's `mountHttpApp`) on `#/<school>/<tab>` and waits for the tab. */
const mounted = (start: (root: HTMLElement) => () => void) => {
	const root = document.createElement("div");
	root.id = "app";
	document.body.appendChild(root);
	const stop = start(root);
	const shown = (school: string, tab: string) =>
		waitFor(
			() => root.dataset.route?.startsWith(`#/${school}/${tab}`) ?? false,
		);
	const open = async (school: string, tab: string): Promise<boolean> => {
		root.removeAttribute("data-route");
		window.location.hash = `#/${school}/${tab}`;
		window.dispatchEvent(new HashChangeEvent("hashchange"));
		return shown(school, tab);
	};
	const close = (): void => {
		stop();
		root.remove();
		window.location.hash = "";
	};
	return { root, shown, open, close };
};

/** The pieces stage 5 has once the session is open: the adapters and what the checks learn on the way. */
type Run = {
	context: Context;
	owner: Session;
	school: Grant;
	now: () => number;
	reader: Reader;
	writer: Writer;
	/** The raw bodies of the Worker's answers, by path and query (C5 reads them). */
	raw: Map<string, string>;
	/** Every Worker read the adapters made, path and query, in order. */
	reads: string[];
	viewsPresent: boolean;
	timeZone: string;
};

/** Runs one Reader call as a check: the answer is judged, a rejection by `rejectionVerdict`. */
const readerCheck = async <Answer>(
	run: Run,
	name: string,
	call: () => Promise<Answer>,
	judge: (answer: Answer) => Verdict,
): Promise<Answer | undefined> => {
	let result: Answer | undefined;
	await check(run.context, UI_STAGE, `reader-${name}`, async () => {
		try {
			result = await call();
		} catch (error) {
			return rejectionVerdict(error, run.viewsPresent);
		}
		return judge(result);
	});
	return result;
};

const documentSummary = (document: KpiDocument | undefined): string => {
	if (!document) return "no document";
	const shown = document.periods.filter(
		(period) => period.state === "shown",
	).length;
	const cells = Object.values(document.tables).flatMap((table) =>
		Object.values(table?.series ?? {}).flat(),
	);
	const figures = cells.filter((cell) => typeof cell === "number").length;
	return `${shown} shown period(s), ${figures} figure cell(s), ${cells.length - figures} other`;
};

const documentProblem = (
	document: KpiDocument | undefined,
	school: string,
	audience: Audience,
): string | null => {
	if (document === undefined)
		return "no document (the Reader answered undefined)";
	if (document.school !== school) return `school is ${document.school}`;
	if (document.audience !== audience) return `audience is ${document.audience}`;
	return missingField(document, {
		periods: "array",
		tables: "object",
		meta: "object",
		symbol: "string",
		pinLocked: "boolean",
	});
};

const variantName = (audience: Audience, pinLocked: boolean): string =>
	`${audience}-${pinLocked ? "locked" : "open"}`;

/** Item 2: every Reader call the working school's screens make. Answers the KPI documents it read, by variant. */
const readerCoverage = async (
	run: Run,
	audiencesHeld: readonly Audience[],
): Promise<{
	documents: Map<string, KpiDocument>;
	ledgerEntries: number | null;
}> => {
	const { reader, school } = run;
	const id = school.id;
	const today = clockAt(
		run.now() / MILLISECONDS_PER_SECOND,
		run.timeZone,
	).today;
	const from = `${today.slice(0, 8)}01`;
	const documents = new Map<string, KpiDocument>();

	await readerCheck(
		run,
		"disclosure",
		() => reader.disclosure(id),
		(disclosure) =>
			answered(
				disclosure.school !== id
					? `school is ${disclosure.school}`
					: missingField(disclosure, {
							file: "object",
							views: "object",
							viewer: "object",
							viewAs: "array",
							year: "number",
						}),
				`Disclosure: viewer ${disclosure.viewer?.viewAs} holding ${disclosure.viewer?.audiences?.join(", ")}`,
			),
	);

	for (const audience of audiencesHeld)
		for (const pinLocked of [false, true]) {
			const document = await readerCheck(
				run,
				`kpi-${variantName(audience, pinLocked)}`,
				() =>
					reader.kpiDocument({ school: id, preset: "", audience, pinLocked }),
				(answer) =>
					answered(
						documentProblem(answer, id, audience),
						`KpiDocument: ${documentSummary(answer)}`,
					),
			);
			if (document) documents.set(variantName(audience, pinLocked), document);
		}

	for (const audience of ruledAudiences.filter((held) =>
		audiencesHeld.includes(held),
	))
		await readerCheck(
			run,
			`audience-report-${audience}`,
			() => reader.audienceReport({ school: id, audience, from, to: today }),
			(report) =>
				answered(
					report.audience !== audience
						? `audience is ${report.audience}`
						: missingField(report, {
								periods: "array",
								figures: "object",
								periodLabel: "string",
							}),
					`AudienceReport for ${from}..${today}: ${report.periods.length} period(s)`,
				),
		);

	const ledger = await readerCheck(
		run,
		"ledger",
		() =>
			reader.ledger({
				school: id,
				from,
				to: today,
				type: null,
				drill: null,
				promo: null,
			}),
		(page) => {
			const entries = page.days.flatMap((day) => day.entries);
			const unnamed = entries.filter(
				(entry) =>
					entry.member !== null && typeof entry.member.name !== "string",
			).length;
			const joined = entries.filter((entry) => entry.member !== null).length;
			return answered(
				unnamed > 0
					? `${unnamed} entr(ies) with a member and no name`
					: missingField(page, {
							days: "array",
							pending: "array",
							count: "number",
						}),
				`LedgerPage for ${from}..${today}: ${entries.length} entr(ies) in ${page.days.length} day(s), ${joined} with a member joined from members-list`,
			);
		},
	);

	for (const compare of [false, true])
		await readerCheck(
			run,
			compare ? "income-statement-compare" : "income-statement",
			() => reader.incomeStatement({ school: id, from, to: today, compare }),
			(statement) =>
				answered(
					compare && !isRecord(statement.previous)
						? "compare asked and previous is not an object"
						: missingField(statement, {
								amounts: "object",
								counts: "object",
								basis: "object",
							}),
					`IncomeStatement for ${from}..${today}: ${statement.counts.payments} payment(s), ${statement.counts.refunds} refund(s)${compare ? ", with the previous period" : ""}`,
				),
		);

	await readerCheck(
		run,
		"members-income",
		() => reader.membersIncome({ schoolId: id, from, to: today }),
		(cents) =>
			answered(
				Number.isInteger(cents)
					? null
					: "the answer is not a whole number of cents",
				`${cents} cents of members' income for ${from}..${today}`,
			),
	);
	await readerCheck(
		run,
		"members",
		() => reader.members({ schoolId: id }),
		(page) =>
			answered(
				missingField(page, { members: "array" }),
				`MembersPage: ${page.members.length} member(s)${page.nextCursor ? ", more pages" : ""}`,
			),
	);
	const bookingsFrom = shiftDay(today, -BOOKING_WINDOW_DAYS);
	const bookingsTo = shiftDay(today, BOOKING_WINDOW_DAYS);
	await readerCheck(
		run,
		"bookings",
		() => reader.bookings({ school: id, from: bookingsFrom, to: bookingsTo }),
		(list) =>
			answered(
				missingField(list, { bookings: "array" }),
				`BookingsList for ${bookingsFrom}..${bookingsTo}: ${list.bookings.length} booking(s)`,
			),
	);
	await readerCheck(
		run,
		"capabilities",
		() => reader.capabilities({ schoolId: id }),
		(capabilities) =>
			answered(
				missingField(capabilities, {
					role: "string",
					stripeConnected: "boolean",
					actions: "object",
				}),
				`Capabilities: role ${capabilities.role}, Stripe ${capabilities.stripeConnected ? "connected" : "not connected"}`,
			),
	);
	await readerCheck(
		run,
		"menu-versions",
		() => reader.menuVersions(id),
		(versions) =>
			answered(
				missingField(versions, { versions: "array" }),
				`MenuVersions: ${versions.versions.length} version(s)`,
			),
	);
	await readerCheck(
		run,
		"settings",
		() => reader.settings(id),
		(settings) => answered(missingField(settings, {}), "SchoolSettings"),
	);

	return {
		documents,
		ledgerEntries:
			ledger === undefined
				? null
				: ledger.days.reduce((total, day) => total + day.entries.length, 0),
	};
};

/** Item 3, C5: the raw Worker JSON of every non-finance answer the Reader read (the KPI documents, open and locked,
 * and the audience reports). */
const c5 = async (
	run: Run,
	audiencesHeld: readonly Audience[],
): Promise<void> => {
	for (const audience of ruledAudiences.filter((held) =>
		audiencesHeld.includes(held),
	))
		await check(run.context, UI_STAGE, `c5-${audience}`, async () => {
			const bodies = [...run.raw].filter(
				([path]) =>
					/\/(kpi|audience-report)\?/.test(path) &&
					new URLSearchParams(path.split("?")[1]).get("audience") === audience,
			);
			if (bodies.length === 0)
				return {
					status: "BLOCKED",
					why: `no ${audience} answer was read (the reader lines above say why)`,
				};
			const found = bodies.flatMap(([path, text]) =>
				leaksIn(text).map(
					(what) => `${what} in ${path.split("?")[0]?.split("/").pop()}`,
				),
			);
			const bytes = bodies.reduce((total, [, text]) => total + text.length, 0);
			return found.length === 0
				? {
						status: "PASS",
						why: `${bodies.length} raw ${audience} answer(s), ${bytes} bytes: no family: key, cus_ id or email`,
					}
				: {
						status: "FAIL",
						why: `the ${audience} answers hold ${[...new Set(found)].join("; ")}`,
					};
		});
};

/** Item 4, C4: the Dashboard on every KPI document the viewer may preview, cell by cell against the document. */
const c4 = async (
	run: Run,
	audiencesHeld: readonly Audience[],
	documents: Map<string, KpiDocument>,
): Promise<void> => {
	const kept = keptReader(run.reader);
	const clock: Clock = clockAt(
		run.now() / MILLISECONDS_PER_SECOND,
		run.timeZone,
	);
	const variants = audiencesHeld.flatMap((audience) =>
		LOCKABLE_AUDIENCES.includes(audience)
			? [
					{ audience, pinLocked: false },
					{ audience, pinLocked: true },
				]
			: [{ audience, pinLocked: false }],
	);
	const adapters = {
		mount: mountApp,
		reader: kept.reader,
		writer: run.writer,
		clock,
	};
	/** The document the app renders from: the kept Reader's, so the judged render and its document are one answer. */
	const documentOf = async (audience: Audience, pinLocked: boolean) => {
		if (!documents.has(variantName(audience, pinLocked))) return undefined;
		try {
			return await kept.reader.kpiDocument({
				school: run.school.id,
				preset: "",
				audience,
				pinLocked,
			});
		} catch {
			return undefined;
		}
	};
	// A first pass reads what each render reads, so the judged pass renders from answers in hand.
	for (const { audience, pinLocked } of variants) {
		const expected = await documentOf(audience, pinLocked);
		if (expected) await dashboardProblems(adapters, expected);
	}
	await kept.settled();
	const errorsBefore = kept.errors.length;
	for (const { audience, pinLocked } of variants)
		await check(
			run.context,
			UI_STAGE,
			`c4-${variantName(audience, pinLocked)}`,
			async () => {
				const expected = await documentOf(audience, pinLocked);
				if (!expected)
					return {
						status: "BLOCKED",
						why: "needs the document (its reader line above)",
					};
				const errorCount = kept.errors.length;
				const found = await dashboardProblems(adapters, expected);
				await kept.settled();
				const errors = kept.errors.slice(errorCount);
				const problems = [...errors, ...found.problems];
				if (problems.length > 0)
					return {
						status: "FAIL",
						why: `${problems.length} problem(s) in ${found.renders} render(s): ${problems.slice(0, PROBLEMS_SHOWN).join("; ")}`,
					};
				if (found.renders === 0)
					return {
						status: "PASS",
						why: "the document shows no period: nothing to render (C4 checks none)",
					};
				return {
					status: "PASS",
					why: `${found.renders} render(s) of every view and shown period, each cell as the document has it (${documentSummary(expected)}), no Reader error`,
				};
			},
		);
	if (errorsBefore > 0)
		run.context.log(
			scrub(
				`  c4 first pass: ${errorsBefore} Reader rejection(s): ${kept.errors.slice(0, PROBLEMS_SHOWN).join("; ")}`,
			),
		);
};

/** The school for the gating checks: S8F_SCHOOL_ID_NO_FINANCE when the token has it without the grant, else the
 * token's first school without it. */
const gatedSchool = (
	run: Run,
	schools: readonly LedgerSchoolClaim[],
): { claim: LedgerSchoolClaim } | { blocked: string } => {
	const wanted = run.context.inputs.schoolIdNoFinance;
	if (wanted !== undefined) {
		const claim = schools.find((school) => school.id === wanted);
		if (!claim)
			return {
				blocked: `account ${maskEmail(run.owner.email)} does not administer S8F_SCHOOL_ID_NO_FINANCE ${wanted}: the school's owner adds it as an admin without the finance grant`,
			};
		if (claim.finance)
			return {
				blocked: `the token is finance:true on S8F_SCHOOL_ID_NO_FINANCE ${wanted}: the school's owner removes the grant, or names another school`,
			};
		return { claim };
	}
	const claim = schools.find((school) => !school.finance);
	return claim
		? { claim }
		: {
				blocked: `the token of ${maskEmail(run.owner.email)} is finance:true on every school: set S8F_SCHOOL_ID_NO_FINANCE to a school the account administers without the finance grant, or the owner adds it to one`,
			};
};

const financeRefusal = (error: unknown): Verdict =>
	error instanceof AdapterError &&
	error.kind === "forbidden" &&
	error.detail.code === "finance_required"
		? {
				status: "PASS",
				why: `rejects forbidden finance_required (${error.message})`,
			}
		: {
				status: "FAIL",
				why: `rejects ${describeError(error)}, expected forbidden finance_required`,
			};

/** Item 5: the school where the token is finance:false, through the Reader and the mounted Ledger. */
const gating = async (
	run: Run,
	schools: readonly LedgerSchoolClaim[],
): Promise<void> => {
	const chosen = gatedSchool(run, schools);
	if ("blocked" in chosen) {
		for (const name of [
			"gating-ledger",
			"gating-income-statement",
			"gating-ledger-mount",
		])
			run.context.report.add(UI_STAGE, name, "BLOCKED", chosen.blocked);
		return;
	}
	const id = chosen.claim.id;
	const today = clockAt(
		run.now() / MILLISECONDS_PER_SECOND,
		run.timeZone,
	).today;
	const from = `${today.slice(0, 8)}01`;
	const refused = async (name: string, call: () => Promise<unknown>) =>
		check(run.context, UI_STAGE, name, async () => {
			try {
				await call();
			} catch (error) {
				const verdict = financeRefusal(error);
				return {
					...verdict,
					why: `${id} (${chosen.claim.role}, finance:false): ${verdict.why}`,
				};
			}
			return {
				status: "FAIL",
				why: `${id} (finance:false): the Reader answered; expected finance_required`,
			};
		});
	await refused("gating-ledger", () =>
		run.reader.ledger({
			school: id,
			from,
			to: today,
			type: null,
			drill: null,
			promo: null,
		}),
	);
	await refused("gating-income-statement", () =>
		run.reader.incomeStatement({ school: id, from, to: today, compare: false }),
	);
	await check(run.context, UI_STAGE, "gating-ledger-mount", async () => {
		const kept = keptReader(run.reader);
		const readsBefore = run.reads.length;
		window.location.hash = `#/${id}/ledger`;
		const app = mounted((root) => {
			const handle = mountApp(root, {
				reader: kept.reader,
				writer: run.writer,
				clock: clockAt(run.now() / MILLISECONDS_PER_SECOND, run.timeZone),
			});
			return () => handle.unmount();
		});
		try {
			const shown = await app.shown(id, "ledger");
			const lock = await waitFor(
				() => app.root.querySelector("[data-test=lock-panel]") !== null,
			);
			const panel = app.root.querySelector("[data-test=lock-panel]");
			const rows = ledgerRows(app.root);
			const financeReads = run.reads
				.slice(readsBefore)
				.filter((path) =>
					new RegExp(
						`/schools/${id}/(ledger|income-statement|members-income)\\?`,
					).test(path),
				);
			const ok = shown && lock && rows === 0 && financeReads.length === 0;
			return {
				status: ok ? "PASS" : "FAIL",
				why: `#/${id}/ledger ${shown ? "rendered" : "did NOT render"}: lock ${panel ? `shown (${panel.getAttribute("data-lock")})` : "NOT shown"}, ${rows} ledger row(s), ${financeReads.length} finance read(s) on the Worker${kept.errors.length ? `; Reader errors: ${kept.errors.slice(0, PROBLEMS_SHOWN).join("; ")}` : ""}`,
			};
		} finally {
			app.close();
		}
	});
};

/** Item 6: the HTTP build's entry, as the browser runs it, on the working school. */
const httpApp = async (
	run: Run,
	ledgerEntries: number | null,
): Promise<void> => {
	const { school, owner } = run;
	const pageFetch = globalThis.fetch;
	const systemNow = Date.now;
	globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) =>
		owner.browserFetch(String(url), init ?? {})) as typeof fetch;
	window.location.hash = `#/${school.id}/dashboard`;
	const app = mounted((root) => {
		Date.now = run.now;
		try {
			mountHttpApp(root, {
				apiBase: run.context.targets.api,
				workerBase: `${run.context.targets.worker}/v1`,
			});
		} finally {
			Date.now = systemNow;
		}
		return () => render(null, root);
	});
	try {
		await check(run.context, UI_STAGE, "http-app-dashboard", async () => {
			const shown = await app.shown(school.id, "dashboard");
			const values = [
				...app.root.querySelectorAll(
					"[data-test=kpi-card] [data-test=kpi-value]",
				),
			].map((value) => value.textContent?.trim() ?? "");
			const figures = values.filter((value) => DIGIT.test(value)).length;
			return {
				status: shown && figures > 0 ? "PASS" : "FAIL",
				why: `mountHttpApp on #/${school.id}/dashboard ${shown ? "rendered" : "did NOT render"}: ${values.length} KPI card(s), ${figures} with a figure`,
			};
		});
		await check(run.context, UI_STAGE, "http-app-ledger", async () => {
			if (!school.finance)
				return {
					status: "BLOCKED",
					why: `the token is finance:false on ${school.id}: the Ledger needs the owner or a finance admin`,
				};
			const shown = await app.open(school.id, "ledger");
			if (shown) await waitFor(() => ledgerRows(app.root) > 0);
			const rows = ledgerRows(app.root);
			const lock = app.root.querySelector("[data-test=lock-panel]");
			if (rows === 0 && ledgerEntries === 0)
				return {
					status: "BLOCKED",
					why: `the Reader's ledger has no entry this month on ${school.id}: an event this month (a payment or a refund) gives the Ledger rows`,
				};
			return {
				status: shown && rows > 0 && lock === null ? "PASS" : "FAIL",
				why: `#/${school.id}/ledger ${shown ? "rendered" : "did NOT render"}: ${rows} row(s)${ledgerEntries === null ? "" : ` (the Reader's ledger has ${ledgerEntries} entr(ies) this month)`}, lock ${lock ? `shown (${lock.getAttribute("data-lock")})` : "not shown"}`,
			};
		});
	} finally {
		app.close();
		globalThis.fetch = pageFetch;
	}
};

/**
 * Stage 5: sign in with the S8f session, open the PIN, build the UI's HTTP adapters on it, and run items 2 to 6 on the
 * working school (S8F_SCHOOL_ID, else the token's first) and the finance:false school.
 */
export const stage5 = async (
	context: Context,
	options: StageOptions = { now: Date.now },
): Promise<void> => {
	const stage = UI_STAGE;
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
	const pin = await owner.verifyPin();
	if (!pin.ok) {
		report.add(stage, "pin-open", pin.status, pin.why);
		return;
	}
	report.add(
		stage,
		"pin-open",
		"PASS",
		"PIN verified on the session before the adapters are built",
	);

	ensureDocument(`${context.targets.worker}/`);
	const workerBase = `${context.targets.worker}/v1`;
	const raw = new Map<string, string>();
	const reads: string[] = [];
	const browserFetch: Fetch = async (url, init) => {
		const response = await owner.browserFetch(url, init);
		if (url.startsWith(workerBase)) {
			const path = url.slice(workerBase.length);
			reads.push(path);
			raw.set(path, await response.clone().text());
		}
		return response;
	};
	let built: WorkerSource | undefined;
	const adapters = createHttpAdapters({
		fetch: browserFetch,
		apiBase: context.targets.api,
		scheduler: timerScheduler,
		storage: memoryStorage(),
		newKey: () => randomUUID(),
		worker: (tokens) => {
			built = createFetchWorkerSource({
				fetch: browserFetch,
				base: workerBase,
				tokens,
				scheduler: timerScheduler,
			});
			return built;
		},
		files: {
			save: async () => {
				throw new UsageError("stage 5 saves no file");
			},
		},
	});
	const worker = built as WorkerSource | undefined;
	if (!worker) throw new Error("createHttpAdapters built no Worker source");
	try {
		let claims: LedgerSchoolClaim[] = [];
		let subject = "";
		let viewsPresent = false;
		let adaptersReady = false;
		await check(context, stage, "adapters", async () => {
			const token = await adapters.tokens.current();
			if (!token)
				return {
					status: "FAIL",
					why: "the ledger-token source answered no token (404): the account administers no school",
				};
			claims = token.schools;
			subject = token.subject;
			if (!claims.some((claim) => claim.id === school.id))
				return {
					status: "FAIL",
					why: `the UI's token does not list ${school.id}`,
				};
			const status = await worker.schools();
			const row = status.data.schools.find((entry) => entry.id === school.id);
			viewsPresent = typeof row?.asOf === "string";
			adaptersReady = true;
			return {
				status: "PASS",
				why: `createHttpAdapters on the session: the UI's own ledger-token source minted a token for ${claims.length} school(s) (finance on ${claims.filter((claim) => claim.finance).length}), the Worker source at ${workerBase} answers, ${school.id} asOf ${row?.asOf ?? "null"}`,
			};
		});
		if (!adaptersReady) return;
		const claim = claims.find(
			(entry) => entry.id === school.id,
		) as LedgerSchoolClaim;
		const audiencesHeld = viewerOf(subject, claim).audiences;

		const run: Run = {
			context,
			owner,
			school,
			now: options.now,
			reader: adapters.reader,
			writer: adapters.writer,
			raw,
			reads,
			viewsPresent,
			timeZone: "UTC",
		};
		const schools = await readerCheck(
			run,
			"schools",
			() => run.reader.schools(),
			(answer) => {
				const own = answer.find((entry) => entry.id === school.id);
				return answered(
					own
						? missingField(own, {
								name: "string",
								timeZone: "string",
								currency: "string",
								creditUnit: "object",
								stale: "boolean",
								lagMinutes: "number",
							})
						: `${school.id} is not in the list`,
					`School[] of ${answer.length}: ${school.id} in ${own?.timeZone}, ${own?.currency}, lag ${own?.lagMinutes} min, stale ${own?.stale}`,
				);
			},
		);
		run.timeZone =
			schools?.find((entry) => entry.id === school.id)?.timeZone ?? "UTC";

		const { documents, ledgerEntries } = await readerCoverage(
			run,
			audiencesHeld,
		);
		await c5(run, audiencesHeld);
		await c4(run, audiencesHeld, documents);
		await gating(run, claims);
		await httpApp(run, ledgerEntries);
	} finally {
		adapters.tokens.stop();
	}
};

export const parseUiArgs = (argv: readonly string[]): Arguments => {
	let json = false;
	let strict = false;
	for (const argument of argv) {
		if (argument === "--json") json = true;
		else if (argument === "--strict") strict = true;
		else
			throw new UsageError(
				`unknown argument ${argument} (this script runs stage ${UI_STAGE} only; it takes --json and --strict)`,
			);
	}
	return { stages: [UI_STAGE], json, strict };
};

if (import.meta.main) {
	const rejections: string[] = [];
	process.on("unhandledRejection", (reason) => {
		rejections.push(describeError(reason));
	});
	const code = await runCommand({
		title: "S8e staging check (S8f stage 5, the UI's HTTP adapters)",
		argv: process.argv.slice(2),
		env: process.env,
		parse: parseUiArgs,
		run: (context) => stage5(context),
	});
	if (rejections.length > 0)
		console.error(
			scrub(
				`${rejections.length} unhandled rejection(s) in the mounted app: ${rejections.slice(0, PROBLEMS_SHOWN).join("; ")}`,
			),
		);
	process.exit(code);
}
