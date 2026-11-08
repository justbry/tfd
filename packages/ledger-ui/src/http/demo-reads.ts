import type {
	AttentionReason,
	Member,
	MemberDetail,
	MembershipStatus,
	MembersSummary,
	Person,
} from "../data/members.ts";
import type { MenuVersionBody, PlanSummary } from "../data/plans.ts";
import { notAvailable } from "./errors.ts";
import type { SchoolFacts } from "./school-routes.ts";
import type { WorkerMemberMoney } from "./worker-source.ts";

/**
 * A demo school's reads that no buzz-school route answers (the plan counts, the people and the members summary), counted
 * from the routes' own answers the Worker serves for it (`demo-api`, worked out from the scenario's events). Each figure
 * is a count or a sum of those answers, or what the scenario shows has none (no gift codes, no admins); a figure they do
 * not hold is null, never a guess. Loaded with a demo school's first such read, never on the first load.
 */

/** A membership that still runs: what the counts and the Member audience take. */
const liveStatuses: readonly MembershipStatus[] = [
	"active",
	"past_due",
	"trialing",
];
const isLive = (member: Member): boolean =>
	liveStatuses.includes(member.status);
/** `low`: available under this share of what the period granted (`AttentionReason`). */
const lowShare = 0.2;

/** The id a person's row shows: the profile's, or the family's when the membership is the family's own (as
 * `memberNamesOf` reads it). */
const personIdOf = (member: Member): string =>
	member.profileId ?? member.familyId;

/** The Plans tab's counts per tier of the live menu, from the members list. The Monthly column and "Collected" have
 * no figure in the answers (no route sends them), so they are null and read "—". */
export function demoPlanSummary(
	members: readonly Member[],
	live: MenuVersionBody | undefined,
	stripeConnected: boolean,
): PlanSummary {
	const tiers = (live?.menu.tiers ?? []).map(({ id }) => {
		const mine = members.filter(
			(member) => member.tierId === id && isLive(member),
		);
		const active = mine.filter((member) => !member.cancelAtPeriodEnd);
		return {
			tierId: id,
			active: active.length,
			ending: mine.length - active.length,
			activeUnits: active.reduce((sum, member) => sum + member.quantity, 0),
			monthlyMinor: null,
		};
	});
	return {
		activeMembers: tiers.reduce((sum, tier) => sum + tier.active, 0),
		endingSoon: tiers.reduce((sum, tier) => sum + tier.ending, 0),
		collected: null,
		tiers,
		features: live?.menu.features ?? [],
		stripeConnected,
		// No event says the purchase link was shared.
		purchaseLinkShared: false,
	};
}

/** Out of credits, or low on them, by the balances the members list sends (the reasons' own rules). */
function attentionOf(member: Member): AttentionReason[] {
	const balances = member.balances.filter(({ granted }) => granted > 0);
	if (balances.some(({ available }) => available === 0))
		return [{ kind: "out", tone: "bad", bookingId: null }];
	if (balances.some(({ available, granted }) => available < granted * lowShare))
		return [{ kind: "low", tone: "warn", bookingId: null }];
	return [];
}

/** One row per family of the members list: each holds a plan and no role; the scenarios name no owner or admin. */
export function demoPeople(members: readonly Member[]): Person[] {
	const people = new Map<string, Person>();
	for (const member of members) {
		const id = personIdOf(member);
		if (people.has(id)) continue;
		const live = isLive(member);
		people.set(id, {
			id,
			name: member.name,
			role: "member",
			financeGrant: false,
			planHolder: true,
			memberKey: member.key,
			family: null,
			audience: live ? "member" : "public",
			audienceReason: live
				? `A live ${member.tierName} membership: Member.`
				: "No live membership: Public.",
			you: false,
			attention: attentionOf(member),
		});
	}
	return [...people.values()];
}

/** The strip over the members table: the credits the members list holds, the school's unit and currency. The
 * scenarios hold no gift codes; no source states the school's booking rules (D11), so they are null. */
export function demoMembersSummary(
	members: readonly Member[],
	facts: SchoolFacts,
): MembersSummary {
	if (facts.creditUnit === null || facts.currency === null)
		throw notAvailable(
			"membersSummary",
			"the demo school's facts name no credit unit or currency",
		);
	return {
		unit: facts.creditUnit,
		creditsOutstanding: members.reduce(
			(sum, member) =>
				sum +
				member.balances.reduce(
					(total, { available, held }) => total + available + held,
					0,
				),
			0,
		),
		currency: facts.currency,
		expiringGifts: [],
		bookingRules: null,
	};
}

/** The membership a person's row stands for. */
export function demoMemberOf(
	members: readonly Member[],
	personId: string,
): Member {
	const member = members.find((each) => personIdOf(each) === personId);
	if (!member)
		throw notAvailable("memberDetail", `${personId} has no membership`);
	return member;
}

/** The drawer: the payments and history the Worker reads from the ledger. Its upcoming bookings are none: a booking
 * whose credits are still held has no start time in the events (its credits show as held in the balance). Nothing on
 * a demo school can be refunded, and it has no Stripe dashboard. */
export const demoMemberDetail = (money: WorkerMemberMoney): MemberDetail => ({
	bookings: [],
	payments: money.payments,
	refundable: [],
	history: money.history,
	stripeDashboardUrl: null,
});
