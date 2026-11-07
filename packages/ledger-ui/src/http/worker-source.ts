import type {
	Audience,
	DisclosureFile,
	DisclosureOverride,
	SchoolSize,
} from "../data/disclosure.ts";
import type { KpiDocument } from "../data/kpi-document.ts";
import type {
	AudienceReport,
	AudienceReportQuery,
	IncomeStatement,
	IncomeStatementQuery,
	LedgerDay,
	LedgerDrill,
	LedgerEntry,
	LedgerPage,
	LedgerTypeFilter,
} from "../data/ledger.ts";
import type { HistoryEvent, PaymentRow } from "../data/members.ts";
import {
	AdapterError,
	type AdapterErrorKind,
	schemaMismatch,
} from "./errors.ts";
import type { LedgerTokenSource } from "./ledger-token.ts";
import type { Fetch, Scheduler } from "./transport.ts";
import {
	isRecord,
	nullableNumberOf,
	nullableStringOf,
	recordOf,
} from "./wire.ts";

/**
 * The ledger Worker's reads (`plans/ledger-ui/S8-contract.md` section 11): every read of atm data. Part 1 of S8e
 * ships this seam, a source that rejects every call with `not_connected`, and the fetch source written against
 * section 11; part 2 runs the fetch source against `packages/ledger-worker/src/testing/harness.ts` (S8c) and the
 * C1 to C5 gates.
 *
 * Every answer keeps the manifest's `asOf` and `lagMinutes`: the Reader clears the pending writes a read has shipped
 * and shows the lag. A `null` in `data` is a figure with no source (D11); `501 not_available` is a whole answer with
 * no source (D12) and rejects as `not_available`.
 */

export type WorkerAnswer<Data> = {
	/** The views manifest's `asOf` (ISO instant). */
	asOf: string | null;
	lagMinutes: number | null;
	data: Data;
};

/** `GET /v1/schools`: one row per school of the token. */
export type WorkerSchoolStatus = {
	id: string;
	asOf: string | null;
	lagMinutes: number | null;
	stale: boolean;
};

/** `GET /v1/schools/:school/disclosure`: the Reader adds `viewer`, `views` and `viewAs`. */
export type WorkerDisclosure = {
	school: string;
	year: number;
	size: SchoolSize;
	file: DisclosureFile;
	/** null until buzz-school stores one (build list group 8): the B4 Uni defaults apply. */
	override: DisclosureOverride | null;
	source: string;
};

/** A ledger entry as the Worker sends it: `member` is the key only; the Reader joins the name from members-list. */
export type WorkerLedgerEntry = Omit<LedgerEntry, "member"> & {
	member: { key: string } | null;
};
export type WorkerLedgerDay = Omit<LedgerDay, "entries"> & {
	entries: WorkerLedgerEntry[];
};
export type WorkerLedgerPage = Omit<LedgerPage, "pending" | "days"> & {
	/** Always empty: the Worker cannot see buzz-school's unshipped outbox. */
	pending: WorkerLedgerEntry[];
	days: WorkerLedgerDay[];
};

export type WorkerLedgerQuery = {
	school: string;
	from: string;
	to: string;
	type: LedgerTypeFilter | null;
	drill: LedgerDrill | null;
};

/** `GET /v1/schools/:school/members/:key/money`: the money half of `memberDetail`. */
export type WorkerMemberMoney = {
	payments: PaymentRow[];
	history: HistoryEvent[];
};

export interface WorkerSource {
	schools(): Promise<WorkerAnswer<{ schools: WorkerSchoolStatus[] }>>;
	kpiDocument(query: {
		school: string;
		audience: Audience;
		pinLocked: boolean;
	}): Promise<WorkerAnswer<KpiDocument>>;
	disclosure(school: string): Promise<WorkerAnswer<WorkerDisclosure>>;
	audienceReport(
		query: AudienceReportQuery,
	): Promise<WorkerAnswer<AudienceReport>>;
	ledger(query: WorkerLedgerQuery): Promise<WorkerAnswer<WorkerLedgerPage>>;
	incomeStatement(
		query: IncomeStatementQuery,
	): Promise<WorkerAnswer<IncomeStatement>>;
	membersIncome(query: {
		school: string;
		from: string;
		to: string;
	}): Promise<WorkerAnswer<{ cents: number }>>;
	memberMoney(query: {
		school: string;
		key: string;
	}): Promise<WorkerAnswer<WorkerMemberMoney>>;
}

/** Part 1's Worker: every call rejects with `not_connected`. */
export function notConnectedWorker(): WorkerSource {
	const reject = (call: string) => () =>
		Promise.reject(
			new AdapterError(
				"not_connected",
				`${call} reads the ledger Worker, which S8e part 2 connects`,
				{ code: "not_connected" },
			),
		);
	return {
		schools: reject("schools"),
		kpiDocument: reject("kpiDocument"),
		disclosure: reject("disclosure"),
		audienceReport: reject("audienceReport"),
		ledger: reject("ledger"),
		incomeStatement: reject("incomeStatement"),
		membersIncome: reject("membersIncome"),
		memberMoney: reject("memberMoney"),
	};
}

const kindOfWorkerError = (status: number, code: string): AdapterErrorKind => {
	if (status === 400) return "bad_request";
	if (status === 401) return "unauthenticated";
	if (status === 403) return "forbidden";
	if (status === 404) return code === "no_data" ? "no_data" : "not_found";
	if (status === 409) return "conflict";
	if (status === 429) return "rate_limited";
	if (status === 501) return "not_available";
	if (status === 503) return "unavailable";
	return "server";
};

/** The default wait before a second try after `409 view_mismatch` (section 11 says the Worker sends 5). */
const viewMismatchWaitSeconds = 5;

async function workerErrorOf(
	response: Response,
	path: string,
): Promise<AdapterError> {
	let body: unknown = null;
	try {
		body = await response.json();
	} catch {
		body = null;
	}
	const error = isRecord(body) && isRecord(body.error) ? body.error : {};
	const code =
		typeof error.code === "string" ? error.code : `http_${response.status}`;
	const message = typeof error.message === "string" ? error.message : code;
	return new AdapterError(
		kindOfWorkerError(response.status, code),
		`${response.status} ${code} on ${path}: ${message}`,
		{
			status: response.status,
			code,
			...(typeof error.field === "string" ? { field: error.field } : {}),
			...(typeof error.retryAfterSeconds === "number"
				? { retryAfterSeconds: error.retryAfterSeconds }
				: {}),
		},
	);
}

function answerOf<Data>(path: string, body: unknown): WorkerAnswer<Data> {
	const route = `GET ${path}`;
	const envelope = recordOf(route, body, "answer");
	if (!("data" in envelope)) throw schemaMismatch(route, "answer has no data");
	return {
		asOf: nullableStringOf(route, envelope.asOf ?? null, "asOf"),
		lagMinutes: nullableNumberOf(
			route,
			envelope.lagMinutes ?? null,
			"lagMinutes",
		),
		data: envelope.data as Data,
	};
}

/** The fetch source over section 11: base `/v1` on the UI's own origin, GET only, the ledger token as the bearer. A
 * 401 mints a new token and tries once more; a `409 view_mismatch` waits `retryAfterSeconds` and tries once more. */
export function createFetchWorkerSource(options: {
	fetch: Fetch;
	/** `/v1` on the UI's origin, or a full URL in tests. */
	base: string;
	tokens: LedgerTokenSource;
	scheduler: Scheduler;
}): WorkerSource {
	const get = async <Data>(
		path: string,
		query: Record<string, string | undefined> = {},
	): Promise<WorkerAnswer<Data>> => {
		const search = new URLSearchParams();
		for (const [name, value] of Object.entries(query))
			if (value !== undefined) search.set(name, value);
		const text = search.toString();
		const url = `${options.base}${path}${text ? `?${text}` : ""}`;
		let refreshed = false;
		let waited = false;
		for (;;) {
			const token = refreshed
				? await options.tokens.refresh()
				: await options.tokens.current();
			if (!token)
				throw new AdapterError(
					"not_found",
					"no ledger token: the person administers no school",
					{
						code: "not_found",
					},
				);
			let response: Response;
			try {
				response = await options.fetch(url, {
					method: "GET",
					headers: {
						accept: "application/json",
						authorization: `Bearer ${token.token}`,
					},
				});
			} catch (cause) {
				throw new AdapterError(
					"network",
					`no answer from ${path}: ${String(cause)}`,
				);
			}
			if (response.ok) {
				let body: unknown;
				try {
					body = await response.json();
				} catch {
					throw new AdapterError("schema_mismatch", `${path} answered no JSON`);
				}
				return answerOf<Data>(path, body);
			}
			const error = await workerErrorOf(response, path);
			if (error.kind === "unauthenticated" && !refreshed) {
				refreshed = true;
				continue;
			}
			if (error.detail.code === "view_mismatch" && !waited) {
				waited = true;
				await options.scheduler.wait(
					error.detail.retryAfterSeconds ?? viewMismatchWaitSeconds,
				);
				continue;
			}
			throw error;
		}
	};
	const school = (id: string) => `/schools/${encodeURIComponent(id)}`;
	return {
		schools: () => get("/schools"),
		kpiDocument: ({ school: id, audience, pinLocked }) =>
			get(`${school(id)}/kpi`, {
				audience,
				pin: pinLocked ? "locked" : "open",
			}),
		disclosure: (id) => get(`${school(id)}/disclosure`),
		audienceReport: ({ school: id, audience, from, to }) =>
			get(`${school(id)}/audience-report`, { audience, from, to }),
		ledger: ({ school: id, from, to, type, drill }) =>
			get(`${school(id)}/ledger`, {
				from,
				to,
				type: type ?? undefined,
				drill: drill ?? undefined,
			}),
		incomeStatement: ({ school: id, from, to, compare }) =>
			get(`${school(id)}/income-statement`, {
				from,
				to,
				compare: compare ? "1" : "0",
			}),
		membersIncome: ({ school: id, from, to }) =>
			get(`${school(id)}/members-income`, { from, to }),
		memberMoney: ({ school: id, key }) =>
			get(`${school(id)}/members/${encodeURIComponent(key)}/money`),
	};
}
