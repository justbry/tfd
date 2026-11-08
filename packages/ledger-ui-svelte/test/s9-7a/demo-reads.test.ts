import { describe, expect, test } from "bun:test";
import {
	demoMembersSummary,
	demoPeople,
	demoPlanSummary,
} from "$contract/http/demo-reads.ts";
import { memoryStorage } from "$contract/http/pending.ts";
import { menuVersionBodyOf } from "$contract/http/school-routes.ts";
import {
	membersAnswer,
	memberRow as recordedMemberRow,
	refusal,
	schoolFactsAnswer,
	versionBodyAnswer,
} from "../../../ledger-ui/test/s8e/recorded.ts";
import { createHttpServices } from "../../src/effect/http-layer.ts";
import { apiBase, demoId, workerBase } from "./support.ts";

/** A demo school's reads that no buzz-school route answers (S8-contract section 11 "Demo schools"), through the HTTP
 * layer the Svelte entry builds: the Worker's `demo-api` answers are parsed as buzz-school's routes' own, and the
 * people, the members summary and the plan counts are counted from them (`$contract/http/demo-reads.ts`). A figure
 * the answers do not hold is null, never a guess. */
const fresh = (rows: unknown[]) => {
	const asked: string[] = [];
	const services = createHttpServices({
		fetch: async (url, init = {}) => {
			asked.push(url);
			const bearer = (init.headers as Record<string, string> | undefined)
				?.authorization;
			expect(bearer).toBeUndefined();
			const path = url.replace(`${workerBase}/schools/${demoId}/demo-api/`, "");
			const body = path.startsWith("billing/members-list")
				? membersAnswer(rows)
				: path === "ledger/school"
					? {
							...schoolFactsAnswer,
							school: demoId,
							name: "Demo · Monthly members",
						}
					: null;
			if (body === null)
				return new Response(JSON.stringify(refusal("not_found")), {
					status: 404,
				});
			return new Response(
				JSON.stringify({ asOf: null, lagMinutes: null, data: body }),
				{ status: 200 },
			);
		},
		apiBase,
		workerBase,
		storage: memoryStorage(),
		newKey: () => "key-1",
		files: { save: () => Promise.resolve() },
	});
	return { services, asked };
};
/** The recorded row with the membership id the route sends and the parser requires. */
const balance = (available: number) => ({
	featureId: "sessions",
	featureName: "Sessions",
	unit: { one: "session", other: "sessions" },
	available,
	held: 0,
	expiresAt: null,
	granted: 8,
});
const memberRow = (overrides: Record<string, unknown>) =>
	recordedMemberRow({
		membershipId: `ms-${String(overrides.familyId)}`,
		balances: [balance(5)],
		...overrides,
	});
const rows = [
	memberRow({ key: "family:f1", familyId: "f1", profileId: "p1", name: "Ada" }),
	memberRow({
		key: "family:f2",
		familyId: "f2",
		profileId: null,
		name: "Bo",
		status: "canceled",
		balances: [],
	}),
	memberRow({
		key: "family:f3",
		familyId: "f3",
		profileId: "p3",
		name: "Cy",
		cancelAtPeriodEnd: true,
		balances: [balance(0)],
	}),
];

describe("the demo reads through the HTTP layer, with no bearer", () => {
	test("people: one row per family, each a member, with attention from the balances", async () => {
		const { services, asked } = fresh(rows);
		const people = await services.reader.people({ schoolId: demoId });
		expect(
			people.map(({ id, role, audience }) => [id, role, audience]),
		).toEqual([
			["p1", "member", "member"],
			["f2", "member", "public"],
			["p3", "member", "member"],
		]);
		expect(people.every(({ financeGrant, you }) => !financeGrant && !you)).toBe(
			true,
		);
		expect(people[2]?.attention).toEqual([
			{ kind: "out", tone: "bad", bookingId: null },
		]);
		expect(
			asked.every((url) =>
				url.startsWith(`${workerBase}/schools/${demoId}/demo-api/`),
			),
		).toBe(true);
	});

	test("members summary: the credits the list holds, the school's unit and currency, no gift codes or rules", async () => {
		const { services } = fresh(rows);
		const summary = await services.reader.membersSummary({ schoolId: demoId });
		expect(summary.unit).toEqual({ one: "session", other: "sessions" });
		expect(summary.currency).toBe("usd");
		expect(summary.creditsOutstanding).toBe(5);
		expect(summary.expiringGifts).toEqual([]);
		expect(summary.bookingRules).toBeNull();
	});

	test("a buzz-school route no demo answer covers is not reached: a real school's people stay unavailable", async () => {
		const { services } = fresh(rows);
		await expect(
			services.reader.people({
				schoolId: "6f1c2a7e-3b4d-4e5f-8a9b-0c1d2e3f4a5b",
			}),
		).rejects.toMatchObject({ kind: "not_available" });
	});
});

describe("the counts", () => {
	test("plan summary: live memberships per tier, ending ones apart, Monthly and Collected null", async () => {
		const { services } = fresh(rows);
		const { members } = await services.reader.members({ schoolId: demoId });
		const live = menuVersionBodyOf(versionBodyAnswer);
		const summary = demoPlanSummary(members, live, true);
		// Ada is live; Bo is canceled (not counted); Cy is live but ends at the period's end.
		expect(summary.tiers).toEqual([
			{
				tierId: "sparkle",
				active: 1,
				ending: 1,
				activeUnits: 2,
				monthlyMinor: null,
			},
			...live.menu.tiers
				.filter(({ id }) => id !== "sparkle")
				.map(({ id }) => ({
					tierId: id,
					active: 0,
					ending: 0,
					activeUnits: 0,
					monthlyMinor: null,
				})),
		]);
		expect(summary.activeMembers).toBe(1);
		expect(summary.endingSoon).toBe(1);
		expect(summary.collected).toBeNull();
		expect(summary.purchaseLinkShared).toBe(false);
		expect(summary.stripeConnected).toBe(true);
		expect(summary.features).toEqual(live.menu.features);
	});

	test("members summary refuses a school whose facts name no unit or currency", () => {
		expect(() =>
			demoMembersSummary([], {
				school: demoId,
				name: "x",
				timeZone: "America/Denver",
				currency: null,
				creditUnit: null,
			}),
		).toThrow();
		expect(demoPeople([])).toEqual([]);
	});
});

test("the token is never asked for a demo school's reads", async () => {
	const { services, asked } = fresh(rows);
	await services.reader.people({ schoolId: demoId });
	expect(asked.some((url) => url.endsWith("/school-admin/ledger-token"))).toBe(
		false,
	);
});
