import type { Booking } from "../data/bookings.ts";
import type { LedgerEntry, LedgerPage } from "../data/ledger.ts";
import type { MenuVersionBody } from "../data/plans.ts";
import type { Reader } from "../data/reader.ts";
import type { School } from "../data/types.ts";
import { isDemoSchool } from "./demo.ts";
import { assembleDisclosure, viewerOf } from "./disclosure.ts";
import { AdapterError, notAvailable, schemaMismatch } from "./errors.ts";
import type {
	LedgerSchoolClaim,
	LedgerToken,
	LedgerTokenSource,
} from "./ledger-token.ts";
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
	WorkerSchoolStatus,
	WorkerSource,
} from "./worker-source.ts";

/**
 * The HTTP Reader (S8e): every `Reader` call, from buzz-school's routes on `api.b4uni.com` (the session cookie), the
 * ledger Worker (`WorkerSource`, the ledger token), or, where nothing provides it, a typed `not_available`
 * rejection that names the gap. It never answers 0 for a missing figure, never a figure it worked out, and never
 * fixture data. `tsc` proves it covers `Reader`; `pendingWrites` is extra, for the pending state.
 *
 * A demo school's buzz-school reads go to the Worker's `demo-api` routes instead (S8-contract section 11 "Demo
 * schools"): the same routes' answers, worked out from the scenario's events and stored in R2, parsed by the same
 * functions. Its plan counts, people and members summary, which no route sends, are counted from those answers
 * (`demo-reads.ts`).
 */

/** A buzz-school route of one school's: the school and the path after it. */
const schoolRoute = /^\/school-admin\/schools\/([^/]+)\/(.+)$/;
/** The demo schools' derived reads (counts and rows the routes do not send), loaded with their first use. */
const demoReads = () => import("./demo-reads.ts");

/** members-list pages are read whole for the ledger's name join, at the route's page cap. */
const membersPageLimit = "100";
/** The demo schools' viewer: no one is signed in, or the person holds no grant on the school. */
const demoSubject = "demo";

/** Who the last `schools()` read for: a signed-in person with schools of their own, a visitor who is not signed in, or
 * a person who administers no school. The last two see only the demo schools. */
export type Session = "signed_in" | "signed_out" | "no_school";

const isUnauthenticated = (error: unknown): boolean =>
	error instanceof AdapterError && error.kind === "unauthenticated";

/** A Worker demo row as the switcher's school, or null when it lacks a fact the UI needs. */
function demoSchoolOf(row: WorkerSchoolStatus): School | null {
	const unit = row.creditUnit;
	if (
		row.demo !== true ||
		!isDemoSchool(row.id) ||
		typeof row.name !== "string" ||
		typeof row.timeZone !== "string" ||
		typeof unit?.one !== "string" ||
		typeof unit.other !== "string"
	)
		return null;
	return {
		id: row.id,
		name: row.name,
		timeZone: row.timeZone,
		currency: typeof row.currency === "string" ? row.currency : null,
		role: "owner",
		creditUnit: { one: unit.one, other: unit.other },
		...(typeof row.bookingsOpenOn === "string"
			? { bookingsOpenOn: row.bookingsOpenOn }
			: {}),
		// Nothing ships to a demo school: it is never behind.
		stale: false,
		lagMinutes: row.lagMinutes,
		attentionCount: null,
		tabBadges: null,
		demo: true,
	};
}

/** The ledger's member column for a demo school: the key's family id, since no roster names its fictional people. */
const demoMemberOf = (key: string): { id: string; name: string } => {
	const id = key.slice(key.indexOf(":") + 1);
	return { id, name: `Family ${id}` };
};

export type HttpReader = Reader & {
	/** The school's writes not yet shipped (the pending store), oldest first. */
	pendingWrites(school: string): PendingWrite[];
	/** The not-available reasons of the last `schools()`: each school it left out, and the null that left it out
	 * (`<id>.timeZone`, `<id>.creditUnit`). Empty when every school was answered. */
	schoolsLeftOut(): string[];
	/** Who the last `schools()` read for (`signed_in` before the first). */
	session(): Session;
};

export function createHttpReader(options: {
	api: ApiClient;
	worker: WorkerSource;
	tokens: LedgerTokenSource;
	pending: PendingStore;
}): HttpReader {
	const { api, worker, tokens, pending } = options;
	let leftOut: string[] = [];
	let session: Session = "signed_in";

	/** A Worker answer has shipped every write its `asOf` passes. */
	const seen = <Data>(school: string, answer: WorkerAnswer<Data>): Data => {
		if (answer.asOf) pending.clearShipped(school, answer.asOf);
		return answer.data;
	};

	const claimOf = async (school: string) => {
		if (isDemoSchool(school)) {
			const token = await tokens.current().catch(() => null);
			const claim: LedgerSchoolClaim = {
				id: school,
				role: "owner",
				finance: true,
			};
			return { subject: token?.subject ?? demoSubject, claim };
		}
		const token = await tokens.current();
		const claim = token?.schools.find(({ id }) => id === school);
		if (!token || !claim)
			throw new AdapterError(
				"not_found",
				`school ${school} is not in the ledger token`,
				{ code: "not_found" },
			);
		return { subject: token.subject, claim };
	};

	/** The demo schools of a `GET /v1/schools` answer, in its order; those that lack a fact are left out. */
	const demoSchoolsIn = (
		rows: readonly WorkerSchoolStatus[],
		missing: string[],
	): School[] =>
		rows.flatMap((row) => {
			if (row.demo !== true) return [];
			const school = demoSchoolOf(row);
			if (!school) missing.push(`${row.id}.demo`);
			return school ? [school] : [];
		});

	/** Not signed in, or no school: the demo schools alone. Null when the Worker serves none (production) or cannot
	 * be read: the person is then signed out, or has no school, as before demo schools. */
	const demoOnly = async (): Promise<School[] | null> => {
		let rows: WorkerSchoolStatus[];
		try {
			rows = (await worker.schools()).data.schools;
		} catch {
			return null;
		}
		const missing: string[] = [];
		const schools = demoSchoolsIn(rows, missing);
		leftOut = missing;
		return schools.length ? schools : null;
	};

	/** buzz-school's routes for a demo school: the Worker's stored answers to them, as the route would send them. */
	const demoApi: Pick<ApiClient, "get"> = {
		get: async (path, query) => {
			const match = schoolRoute.exec(path);
			if (!match)
				throw schemaMismatch("demo-api", `${path} is not a school route`);
			const answer = await worker.demoApi({
				school: decodeURIComponent(match[1] as string),
				route: match[2] as string,
				...(query ? { query } : {}),
			});
			return answer.data;
		},
	};
	/** Where a school's buzz-school reads go. */
	const clientFor = (school: string): Pick<ApiClient, "get"> =>
		isDemoSchool(school) ? demoApi : api;

	const allMemberRows = async (school: string): Promise<WireRecord[]> => {
		const rows: WireRecord[] = [];
		let cursor: string | undefined;
		do {
			const page = membersPageOf(
				await clientFor(school).get(routes.members(school), {
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
		const client = clientFor(school);
		const live = liveVersionOf(
			menuVersionsOf(await client.get(routes.menuVersions(school))),
		);
		return live
			? menuVersionBodyOf(
					await client.get(routes.menuVersion(school, live.version)),
				)
			: undefined;
	};

	const capabilitiesFor = async (school: string) =>
		capabilitiesOf(await clientFor(school).get(routes.capabilities(school)));

	/** A demo school's members, every page. */
	const demoMembers = async (school: string) =>
		membersOf({ rows: await allMemberRows(school), nextCursor: null });

	const unavailable =
		(call: string, reference: string) => async (): Promise<never> => {
			throw notAvailable(call, reference);
		};

	return {
		pendingWrites: (school) => pending.forSchool(school),
		schoolsLeftOut: () => [...leftOut],
		session: () => session,

		schools: async () => {
			// The schools are read once per page and again on Try again: a 401 kept from before is asked again here, and
			// every other read keeps it (`ledger-token.ts`).
			tokens.forgetSignedOut();
			let token: LedgerToken | null;
			try {
				token = await tokens.current();
			} catch (error) {
				// Signed out: the demo schools, or the sign-in prompt where there are none.
				if (!isUnauthenticated(error)) throw error;
				const demos = await demoOnly();
				if (!demos) throw error;
				session = "signed_out";
				return demos;
			}
			if (!token) {
				const demos = await demoOnly();
				session = "no_school";
				if (!demos) leftOut = [];
				return demos ?? [];
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
			// reads "—". A school the Worker has no views for yet (nothing shipped) is listed with a null lag and not
			// stale. A null time zone or credit unit leaves only that school out, with the reason kept in
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
				if (!fact?.timeZone || !fact.creditUnit) return;
				const lagMinutes = row?.lagMinutes ?? null;
				schools.push({
					id: claim.id,
					name: fact.name,
					timeZone: fact.timeZone,
					currency: fact.currency,
					role: claim.role,
					creditUnit: fact.creditUnit,
					// No views yet is not a stuck shipper: only a school with a lag can be behind.
					stale: lagMinutes !== null && (row?.stale ?? false),
					lagMinutes,
					attentionCount: null,
					tabBadges: null,
					demo: false,
				});
			});
			// Every school left out is not "no schools": the token has some, and none can be shown.
			if (!schools.length && missing.length) {
				leftOut = missing;
				throw notAvailable("schools", `null: ${missing.join(", ")}`);
			}
			// The person's own schools first, then the demo schools the Worker lists (none in production).
			const listed = new Set(token.schools.map(({ id }) => id));
			const demos = demoSchoolsIn(
				status.data.schools.filter(({ id }) => !listed.has(id)),
				missing,
			);
			leftOut = missing;
			session = "signed_in";
			return [...schools, ...demos];
		},

		/* Real data has no presets (S8c): the Dashboard shows no scenario control. */
		dashboardOptions: async () => ({ presets: [] }),

		kpiDocument: async ({ school, audience, pinLocked }) =>
			seen(school, await worker.kpiDocument({ school, audience, pinLocked })),

		disclosure: async (school) => {
			const { subject, claim } = await claimOf(school);
			const answer = await worker.disclosure(school);
			return assembleDisclosure(seen(school, answer), viewerOf(subject, claim));
		},

		bookings: async ({ school, from, to }) => {
			const bookings: Booking[] = [];
			let cursor: string | undefined;
			do {
				const page = bookingsPageOf(
					await clientFor(school).get(routes.bookings(school), {
						from,
						to,
						cursor,
					}),
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
			menuVersionsOf(await clientFor(school).get(routes.menuVersions(school))),
		menuVersion: async (school, version) => {
			try {
				return menuVersionBodyOf(
					await clientFor(school).get(routes.menuVersion(school, version)),
				);
			} catch (error) {
				if (error instanceof AdapterError && error.kind === "not_found")
					return undefined;
				throw error;
			}
		},
		planSummary: async (school) => {
			if (!isDemoSchool(school))
				return unavailable(
					"planSummary",
					"GET .../billing/members counts lack ending, activeUnits and monthlyMinor (S8d-bz2), collected has no Worker endpoint, purchaseLinkShared has no source",
				)();
			const [members, live, capabilities, reads] = await Promise.all([
				demoMembers(school),
				liveMenu(school),
				capabilitiesFor(school),
				demoReads(),
			]);
			return reads.demoPlanSummary(
				members.members,
				live,
				capabilities.stripeConnected,
			);
		},

		members: async ({ schoolId, status, cursor, limit }) =>
			membersOf(
				membersPageOf(
					await clientFor(schoolId).get(routes.members(schoolId), {
						status,
						cursor,
						limit: limit === undefined ? undefined : String(limit),
					}),
				),
			),
		people: async ({ schoolId }) => {
			if (!isDemoSchool(schoolId))
				return unavailable(
					"people",
					"no route lists people and roles (buzz-school build list group 4, ledger/people)",
				)();
			const [members, reads] = await Promise.all([
				demoMembers(schoolId),
				demoReads(),
			]);
			return reads.demoPeople(members.members);
		},
		membersSummary: async ({ schoolId }) => {
			if (!isDemoSchool(schoolId))
				return unavailable(
					"membersSummary",
					"no route (build list group 1, ledger/members-summary)",
				)();
			const [members, facts, reads] = await Promise.all([
				demoMembers(schoolId),
				clientFor(schoolId).get(routes.school(schoolId)),
				demoReads(),
			]);
			return reads.demoMembersSummary(members.members, schoolFactsOf(facts));
		},
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
		capabilities: ({ schoolId }) => capabilitiesFor(schoolId),
		financeGrants: async ({ schoolId }) =>
			financeGrantsOf(
				await clientFor(schoolId).get(routes.financeGrants(schoolId)),
			),
		memberDetail: async ({ schoolId, personId }) => {
			if (!isDemoSchool(schoolId))
				return unavailable(
					"memberDetail",
					"its bookings need the attendee's profile id and credits held (not in GET .../bookings; D12), refundable and stripeDashboardUrl need ledger/members/<person>/money (build list group 5); the money half is WorkerSource.memberMoney",
				)();
			const [members, reads] = await Promise.all([
				demoMembers(schoolId),
				demoReads(),
			]);
			const member = reads.demoMemberOf(members.members, personId);
			const money = seen(
				schoolId,
				await worker.memberMoney({ school: schoolId, key: member.key }),
			);
			return reads.demoMemberDetail(money);
		},
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
			// A demo school has no roster: its member column is the key's family id, from the Worker's own rows.
			const demo = isDemoSchool(school);
			const [answer, rows] = await Promise.all([
				worker.ledger({ school, from, to, type, drill }),
				demo ? [] : allMemberRows(school),
			]);
			const names = memberNamesOf(rows);
			const joined = (entry: WorkerLedgerEntry): LedgerEntry => {
				// The log holds a promo's id, not its code: with no code there is no "· promo <code>" to show.
				const promo =
					entry.promo === null || entry.promo.code === null
						? null
						: { id: entry.promo.id, code: entry.promo.code };
				if (entry.member === null) return { ...entry, member: null, promo };
				const found = demo
					? demoMemberOf(entry.member.key)
					: names.get(entry.member.key);
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
