import { describe, expect, test } from "bun:test";
import { AdapterError } from "../../src/http/errors.ts";
import {
	adminPubkey,
	apiBase,
	bookingId,
	familyId,
	membershipId,
	profileId,
	schoolId,
} from "./helpers.ts";
import {
	bookingRow,
	bookingStart,
	bookingsAnswer,
	capabilitiesAnswer,
	financeGrantsAnswer,
	memberRow,
	membersAnswer,
	refusal,
	schoolFactsAnswer,
	versionBodyAnswer,
	versionsAnswer,
} from "./recorded.ts";
import { adapters, apiCalls } from "./setup.ts";

const school = `${apiBase}/school-admin/schools/${schoolId}`;

const rejection = async (promise: Promise<unknown>): Promise<AdapterError> => {
	try {
		await promise;
	} catch (error) {
		if (error instanceof AdapterError) return error;
		throw error;
	}
	throw new Error("expected a rejection");
};

describe("bookings: GET .../bookings", () => {
	test("today's answer has no attendance, so the read is a schema mismatch, never null attendance", async () => {
		const { reader, http } = adapters();
		http.on("GET", /\/bookings$/, {
			status: 200,
			body: bookingsAnswer([bookingRow()]),
		});
		const error = await rejection(
			reader.bookings({
				school: schoolId,
				from: "2026-11-01",
				to: "2026-11-30",
			}),
		);
		expect(error.kind).toBe("schema_mismatch");
		expect(error.message).toContain("attendance");
		expect(apiCalls(http).map(({ url, method }) => `${method} ${url}`)).toEqual(
			[`GET ${school}/bookings?from=2026-11-01&to=2026-11-30`],
		);
	});

	test("with attendance joined (the proposed field), every page is read and mapped exactly", async () => {
		const { reader, http } = adapters();
		http.on(
			"GET",
			/\/bookings$/,
			{
				status: 200,
				body: bookingsAnswer(
					[
						bookingRow({ attendance: null }),
						bookingRow({ id: "c", state: "cancelled", attendance: null }),
					],
					"cursor-2",
				),
			},
			{
				status: 200,
				body: bookingsAnswer([
					bookingRow({
						id: "g",
						attendee: null,
						guest: true,
						state: "requested",
						seriesId: "s1",
						attendance: "no_show",
					}),
				]),
			},
		);
		const list = await reader.bookings({
			school: schoolId,
			from: "2026-11-01",
			to: "2026-11-30",
		});
		expect(list).toEqual({
			bookings: [
				{
					id: bookingId,
					eventId: "4f5a6b7c-8d9e-4f0a-9b1c-2d3e4f5a6b7c",
					service: "Massage 90",
					// 17:00Z is 10:00 in America/Denver in November (UTC-7).
					startsAt: "2026-11-06T10:00",
					endsAt: "2026-11-06T11:30",
					hosts: [{ id: "5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d", name: "Ana" }],
					attendee: { key: `family:${familyId}`, name: "Sam" },
					guest: false,
					state: "confirmed",
					cutoffMinutes: 720,
					seriesId: null,
					attendance: null,
				},
				{
					id: "g",
					eventId: "4f5a6b7c-8d9e-4f0a-9b1c-2d3e4f5a6b7c",
					service: "Massage 90",
					startsAt: "2026-11-06T10:00",
					endsAt: "2026-11-06T11:30",
					hosts: [{ id: "5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d", name: "Ana" }],
					attendee: null,
					guest: true,
					state: "requested",
					cutoffMinutes: 720,
					seriesId: "s1",
					attendance: "no_show",
				},
			],
		});
		// No billing and no series label are invented.
		for (const booking of list.bookings) {
			expect("billing" in booking).toBe(false);
			expect("seriesLabel" in booking).toBe(false);
		}
		expect(apiCalls(http).map(({ url }) => url)).toEqual([
			`${school}/bookings?from=2026-11-01&to=2026-11-30`,
			`${school}/bookings?from=2026-11-01&to=2026-11-30&cursor=cursor-2`,
		]);
		expect(bookingStart).toBe(Date.UTC(2026, 10, 6, 17) / 1000);
	});
});

describe("plans: GET .../billing/menu/versions[/<n>]", () => {
	test("the versions list and a body map as they are, Stripe keys included", async () => {
		const { reader, http } = adapters();
		http.on("GET", /\/versions$/, { status: 200, body: versionsAnswer });
		http.on("GET", /\/versions\/2$/, { status: 200, body: versionBodyAnswer });
		expect(await reader.menuVersions(schoolId)).toEqual(versionsAnswer);
		expect(await reader.menuVersion(schoolId, 2)).toEqual(
			versionBodyAnswer as never,
		);
	});

	test("a version the school does not have is undefined; a 503 is not", async () => {
		const { reader, http } = adapters();
		http.on("GET", /\/versions\/9$/, {
			status: 404,
			body: refusal("not_found"),
		});
		expect(await reader.menuVersion(schoolId, 9)).toBeUndefined();
		http.always("GET", /\/versions\/8$/, {
			status: 503,
			body: refusal("school_api_unavailable"),
		});
		expect((await rejection(reader.menuVersion(schoolId, 8))).kind).toBe(
			"unavailable",
		);
	});

	test("invoice items and switch tiers come from the live (newest published) version", async () => {
		const { reader, http } = adapters();
		http.always("GET", /\/versions$/, { status: 200, body: versionsAnswer });
		http.always("GET", /\/versions\/2$/, {
			status: 200,
			body: versionBodyAnswer,
		});
		expect(await reader.invoiceItems({ schoolId })).toEqual([
			{
				addonId: "pack8",
				label: "Top-up pack · 8 sessions · $40.00",
				priceCents: 4000,
			},
		]);
		// Annual has no monthly price and Board is not on sale: neither is offered, and no price is divided.
		expect(await reader.switchTiers({ schoolId })).toEqual([
			{
				id: "sparkle",
				name: "Sparkle",
				monthlyCents: 3250,
				quantities: [1, 2, 4],
			},
		]);
		expect(
			apiCalls(http).every(({ url }) => !url.endsWith("/versions/3")),
		).toBe(true);
	});

	test("nothing published offers nothing", async () => {
		const { reader, http } = adapters();
		http.always("GET", /\/versions$/, {
			status: 200,
			body: { versions: [{ version: 1, publishedAt: null, savedAt: 1 }] },
		});
		expect(await reader.invoiceItems({ schoolId })).toEqual([]);
	});

	test("planSummary is not available and asks nothing", async () => {
		const { reader, http } = adapters();
		expect((await rejection(reader.planSummary(schoolId))).kind).toBe(
			"not_available",
		);
		expect(apiCalls(http)).toEqual([]);
	});
});

describe("members: GET .../billing/members-list", () => {
	test("today's answer lacks the membership id and granted: a schema mismatch, never a made-up bar", async () => {
		const { reader, http } = adapters();
		http.on("GET", /members-list$/, {
			status: 200,
			body: membersAnswer([memberRow()]),
		});
		const error = await rejection(
			reader.members({ schoolId, status: "active", limit: 50 }),
		);
		expect(error.kind).toBe("schema_mismatch");
		expect(apiCalls(http)[0]?.url).toBe(
			`${school}/billing/members-list?status=active&limit=50`,
		);
	});

	test("with the proposed membershipId and granted, the page maps exactly and rolledOver stays absent", async () => {
		const { reader, http } = adapters();
		const balance = { ...memberRow().balances[0], granted: 8 };
		http.on("GET", /members-list$/, {
			status: 200,
			body: membersAnswer(
				[memberRow({ membershipId, balances: [balance] })],
				"next",
			),
		});
		const page = await reader.members({ schoolId });
		expect(page).toEqual({
			members: [
				{
					key: `family:${familyId}`,
					familyId,
					profileId,
					name: "Sam",
					tierId: "sparkle",
					tierName: "Sparkle",
					quantity: 2,
					interval: "month",
					status: "active",
					currentPeriodEnd: 1_794_500_000,
					cancelAtPeriodEnd: false,
					menuVersion: 2,
					balances: [
						{
							featureId: "sessions",
							featureName: "Sessions",
							unit: { one: "session", other: "sessions" },
							available: 5,
							held: 0,
							expiresAt: null,
							granted: 8,
						},
					],
					membershipId,
				},
			],
			nextCursor: "next",
		});
		expect("rolledOver" in (page.members[0]?.balances[0] ?? {})).toBe(false);
	});

	test("a membership with no period end reads null, not 0; a missing one is a mismatch", async () => {
		const { reader, http } = adapters();
		const balance = { ...memberRow().balances[0], granted: 8 };
		http.on("GET", /members-list$/, {
			status: 200,
			body: membersAnswer([
				memberRow({
					membershipId,
					balances: [balance],
					currentPeriodEnd: null,
				}),
			]),
		});
		expect(
			(await reader.members({ schoolId })).members[0]?.currentPeriodEnd,
		).toBeNull();
		const { currentPeriodEnd: _dropped, ...withoutPeriodEnd } = memberRow({
			membershipId,
			balances: [balance],
		});
		const missing = adapters();
		missing.http.on("GET", /members-list$/, {
			status: 200,
			body: membersAnswer([withoutPeriodEnd]),
		});
		expect(
			(await rejection(missing.reader.members({ schoolId }))).message,
		).toContain("currentPeriodEnd");
	});
});

describe("capabilities and finance grants", () => {
	test("capabilities map buzz-school's reasons onto the contract's", async () => {
		const { reader, http } = adapters();
		http.on("GET", /ledger\/capabilities$/, {
			status: 200,
			body: capabilitiesAnswer,
		});
		expect(await reader.capabilities({ schoolId })).toEqual({
			role: "admin",
			stripeConnected: true,
			actions: {
				refund: { allowed: true },
				invoice: { allowed: false, reason: "owner_only" },
				adjustCredits: { allowed: false, reason: "owner_only" },
				releaseBooking: { allowed: true },
				recordOutcome: { allowed: true },
				cancelMembership: { allowed: false, reason: "not_built" },
				changeQuantity: { allowed: false, reason: "not_built" },
				switchTier: { allowed: false, reason: "not_built" },
				publishMenu: { allowed: true },
				createPromo: { allowed: false, reason: "not_built" },
				audit: { allowed: false, reason: "not_built" },
				resendReceipt: { allowed: false, reason: "not_built" },
			},
		});
		expect(apiCalls(http)[0]?.url).toBe(`${school}/ledger/capabilities`);
	});

	test("switched-off features answer not_built; an unknown reason is a mismatch", async () => {
		const { reader, http } = adapters();
		const actions = {
			...capabilitiesAnswer.actions,
			refund: { allowed: false, reason: "stripe_not_connected" },
		};
		http.on("GET", /ledger\/capabilities$/, {
			status: 200,
			body: { ...capabilitiesAnswer, actions },
		});
		expect((await reader.capabilities({ schoolId })).actions.refund).toEqual({
			allowed: false,
			reason: "not_built",
		});
		http.on("GET", /ledger\/capabilities$/, {
			status: 200,
			body: {
				...capabilitiesAnswer,
				actions: {
					...actions,
					audit: { allowed: false, reason: "new_reason" },
				},
			},
		});
		expect((await rejection(reader.capabilities({ schoolId }))).kind).toBe(
			"schema_mismatch",
		);
	});

	test("finance grants: the route does not say who granted, so grantedBy is null", async () => {
		const { reader, http } = adapters();
		http.on("GET", /finance-grants$/, {
			status: 200,
			body: financeGrantsAnswer,
		});
		expect(await reader.financeGrants({ schoolId })).toEqual([
			{
				subject: adminPubkey,
				grant: "finance",
				grantedBy: null,
				grantedAt: 1_792_500_000,
				revokedAt: null,
			},
		]);
	});
});

describe("schools: the token's schools joined with GET .../ledger/school", () => {
	test("reads each school, then answers not available: the badges have no source and the Worker is not connected", async () => {
		const { reader, http } = adapters();
		http.always("GET", /ledger\/school$/, {
			status: 200,
			body: schoolFactsAnswer,
		});
		const error = await rejection(reader.schools());
		expect(error.kind).toBe("not_connected");
		expect(apiCalls(http).map(({ url }) => url)).toEqual([
			`${school}/ledger/school`,
		]);
	});

	test("a person who administers no school has no schools; a 503 rejects, never an empty list", async () => {
		const nowhere = adapters({
			token: { status: 404, body: refusal("not_found") },
		});
		expect(await nowhere.reader.schools()).toEqual([]);
		expect(apiCalls(nowhere.http)).toEqual([]);
		const down = adapters({
			token: { status: 503, body: refusal("school_api_unavailable") },
		});
		expect((await rejection(down.reader.schools())).kind).toBe("unavailable");
	});
});

describe("calls with no source answer not available, ask nothing, and hold no 0", () => {
	const calls: Array<
		[
			string,
			(reader: ReturnType<typeof adapters>["reader"]) => Promise<unknown>,
		]
	> = [
		["people", (reader) => reader.people({ schoolId })],
		["membersSummary", (reader) => reader.membersSummary({ schoolId })],
		[
			"memberDetail",
			(reader) => reader.memberDetail({ schoolId, personId: profileId }),
		],
		[
			"auditMember",
			(reader) => reader.auditMember({ schoolId, personId: profileId }),
		],
		[
			"donors",
			(reader) =>
				reader.donors({ school: schoolId, audience: "owner", year: 2026 }),
		],
		[
			"promos",
			(reader) => reader.promos({ school: schoolId, audience: "owner" }),
		],
		[
			"memberPortal",
			(reader) => reader.memberPortal({ school: schoolId, profileId }),
		],
		["settings", (reader) => reader.settings(schoolId)],
		["planSummary", (reader) => reader.planSummary(schoolId)],
	];
	for (const [name, call] of calls)
		test(name, async () => {
			const { reader, http } = adapters();
			const error = await rejection(call(reader));
			expect(error.kind).toBe("not_available");
			expect(http.calls).toEqual([]);
		});

	test("no presets and no school rules: empty and null, never invented, and nothing is asked", async () => {
		const { reader, http } = adapters();
		expect(await reader.dashboardOptions()).toEqual({ presets: [] });
		expect(await reader.schoolRules(schoolId)).toEqual({
			rules: null,
			unit: null,
		});
		expect(http.calls).toEqual([]);
	});

	test("the Worker's reads reject not_connected in part 1", async () => {
		const { reader } = adapters();
		const worker = [
			reader.kpiDocument({
				school: schoolId,
				preset: "",
				audience: "owner",
				pinLocked: false,
			}),
			reader.incomeStatement({
				school: schoolId,
				from: "2026-10-01",
				to: "2026-10-31",
				compare: false,
			}),
			reader.audienceReport({
				school: schoolId,
				audience: "public",
				from: "2026-01-01",
				to: "2026-12-31",
			}),
			reader.membersIncome({ schoolId, from: "2026-10-01", to: "2026-10-31" }),
			reader.disclosure(schoolId),
		];
		for (const read of worker)
			expect((await rejection(read)).kind).toBe("not_connected");
	});
});
