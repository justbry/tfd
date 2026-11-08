import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Member } from "../../src/data/members.ts";
import {
	demoMembersSummary,
	demoPeople,
	demoPlanSummary,
} from "../../src/http/demo-reads.ts";
import {
	bookingOf,
	bookingsPageOf,
	capabilitiesOf,
	financeGrantsOf,
	liveVersionOf,
	memberNamesOf,
	membersOf,
	membersPageOf,
	menuVersionBodyOf,
	menuVersionsOf,
	schoolFactsOf,
} from "../../src/http/school-routes.ts";

/**
 * The demo schools' answers to the buzz-school reads (S8-contract section 11 "Demo schools"), as the ledger Worker
 * works them out from a preset's events (`packages/ledger-worker/src/demo/route-answers.ts`), read by the same parse
 * functions as buzz-school's own answers: each one passes, and the demo reads counted from them agree with them. The
 * Worker's modules are loaded by a computed path, as `test/worker-e2e/worker-harness.ts` loads its harness.
 */

const workerSource = join(import.meta.dir, "../../../ledger-worker/src");
type Answers = {
	answers: Map<string, unknown>;
	notAvailable: Map<string, string>;
	lastBookingOn: string | null;
};
type WorkerModules = {
	answersOf(preset: string): Answers;
};
const modules: WorkerModules | string = await (async () => {
	if (!existsSync(join(workerSource, "demo/route-answers.ts")))
		return "skipped: packages/ledger-worker/src/demo/route-answers.ts does not exist";
	const [routeAnswers, demoSeed, seed] = await Promise.all([
		import(join(workerSource, "demo/route-answers.ts")),
		import(join(workerSource, "testing/demo-seed.ts")),
		import(join(workerSource, "testing/seed.ts")),
	]);
	return {
		answersOf: (preset: string) => {
			const events = seed.presetEvents(preset);
			return routeAnswers.demoRouteAnswers(
				demoSeed.demoSchoolIdOf(preset),
				events,
				demoSeed.demoFactsOf(preset, events),
			) as Answers;
		},
	};
})();
if (typeof modules === "string") process.stdout.write(`${modules}\n`);

/** As the Worker sends it: the stored JSON. */
const wire = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

const presets = ["monthly-members", "annual-prepay", "non-usd", "free-only"];

describe.skipIf(typeof modules === "string")(
	"demo answers through the adapter's parsers",
	() => {
		const answersOf = (preset: string) =>
			(modules as WorkerModules).answersOf(preset);

		test.each(presets)(
			"%s: school facts, capabilities, finance grants",
			(preset) => {
				const { answers } = answersOf(preset);
				const facts = schoolFactsOf(wire(answers.get("ledger/school")));
				expect(facts.school).toBe(`demo-${preset}`);
				expect(facts.name).toStartWith("Demo · ");
				expect(facts.timeZone).toBeString();
				expect(facts.creditUnit).not.toBeNull();
				const capabilities = capabilitiesOf(
					wire(answers.get("ledger/capabilities")),
				);
				expect(capabilities.role).toBe("owner");
				expect(
					Object.values(capabilities.actions).every(
						(capability) => !capability.allowed && capability.reason === "demo",
					),
				).toBe(true);
				expect(financeGrantsOf(wire(answers.get("finance-grants")))).toEqual(
					[],
				);
			},
		);

		test.each(presets)(
			"%s: menu versions and the live version's body",
			(preset) => {
				const { answers } = answersOf(preset);
				const versions = menuVersionsOf(
					wire(answers.get("billing/menu/versions")),
				);
				const live = liveVersionOf(versions);
				expect(live?.version).toBe(1);
				const body = menuVersionBodyOf(
					wire(answers.get(`billing/menu/versions/${live?.version}`)),
				);
				expect(body.menu.tiers.length).toBeGreaterThan(0);
				for (const key of body.stripe.products) expect(key).toMatch(/^[ta]:/);
			},
		);

		test.each(presets)(
			"%s: the members list, and the counts the demo reads take from it",
			(preset) => {
				const { answers } = answersOf(preset);
				const page = membersPageOf(wire(answers.get("billing/members-list")));
				expect(page.nextCursor).toBeNull();
				const { members } = membersOf(page);
				expect(members.length).toBeGreaterThan(0);
				const live = members.filter(({ status }) => status !== "canceled");
				const body = menuVersionBodyOf(
					wire(answers.get("billing/menu/versions/1")),
				);
				const summary = demoPlanSummary(members, body, true);
				expect(summary.activeMembers).toBe(live.length);
				expect(summary.endingSoon).toBe(0);
				expect(summary.collected).toBeNull();
				expect(summary.tiers.map(({ tierId }) => tierId)).toEqual(
					body.menu.tiers.map(({ id }) => id),
				);
				for (const tier of summary.tiers) expect(tier.monthlyMinor).toBeNull();
				// The ledger's member join names each key as the people rows do.
				const names = memberNamesOf(page.rows);
				const people = demoPeople(members);
				expect(people.map(({ id, name }) => ({ id, name }))).toEqual([
					...names.values(),
				]);
				expect(
					people.every(
						({ planHolder, role }) => planHolder && role === "member",
					),
				).toBe(true);
				const facts = schoolFactsOf(wire(answers.get("ledger/school")));
				const outstanding = members.reduce(
					(sum: number, member: Member) =>
						sum +
						member.balances.reduce(
							(total, { available, held }) => total + available + held,
							0,
						),
					0,
				);
				expect(demoMembersSummary(members, facts)).toEqual({
					unit: facts.creditUnit as { one: string; other: string },
					creditsOutstanding: outstanding,
					currency: facts.currency as string,
					expiringGifts: [],
					bookingRules: null,
				});
			},
		);

		test.each(presets)(
			"%s: every booking parses, in the school's zone",
			(preset) => {
				const { answers } = answersOf(preset);
				const page = bookingsPageOf(wire(answers.get("bookings")));
				expect(page.rows.length).toBeGreaterThan(0);
				const bookings = page.rows.map((row, index) =>
					bookingOf(row, page.timeZone, index),
				);
				for (const booking of bookings) {
					expect(booking?.state).toBe("confirmed");
					expect(booking?.attendance).toBeNull();
					expect(booking?.cutoffMinutes).toBeNull();
					expect(booking?.attendee?.key).toStartWith("family:");
				}
			},
		);

		test("child-only: its menu parses; its members list and bookings are not available", () => {
			const { answers, notAvailable } = answersOf("child-only");
			expect(
				menuVersionBodyOf(wire(answers.get("billing/menu/versions/1"))).version,
			).toBe(1);
			expect([...notAvailable.keys()].sort()).toEqual([
				"billing/members-list",
				"bookings",
			]);
		});
	},
);
