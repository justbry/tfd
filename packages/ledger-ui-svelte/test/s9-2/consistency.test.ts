import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import type { CapabilityAction, Person } from "$contract/data/members.ts";
import * as svelteModel from "../../src/app/members/members-model.ts";
import { calendar } from "../helpers.ts";
import { fixtureReader } from "./support.ts";

/** Consistency check C for the Members tab: the Svelte model (src/app/members/members-model.ts) is a copy of the
 * Preact package's members-model.ts (which imports Preact types and so cannot be imported into the Svelte build); this
 * test runs both over every fixture school's people, memberships, drawers and capabilities, with pending changes of
 * every kind, and requires the same answers, so that the copy cannot drift. The Preact module is loaded by path, so
 * the type checker never follows it into Preact. */
const preactPath = join(
	import.meta.dir,
	"../../../ledger-ui/src/app/members-model.ts",
);
const preactModel = (await import(preactPath)) as typeof svelteModel;
const schools = ["vol", "b4u", "map", "nw", "har"];
const reader = fixtureReader();
const actions: CapabilityAction[] = [
	"refund",
	"invoice",
	"adjustCredits",
	"releaseBooking",
	"recordOutcome",
	"cancelMembership",
	"changeQuantity",
	"switchTier",
	"publishMenu",
	"createPromo",
	"audit",
	"resendReceipt",
];

describe("the Svelte Members model answers as the Preact one does", () => {
	for (const schoolId of schools)
		test(`${schoolId}: balances, standings, attention, roles, capabilities, payments and history`, async () => {
			const query = { schoolId };
			const [{ members }, people, capabilities] = await Promise.all([
				reader.members(query),
				reader.people(query),
				reader.capabilities(query),
			]);
			const both = <A>(compute: (model: typeof svelteModel) => A): [A, A] => [
				compute(svelteModel),
				compute(preactModel),
			];
			const pendingChanges = (person: Person): svelteModel.Change[] => [
				{
					kind: "ledger",
					personId: person.id,
					event: svelteModel.pendingEvent(calendar.now, {
						type: "credit.adjusted",
						text: "Goodwill",
						credits: 2,
					}),
					paymentIntentId: null,
				},
				{
					kind: "ledger",
					personId: person.id,
					event: svelteModel.pendingEvent(calendar.now, {
						type: "credit.released",
						text: "released",
						credits: 1,
					}),
					paymentIntentId: null,
				},
				{ kind: "role", personId: person.id, role: "make" },
				{ kind: "booking", bookingId: "bk_5kd" },
			];
			for (const person of people) {
				const changes = pendingChanges(person);
				const member =
					members.find(({ profileId }) => profileId === person.id) ?? null;
				const detail = person.planHolder
					? await reader.memberDetail({ schoolId, personId: person.id })
					: null;
				for (const set of [[], changes]) {
					const [mine, theirs] = both((model) => model.applyRoles(people, set));
					expect(mine).toEqual(theirs);
					if (member) {
						const balance = member.balances[0];
						if (balance) {
							const [projectedMine, projectedTheirs] = both((model) =>
								model.project(balance, person.id, set),
							);
							expect(projectedMine).toEqual(projectedTheirs);
							expect(
								both((model) =>
									model.barOf(balance, model.project(balance, person.id, set)),
								),
							).toSatisfy(
								([first, second]) =>
									JSON.stringify(first) === JSON.stringify(second),
							);
						}
						const [standingMine, standingTheirs] = both((model) =>
							model.standingOf(member, set),
						);
						expect(standingMine).toEqual(standingTheirs);
						const [attentionMine, attentionTheirs] = both((model) =>
							model.attentionOf(person, standingMine.canceled, set),
						);
						expect(attentionMine).toEqual(attentionTheirs);
					}
					if (detail) {
						const [paymentsMine, paymentsTheirs] = both((model) =>
							model.paymentsOf(detail, person.id, set, calendar.today),
						);
						expect(paymentsMine).toEqual(paymentsTheirs);
						const [historyMine, historyTheirs] = both((model) =>
							model.historyOf(detail, person.id, set),
						);
						expect(historyMine).toEqual(historyTheirs);
						for (const event of detail.history) {
							const [labelMine, labelTheirs] = both((model) =>
								model.eventLabel(event, { other: "sessions" }),
							);
							expect(labelMine).toBe(labelTheirs);
						}
					}
				}
				for (const change of ["make", "remove", "grant", "revoke"] as const) {
					expect(
						both((model) =>
							model.roleGuard(capabilities, people, person, change),
						),
					).toSatisfy(([first, second]) => first === second);
					expect(
						both((model) => model.roleTexts(change, person, "School")),
					).toSatisfy(
						([first, second]) =>
							JSON.stringify(first) === JSON.stringify(second),
					);
				}
			}
			for (const action of actions)
				for (const place of ["menu", "drawer"] as const) {
					const [mine, theirs] = both((model) =>
						model.capabilityReason(capabilities, action, place),
					);
					expect({ action, place, text: mine }).toEqual({
						action,
						place,
						text: theirs,
					});
				}
		});
	test("the formats", () => {
		const school = "America/Denver";
		for (const seconds of [1_793_000_000, 1_796_000_000, 0]) {
			expect(svelteModel.formatDay(seconds, school)).toBe(
				preactModel.formatDay(seconds, school),
			);
			expect(svelteModel.formatPeriodEnd(seconds, school)).toBe(
				preactModel.formatPeriodEnd(seconds, school),
			);
		}
		expect(svelteModel.formatPeriodEnd(null, school)).toBe("—");
		for (const cents of [-5000, 0, 12345])
			expect(svelteModel.amountText(cents)).toBe(preactModel.amountText(cents));
		expect(svelteModel.formatWallTime("2026-11-04T17:00")).toBe(
			preactModel.formatWallTime("2026-11-04T17:00"),
		);
		expect(svelteModel.formatPaymentDay("2026-11-01")).toBe(
			preactModel.formatPaymentDay("2026-11-01"),
		);
	});
});

/** The Bookings period model is a copy of the Preact package's bookings-period.ts (it would otherwise drag the weekday
 * helpers of period.ts into the first page load); both answer alike over every period the tab can ask for. */
describe("the Svelte Bookings period model answers as the Preact one does", async () => {
	const preactPeriod = (await import(
		join(import.meta.dir, "../../../ledger-ui/src/app/bookings-period.ts")
	)) as typeof import("../../src/app/bookings/period-model.ts");
	const mine = await import("../../src/app/bookings/period-model.ts");
	const days = [
		"2026-11-05",
		"2026-11-01",
		"2026-11-02",
		"2026-11-08",
		"2026-12-31",
		"2027-01-01",
	];
	test("read, days, label and route", () => {
		for (const today of days)
			for (const range of ["day", "week"] as const)
				for (const offset of [-3, -2, -1, 0, 1, 2, 5]) {
					const period = { range, offset };
					expect(mine.bookingsDays(period, today)).toEqual(
						preactPeriod.bookingsDays(period, today),
					);
					const { from } = mine.bookingsDays(period, today);
					expect(mine.bookingsLabel(period, from)).toBe(
						preactPeriod.bookingsLabel(period, from),
					);
				}
		for (const query of [
			"",
			"range=day",
			"range=week&offset=2",
			"range=nope&offset=x",
			"offset=1.5",
			"offset=-1",
		]) {
			const parameters = new URLSearchParams(query);
			expect(mine.readBookingsPeriod(parameters)).toEqual(
				preactPeriod.readBookingsPeriod(parameters),
			);
		}
		expect(mine.bookingsChoices).toEqual(preactPeriod.bookingsChoices);
	});
});
