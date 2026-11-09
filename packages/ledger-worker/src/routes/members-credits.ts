/**
 * `GET /v1/schools/:school/members-credits`: what each member holds, from the credit events, for a school whose log has
 * any (plan 2026-11-08 credits-engine, T13). The numbers are `membersOf`'s (the summary reader the views job uses), which
 * replays the log under the catalog of each event's menu version, so members who bought on different versions count under
 * their own. A school whose log holds no credit event answers `{ hasCreditEvents: false }` and the UI keeps what it showed
 * before: no figure is made up. No name or email is in the answer, only holder keys.
 */
import type { AtmEvent } from "tfd";
import { type MemberSummary, membersOf } from "tfd/worker";
import type { SchoolSnapshot } from "../data/snapshot.js";
import { ApiError } from "../http.js";
import type { CreditUnit } from "../wire.js";

const CREDIT_EVENT = /^credit\./;

export type MembersCreditsWire =
	| { hasCreditEvents: false }
	| {
			hasCreditEvents: true;
			unit: CreditUnit | null;
			/** Available plus held, over every member and feature. */
			creditsOutstanding: number;
			members: MemberSummary[];
	  };

export const hasCreditEvents = (events: readonly AtmEvent[]): boolean =>
	events.some((event) => CREDIT_EVENT.test(event.event_type));

/** The members of a log as of `asOf`, kept per events array: the isolate holds one array per generation. */
const worked = new WeakMap<readonly AtmEvent[], MemberSummary[]>();

const membersAt = (
	events: readonly AtmEvent[],
	asOf: string,
): MemberSummary[] => {
	const kept = worked.get(events);
	if (kept !== undefined) return kept;
	const result = membersOf(events, new Date(asOf));
	// the views job refuses the same log, so a school in this state has no views and never reaches here
	if (!result.ok)
		throw new ApiError(
			"views_unavailable",
			`The school's log cannot be replayed (${result.error.kind}).`,
		);
	const members = Object.values(result.members);
	worked.set(events, members);
	return members;
};

export const creditsOutstandingOf = (
	members: readonly MemberSummary[],
): number =>
	members.reduce(
		(total, member) =>
			total +
			Object.values(member.features).reduce(
				(sum, feature) => sum + feature.available + feature.held,
				0,
			),
		0,
	);

export const membersCreditsRoute = async (
	snapshot: SchoolSnapshot,
): Promise<MembersCreditsWire> => {
	const events = await snapshot.events();
	if (!hasCreditEvents(events)) return { hasCreditEvents: false };
	const members = membersAt(events, snapshot.asOf).filter(
		(member) => Object.keys(member.features).length > 0,
	);
	return {
		hasCreditEvents: true,
		unit: (await snapshot.menu())?.unit ?? null,
		creditsOutstanding: creditsOutstandingOf(members),
		members,
	};
};
