import type { Booking } from "../data/bookings.ts";
import type { LedgerEntry, LedgerPage } from "../data/ledger.ts";
import type { MenuVersionBody } from "../data/plans.ts";
import type { Reader } from "../data/reader.ts";
import type { School } from "../data/types.ts";
import { assembleDisclosure, viewerOf } from "./disclosure.ts";
import { AdapterError, notAvailable, schemaMismatch } from "./errors.ts";
import type { LedgerTokenSource } from "./ledger-token.ts";
import type { PendingStore, PendingWrite } from "./pending.ts";
import {
	bookingOf,
	bookingsPageOf,
	capabilitiesOf,
	financeGrantsOf,
	invoiceItemsOf,
	liveVersionOf,
	memberNamesOf,
	membersOf,
	membersPageOf,
	menuVersionBodyOf,
	menuVersionsOf,
	routes,
	schoolFactsOf,
	switchTiersOf,
} from "./school-routes.ts";
import type { ApiClient } from "./transport.ts";
import type { WireRecord } from "./wire.ts";
import type {
	WorkerAnswer,
	WorkerLedgerEntry,
	WorkerSource,
} from "./worker-source.ts";

/**
 * The HTTP Reader (S8e): every `Reader` call, from buzz-school's routes on `api.b4uni.com` (the session cookie), the
 * ledger Worker (`WorkerSource`, the ledger token), or, where nothing provides it, a typed `not_available`
 * rejection that names the gap. It never answers 0 for a missing figure, never a figure it worked out, and never
 * fixture data. `tsc` proves it covers `Reader`; `pendingWrites` is extra, for the pending state.
 */

/** members-list pages are read whole for the ledger's name join, at the route's page cap. */
const membersPageLimit = "100";

export type HttpReader = Reader & {
	/** The school's writes not yet shipped (the pending store), oldest first. */
	pendingWrites(school: string): PendingWrite[];
	/** The not-available reasons of the last `schools()`: each school it left out, and the null that left it out
	 * (`<id>.timeZone`, `<id>.creditUnit`, `<id>.lagMinutes`). Empty when every school was answered. */
	schoolsLeftOut(): string[];
};

export function createHttpReader(options: {
	api: ApiClient;
	worker: WorkerSource;
	tokens: LedgerTokenSource;
	pending: PendingStore;
}): HttpReader {
	const { api, worker, tokens, pending } = options;
	let leftOut: string[] = [];

	/** A Worker answer has shipped every write its `asOf` passes. */
	const seen = <Data>(school: string, answer: WorkerAnswer<Data>): Data => {
		if (answer.asOf) pending.clearShipped(school, answer.asOf);
		return answer.data;
	};

	const claimOf = async (school: string) => {
		const token = await tokens.current();
		const claim = token?.schools.find(({ id }) => id === school);
		if (!token || !claim)
			throw new AdapterError(
				"not_found",
				`school ${school} is not in the ledger token`,
				{ code: "not_found" },
			);
		return { token, claim };
	};

	const allMemberRows = async (school: string): Promise<WireRecord[]> => {
		const rows: WireRecord[] = [];
		let cursor: string | undefined;
		do {
			const page = membersPageOf(
				await api.get(routes.members(school), {
					cursor,
					limit: membersPageLimit,
				}),
			);
			rows.push(...page.rows);
			cursor = page.nextCursor ?? undefined;
		} while (cursor);
		return rows;
	};

	const liveMenu = async (
		school: string,
	): Promise<MenuVersionBody | undefined> => {
		const live = liveVersionOf(
			menuVersionsOf(await api.get(routes.menuVersions(school))),
		);
		return live
			? menuVersionBodyOf(
					await api.get(routes.menuVersion(school, live.version)),
				)
			: undefined;
	};

	const unavailable =
		(call: string, reference: string) => async (): Promise<never> => {
			throw notAvailable(call, reference);
		};

	return {
		pendingWrites: (school) => pending.forSchool(school),
		schoolsLeftOut: () => [...leftOut],

		schools: async () => {
			const token = await tokens.current();
			if (!token) {
				leftOut = [];
				return [];
			}
			const [facts, status] = await Promise.all([
				Promise.all(
					token.schools.map(async ({ id }) =>
						schoolFactsOf(await api.get(routes.school(id))),
					),
				),
				worker.schools(),
			]);
			// Name, time zone, currency and credit unit come from ledger/school, stale and lag from the Worker.
			// `attentionCount` and `tabBadges` have no source on either side: null, so no badge shows. A null currency
			// is a school with no menu and no Stripe account (S8-contract section 11): it passes through, and its money
			// reads "—". A null time zone, credit unit or lag leaves only that school out, with the reason kept in
			// `schoolsLeftOut`: one school never blocks the others.
			const missing: string[] = [];
			const schools: School[] = [];
			token.schools.forEach((claim, index) => {
				const fact = facts[index];
				const row = status.data.schools.find(({ id }) => id === claim.id);
				if (row?.asOf) pending.clearShipped(claim.id, row.asOf);
				for (const field of ["timeZone", "creditUnit"] as const)
					if (!fact || fact[field] === null)
						missing.push(`${claim.id}.${field}`);
				if (!row || row.lagMinutes === null)
					missing.push(`${claim.id}.lagMinutes`);
				if (
					!fact?.timeZone ||
					!fact.creditUnit ||
					!row ||
					row.lagMinutes === null
				)
					return;
				schools.push({
					id: claim.id,
					name: fact.name,
					timeZone: fact.timeZone,
					currency: fact.currency,
					role: claim.role,
					creditUnit: fact.creditUnit,
					stale: row.stale,
					lagMinutes: row.lagMinutes,
					attentionCount: null,
					tabBadges: null,
				});
			});
			leftOut = missing;
			// Every school left out is not "no schools": the token has some, and none can be shown.
			if (!schools.length && missing.length)
				throw notAvailable("schools", `null: ${missing.join(", ")}`);
			return schools;
		},

		/* Real data has no presets (S8c): the Dashboard shows no scenario control. */
		dashboardOptions: async () => ({ presets: [] }),

		kpiDocument: async ({ school, audience, pinLocked }) =>
			seen(school, await worker.kpiDocument({ school, audience, pinLocked })),

		disclosure: async (school) => {
			const { token, claim } = await claimOf(school);
			const answer = await worker.disclosure(school);
			return assembleDisclosure(
				seen(school, answer),
				viewerOf(token.subject, claim),
			);
		},

		bookings: async ({ school, from, to }) => {
			const bookings: Booking[] = [];
			let cursor: string | undefined;
			do {
				const page = bookingsPageOf(
					await api.get(routes.bookings(school), { from, to, cursor }),
				);
				page.rows.forEach((row, index) => {
					const booking = bookingOf(row, page.timeZone, index);
					if (booking) bookings.push(booking);
				});
				cursor = page.nextCursor ?? undefined;
			} while (cursor);
			return { bookings };
		},

		menuVersions: async (school) =>
			menuVersionsOf(await api.get(routes.menuVersions(school))),
		menuVersion: async (school, version) => {
			try {
				return menuVersionBodyOf(
					await api.get(routes.menuVersion(school, version)),
				);
			} catch (error) {
				if (error instanceof AdapterError && error.kind === "not_found")
					return undefined;
				throw error;
			}
		},
		planSummary: unavailable(
			"planSummary",
			"GET .../billing/members counts lack ending, activeUnits and monthlyMinor (S8d-bz2), collected has no Worker endpoint, purchaseLinkShared has no source",
		),

		members: async ({ schoolId, status, cursor, limit }) =>
			membersOf(
				membersPageOf(
					await api.get(routes.members(schoolId), {
						status,
						cursor,
						limit: limit === undefined ? undefined : String(limit),
					}),
				),
			),
		people: unavailable(
			"people",
			"no route lists people and roles (buzz-school build list group 4, ledger/people)",
		),
		membersSummary: unavailable(
			"membersSummary",
			"no route (build list group 1, ledger/members-summary)",
		),
		membersIncome: async ({ schoolId, from, to }) => {
			const data = seen(
				schoolId,
				await worker.membersIncome({ school: schoolId, from, to }),
			);
			if (typeof data?.cents !== "number")
				throw schemaMismatch(
					"GET /v1/.../members-income",
					"data.cents is not a number",
				);
			return data.cents;
		},
		capabilities: async ({ schoolId }) =>
			capabilitiesOf(await api.get(routes.capabilities(schoolId))),
		financeGrants: async ({ schoolId }) =>
			financeGrantsOf(await api.get(routes.financeGrants(schoolId))),
		memberDetail: unavailable(
			"memberDetail",
			"its bookings need the attendee's profile id and credits held (not in GET .../bookings; D12), refundable and stripeDashboardUrl need ledger/members/<person>/money (build list group 5); the money half is WorkerSource.memberMoney",
		),
		invoiceItems: async ({ schoolId }) => {
			const live = await liveMenu(schoolId);
			return live ? invoiceItemsOf(live.menu) : [];
		},
		switchTiers: async ({ schoolId }) => {
			const live = await liveMenu(schoolId);
			return live ? switchTiersOf(live.menu) : [];
		},
		auditMember: unavailable(
			"auditMember",
			"no replay route (capability audit is not_built)",
		),

		ledger: async ({ school, from, to, type, drill, promo }) => {
			if (promo !== null)
				throw notAvailable(
					"ledger by promo",
					"no event names a promo code (S8-contract section 11)",
				);
			const [answer, rows] = await Promise.all([
				worker.ledger({ school, from, to, type, drill }),
				allMemberRows(school),
			]);
			const names = memberNamesOf(rows);
			const joined = (entry: WorkerLedgerEntry): LedgerEntry => {
				// The log holds a promo's id, not its code: with no code there is no "· promo <code>" to show.
				const promo =
					entry.promo === null || entry.promo.code === null
						? null
						: { id: entry.promo.id, code: entry.promo.code };
				if (entry.member === null) return { ...entry, member: null, promo };
				const found = names.get(entry.member.key);
				if (!found)
					throw schemaMismatch(
						"ledger member join",
						`key ${entry.member.key} has no members-list row`,
					);
				return {
					...entry,
					member: { key: entry.member.key, ...found },
					promo,
				};
			};
			const page = seen(school, answer);
			const result: LedgerPage = {
				...page,
				pending: page.pending.map(joined),
				days: page.days.map((day) => ({
					...day,
					entries: day.entries.map(joined),
				})),
			};
			return result;
		},
		/* A school with no published menu has a null currency and unit: Reports uses the school's own. */
		incomeStatement: async (query) =>
			seen(query.school, await worker.incomeStatement(query)),
		audienceReport: async (query) =>
			seen(query.school, await worker.audienceReport(query)),
		donors: unavailable(
			"donors",
			"donor names and spreads have no source (S8-contract section 11, D5)",
		),
		promos: unavailable("promos", "no promo route (D8)"),
		/* No school-level booking rule exists (D11): no rules, and the UI uses the school's own credit unit. */
		schoolRules: async () => ({ rules: null, unit: null }),

		memberPortal: unavailable(
			"memberPortal",
			"no member-scoped read (D6, build list group 7)",
		),
		settings: unavailable(
			"settings",
			"no ledger/settings read (build list group 6); accounting basis, Zeffy, keys and booking rules have no ledger-callable source",
		),
	};
}
