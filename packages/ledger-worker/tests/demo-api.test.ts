/**
 * A demo school's answers to the buzz-school reads (`src/demo/route-answers.ts`), worked out from its preset's events
 * and served from R2 as `GET /v1/schools/:id/demo-api/<route>` (`src/routes/demo-api.ts`) to anyone, while every other
 * school gets 404. The UI's parsers read these answers in `packages/ledger-ui/test/s8/demo-answers.test.ts`.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { AtmEvent } from "tfd";
import { R2BindingStore } from "tfd/worker";
import { demoApiKey, writeDemoApi } from "../src/demo/demo-api-store.js";
import {
	DEMO_API_ROUTES,
	DEMO_REFUSAL,
	demoRouteAnswers,
	menuVersionRoute,
} from "../src/demo/route-answers.js";
import { readDemoFacts } from "../src/demo.js";
import { demoFactsOf, demoSchoolIdOf } from "../src/testing/demo-seed.js";
import {
	type LedgerHarness,
	startLedgerWorker,
} from "../src/testing/harness.js";
import { presetEvents } from "../src/testing/seed.js";
import { runViewsJob } from "../src/views-job.js";
import { call } from "./support.js";

type Balance = {
	featureId: string;
	available: number;
	held: number;
	granted: number;
	rolledOver?: number;
	expiresAt: number | null;
};
type MemberRow = {
	key: string;
	familyId: string;
	profileId: string | null;
	name: string;
	tierId: string;
	interval: string;
	quantity: number;
	status: string;
	currentPeriodEnd: number | null;
	cancelAtPeriodEnd: boolean;
	menuVersion: number;
	membershipId: string;
	balances: Balance[];
};
type BookingRow = {
	id: string;
	startsAt: number;
	endsAt: number;
	attendee: { key: string; name: string };
	state: string;
	attendance: null;
	cutoffMinutes: null;
};

const answersOf = (
	preset: string,
	events: readonly AtmEvent[] = presetEvents(preset),
) =>
	demoRouteAnswers(demoSchoolIdOf(preset), events, demoFactsOf(preset, events));

/** A family's balance per feature, summed from the events' own postings. */
const postedBalance = (
	events: readonly AtmEvent[],
	key: string,
	feature: string,
	side: "avail" | "held",
): number =>
	events
		.flatMap((event) => event.postings)
		.filter(({ account }) => account === `credits:${side}:${key}:${feature}`)
		.reduce((sum, posting) => sum + Number(posting.amount), 0);

describe("the derivation", () => {
	const events = presetEvents("monthly-members");
	const { answers, notAvailable, lastBookingOn } = answersOf(
		"monthly-members",
		events,
	);
	const members = (
		answers.get("billing/members-list") as { members: MemberRow[] }
	).members;

	test("answers every route, and the one menu version the preset publishes", () => {
		for (const route of DEMO_API_ROUTES) expect(answers.has(route)).toBe(true);
		expect(answers.get("billing/menu/versions")).toEqual({
			versions: [
				{
					version: 1,
					publishedAt: Date.parse(events[0]?.event_time ?? "") / 1000,
					savedAt: Date.parse(events[0]?.event_time ?? "") / 1000,
				},
			],
		});
		const body = answers.get(menuVersionRoute(1)) as {
			menu: unknown;
			stripe: { products: string[]; prices: string[]; portal: boolean };
		};
		expect(body.menu).toEqual(events[0]?.payload.menu);
		// Stripe keys only for items an invoice line names: every tier here was bought monthly.
		expect(body.stripe.products).toContain("t:scholar");
		expect(body.stripe.prices).toContain("t:scholar:month");
		expect(body.stripe.prices).not.toContain("t:scholar:year");
		expect(body.stripe.portal).toBe(false);
		expect(notAvailable.size).toBe(0);
	});

	test("school facts, capabilities refused as demo, and no finance grants", () => {
		expect(answers.get("ledger/school")).toEqual({
			school: "demo-monthly-members",
			name: "Demo · Monthly members",
			timeZone: "America/Denver",
			currency: "usd",
			creditUnit: { one: "class", other: "classes" },
			defaulted: [],
		});
		const capabilities = answers.get("ledger/capabilities") as {
			role: string;
			stripeConnected: boolean;
			actions: Record<string, { allowed: boolean; reason?: string }>;
		};
		expect(capabilities.role).toBe("owner");
		expect(capabilities.stripeConnected).toBe(true);
		expect(Object.keys(capabilities.actions)).toHaveLength(12);
		expect(
			Object.values(capabilities.actions).every(
				({ allowed, reason }) => !allowed && reason === DEMO_REFUSAL,
			),
		).toBe(true);
		expect(answers.get("finance-grants")).toEqual({ grants: [] });
	});

	test("one membership per family, its balances the sums of its postings, named by its scenario id", () => {
		const families = new Set(
			events.flatMap(({ key }) => (key.startsWith("family:") ? [key] : [])),
		);
		expect(members.map(({ key }) => key)).toEqual([...families].sort());
		for (const member of members) {
			expect(member.name).toBe(`Family ${member.familyId}`);
			expect(member.key).toBe(`family:${member.familyId}`);
			expect(member.profileId).toBeNull();
			expect(member.cancelAtPeriodEnd).toBe(false);
			for (const balance of member.balances) {
				expect(balance.available).toBe(
					postedBalance(events, member.key, balance.featureId, "avail"),
				);
				expect(balance.held).toBe(
					postedBalance(events, member.key, balance.featureId, "held"),
				);
			}
		}
		expect(new Set(members.map(({ membershipId }) => membershipId)).size).toBe(
			members.length,
		);
	});

	test("a family whose subscription was deleted is canceled with no period end; the others run", () => {
		const canceled = new Set(
			events.flatMap((event) =>
				event.labels.mapping === "stripe/customer.subscription.deleted@v1"
					? [event.key]
					: [],
			),
		);
		const fam022 = members.find(({ familyId }) => familyId === "fam_022");
		expect(fam022).toMatchObject({
			tierId: "scholar",
			interval: "month",
			quantity: 1,
			status: "canceled",
			currentPeriodEnd: null,
		});
		for (const member of members) {
			expect(member.status).toBe(
				canceled.has(member.key) ? "canceled" : "active",
			);
			if (member.status === "active")
				expect(member.currentPeriodEnd).toBeGreaterThan(0);
		}
	});

	test("granted and rolledOver come from the latest grant's own words", () => {
		const fam004 = members.find(({ familyId }) => familyId === "fam_004");
		const latest = events
			.filter(
				(event) =>
					event.key === "family:fam_004" &&
					event.event_type === "credit.granted" &&
					event.labels.feature === "class",
			)
			.at(-1) as AtmEvent;
		const balance = fam004?.balances.find(
			({ featureId }) => featureId === "class",
		);
		expect(balance?.granted).toBe(
			Number(
				latest.postings.find(({ account }) =>
					account.startsWith("credits:avail:"),
				)?.amount,
			),
		);
		if (latest.labels.rolled_over === undefined)
			expect(balance).not.toHaveProperty("rolledOver");
		else expect(balance?.rolledOver).toBe(Number(latest.labels.rolled_over));
	});

	test("a booking for each spent hold, at the instant it was spent, with no outcome or cutoff", () => {
		const spent = events.filter(
			({ event_type }) => event_type === "credit.spent",
		);
		const bookings = answers.get("bookings") as {
			timeZone: string;
			bookings: BookingRow[];
			nextCursor: null;
		};
		expect(bookings.timeZone).toBe("America/Denver");
		expect(bookings.nextCursor).toBeNull();
		expect(bookings.bookings).toHaveLength(spent.length);
		expect(new Set(bookings.bookings.map(({ id }) => id)).size).toBe(
			spent.length,
		);
		const first = bookings.bookings[0] as BookingRow;
		expect(first).toEqual({
			id: "fam_007-bk_1",
			eventId: "office-hours",
			service: "office-hours",
			startsAt: Date.parse("2026-01-11T05:19:00Z") / 1000,
			endsAt: Date.parse("2026-01-11T05:19:00Z") / 1000,
			hosts: [],
			attendee: { key: "family:fam_007", name: "Family fam_007" },
			guest: false,
			state: "confirmed",
			cutoffMinutes: null,
			seriesId: null,
			attendance: null,
		} as unknown as BookingRow);
		expect(lastBookingOn).toBe("2026-12-28");
	});

	test("as of an instant, only the events up to it count", () => {
		const cut = Date.parse("2026-06-30T00:00:00Z");
		const early = events.filter(
			({ event_time }) => Date.parse(event_time) <= cut,
		);
		const { answers: then, lastBookingOn: lastThen } = answersOf(
			"monthly-members",
			early,
		);
		const bookings = (then.get("bookings") as { bookings: BookingRow[] })
			.bookings;
		expect(bookings.every(({ startsAt }) => startsAt * 1000 <= cut)).toBe(true);
		const lastSpent = early
			.filter(({ event_type }) => event_type === "credit.spent")
			.at(-1) as AtmEvent;
		expect(bookings.at(-1)?.startsAt).toBe(
			Date.parse(lastSpent.event_time) / 1000,
		);
		expect(lastThen).toBe(lastSpent.date);
	});

	test("a scenario of profiles, not families, has its menu but no members list or bookings", () => {
		const { answers: childOnly, notAvailable: missing } =
			answersOf("child-only");
		expect(childOnly.has("billing/members-list")).toBe(false);
		expect(childOnly.has("bookings")).toBe(false);
		expect(childOnly.has(menuVersionRoute(1))).toBe(true);
		expect([...missing.keys()].sort()).toEqual([
			"billing/members-list",
			"bookings",
		]);
	});

	test("an annual preset's memberships are yearly, and a non-USD one has members with no Stripe subscription", () => {
		const annual = (
			answersOf("annual-prepay").answers.get("billing/members-list") as {
				members: MemberRow[];
			}
		).members;
		expect(annual.every(({ interval }) => interval === "year")).toBe(true);
		const nonUsd = answersOf("non-usd").answers;
		const nonUsdMembers = (
			nonUsd.get("billing/members-list") as {
				members: MemberRow[];
			}
		).members;
		expect(nonUsdMembers.length).toBeGreaterThan(0);
		expect(nonUsd.get("ledger/school")).toMatchObject({ currency: "eur" });
	});
});

describe("the stored answers", () => {
	test("are written as of an instant, rewritten only when they change, and extra objects are removed", async () => {
		const harness = await startLedgerWorker({ presets: [] });
		try {
			const store = new R2BindingStore(harness.bucket);
			const school = "demo-tiny-school";
			const events = presetEvents("tiny-school");
			const facts = demoFactsOf("tiny-school", events);
			const first = await writeDemoApi(
				store,
				school,
				events,
				facts,
				new Date("2026-03-01T00:00:00Z"),
			);
			expect(first.written).toBe(DEMO_API_ROUTES.length + 2);
			const again = await writeDemoApi(
				store,
				school,
				events,
				facts,
				new Date("2026-03-01T00:00:00Z"),
			);
			expect(again).toEqual({
				written: 0,
				unchanged: first.written,
				removed: 0,
			});
			await store.putIfAbsent(
				demoApiKey(school, "billing/menu/versions/9"),
				new TextEncoder().encode("{}\n"),
			);
			const later = await writeDemoApi(
				store,
				school,
				events,
				facts,
				new Date("2026-07-01T00:00:00Z"),
			);
			expect(later.removed).toBe(1);
			expect(later.written).toBeGreaterThan(0);
			expect((await readDemoFacts(store, school)).bookingsOpenOn).toBe(
				"2026-06-30",
			);
		} finally {
			await harness.stop();
		}
	}, 120_000);
});

describe("GET /v1/schools/:id/demo-api/<route>", () => {
	const REAL = "6f1c2d3e-4a5b-4c6d-8e7f-901234567890";
	let harness: LedgerHarness;
	let flagOff: LedgerHarness;
	beforeAll(async () => {
		[harness, flagOff] = await Promise.all([
			startLedgerWorker({
				presets: ["disputes"],
				schools: [REAL],
				demoPresets: ["monthly-members", "child-only"],
			}),
			startLedgerWorker({
				presets: [],
				demoPresets: ["monthly-members"],
				demoSchools: false,
			}),
		]);
	}, 240_000);
	afterAll(async () => {
		await Promise.all([harness?.stop(), flagOff?.stop()]);
	});
	const base = "/v1/schools/demo-monthly-members/demo-api";

	test("serves each stored answer to anyone, in the envelope, with the views' asOf", async () => {
		const answers = answersOf("monthly-members").answers;
		for (const route of [
			"ledger/school",
			"ledger/capabilities",
			"billing/members-list",
			"billing/menu/versions",
			"billing/menu/versions/1",
			"finance-grants",
		]) {
			const reply = await call(harness, null, `${base}/${route}`);
			expect({ route, status: reply.status }).toEqual({ route, status: 200 });
			expect(reply.headers.get("cache-control")).toBe("private, no-store");
			expect(reply.body.data).toEqual(
				JSON.parse(JSON.stringify(answers.get(route))),
			);
			expect(reply.body.asOf).toBe(
				harness.seeded["demo-monthly-members"]?.asOf,
			);
			expect(typeof reply.body.lagMinutes).toBe("number");
		}
	});

	test("GET /v1/schools lists the day each demo school's Bookings opens on", async () => {
		const rows = (
			(await call(harness, null, "/v1/schools")).body.data as {
				schools: Array<{ id: string; bookingsOpenOn?: string | null }>;
			}
		).schools;
		expect(
			rows.map(({ id, bookingsOpenOn }) => ({ id, bookingsOpenOn })),
		).toEqual([
			{ id: "demo-child-only", bookingsOpenOn: null },
			{ id: "demo-monthly-members", bookingsOpenOn: "2026-12-28" },
		]);
	});

	test("a valid token for another school reads it too; an invalid one is refused", async () => {
		const token = await harness.mintToken({
			sub: "profile_real",
			schools: [{ id: REAL, role: "admin", finance: false }],
		});
		expect((await call(harness, token, `${base}/ledger/school`)).status).toBe(
			200,
		);
		expect(
			(await call(harness, "not-a-token", `${base}/ledger/school`)).status,
		).toBe(401);
	});

	test("bookings answers the asked days in the school's zone, at most 62 of them", async () => {
		const reply = await call(
			harness,
			null,
			`${base}/bookings?from=2026-01-10&to=2026-01-11`,
		);
		expect(reply.status).toBe(200);
		const data = reply.body.data as {
			timeZone: string;
			bookings: BookingRow[];
		};
		expect(data.timeZone).toBe("America/Denver");
		// 2026-01-11T05:19Z is 2026-01-10 22:19 in Denver.
		expect(data.bookings.map(({ id }) => id)).toContain("fam_007-bk_1");
		expect(
			(
				(
					await call(
						harness,
						null,
						`${base}/bookings?from=2026-01-11&to=2026-01-11`,
					)
				).body.data as { bookings: BookingRow[] }
			).bookings.map(({ id }) => id),
		).not.toContain("fam_007-bk_1");
		expect((await call(harness, null, `${base}/bookings`)).status).toBe(400);
		const wide = await call(
			harness,
			null,
			`${base}/bookings?from=2026-01-01&to=2026-03-04`,
		);
		expect(wide.status).toBe(400);
		expect(wide.body.error?.field).toBe("to");
	});

	test("a route the events cannot answer is 501; an unknown route or version is 404", async () => {
		const missing = await call(
			harness,
			null,
			"/v1/schools/demo-child-only/demo-api/billing/members-list",
		);
		expect(missing.status).toBe(501);
		expect(missing.body.error?.code).toBe("not_available");
		expect(
			(await call(harness, null, `${base}/billing/menu/versions/7`)).status,
		).toBe(404);
		expect((await call(harness, null, `${base}/billing/menu`)).status).toBe(
			404,
		);
		expect((await call(harness, null, `${base}/demo.json`)).status).toBe(404);
	});

	test("a real school, an unknown demo id and the flag off are 404, with or without a token", async () => {
		const token = await harness.mintToken({
			sub: "profile_real",
			schools: [{ id: REAL, role: "owner", finance: true }],
		});
		for (const [worker, path, bearer] of [
			[harness, `/v1/schools/${REAL}/demo-api/ledger/school`, null],
			[harness, `/v1/schools/${REAL}/demo-api/ledger/school`, token],
			[harness, "/v1/schools/demo-nothing/demo-api/ledger/school", null],
			[flagOff, `${base}/ledger/school`, null],
		] as const) {
			const reply = await call(worker, bearer, path);
			expect({ path, status: reply.status }).toEqual({ path, status: 404 });
		}
		expect(
			(await call(harness, null, `${base}/ledger/school`, { method: "POST" }))
				.status,
		).toBe(405);
	});

	test("the views job writes a demo school's answers again as of its views", async () => {
		const store = new R2BindingStore(harness.bucket);
		await store.delete(
			demoApiKey("demo-monthly-members", "finance-grants"),
			await sha256(
				(await store.get(demoApiKey("demo-monthly-members", "finance-grants")))
					.body,
			),
		);
		expect((await call(harness, null, `${base}/finance-grants`)).status).toBe(
			404,
		);
		// Both demo schools' views are older than an hour once the clock moves on: the job rebuilds one per run.
		harness.clock.advance(2 * 60 * 60 * 1000);
		for (let run = 0; run < 2; run += 1)
			await runViewsJob(store, new Date(harness.clock.now()));
		expect((await call(harness, null, `${base}/finance-grants`)).status).toBe(
			200,
		);
	});
});

const sha256 = async (body: Uint8Array): Promise<string> =>
	[...new Uint8Array(await crypto.subtle.digest("SHA-256", body))]
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
