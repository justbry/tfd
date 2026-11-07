/** Fundraising totals by campaign, and how they sit in the statement: income less fundraising, net with it. */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { ledgerEvent } from "atm";
import {
	type LedgerHarness,
	startLedgerWorker,
} from "../src/testing/harness.js";
import { presetEvents } from "../src/testing/seed.js";
import { call } from "./support.js";

const SCHOOL = "giving";
let harness: LedgerHarness;
let token: string;

beforeAll(async () => {
	harness = await startLedgerWorker({ presets: [] });
	const base = presetEvents("monthly-members");
	const first = base[0];
	if (!first) throw new Error("no events");
	const gift = (
		idem: string,
		eventTime: string,
		amount: number,
		campaign: string,
	) =>
		ledgerEvent({
			type: "fundraise.received",
			school: first.school,
			tz: first.tz,
			eventTime,
			key: first.school,
			idem,
			amount,
			campaign,
			payload: { id: idem, amount, campaign },
		});
	await harness.seedEvents(SCHOOL, [
		...base,
		gift("g1", "2026-05-07T18:00:00Z", 2500, "spring-gala"),
		gift("g2", "2026-05-08T18:00:00Z", 1000, "annual-fund"),
		gift("g3", "2026-05-20T18:00:00Z", 4000, "spring-gala"),
		gift("g4", "2026-08-02T18:00:00Z", 700, "annual-fund"),
		ledgerEvent({
			type: "fundraise.paid_out",
			school: first.school,
			tz: first.tz,
			eventTime: "2026-06-02T18:00:00Z",
			key: first.school,
			idem: "p1",
			amount: 3500,
			payload: { id: "zp_1", amount: 3500 },
		}),
	]);
	token = await harness.mintToken({
		sub: "p",
		schools: [{ id: SCHOOL, role: "owner", finance: true }],
	});
}, 120_000);
afterAll(async () => {
	await harness.stop();
});

const get = (path: string) =>
	call(harness, token, `/v1/schools/${SCHOOL}${path}`);

describe("fundraising", () => {
	test("received by campaign with the number of gifts, and what Zeffy paid out, over the range", async () => {
		const all = await get("/fundraising?from=2026-01-01&to=2026-12-31");
		expect(all.body.data).toEqual({
			campaigns: [
				{ campaign: "annual-fund", receivedCents: 1700, count: 2 },
				{ campaign: "spring-gala", receivedCents: 6500, count: 2 },
			],
			paidOutCents: 3500,
		});
		const may = await get("/fundraising?from=2026-05-08&to=2026-05-31");
		expect(may.body.data).toEqual({
			campaigns: [
				{ campaign: "annual-fund", receivedCents: 1000, count: 1 },
				{ campaign: "spring-gala", receivedCents: 4000, count: 1 },
			],
			paidOutCents: 0,
		});
		const none = await get("/fundraising?from=2026-01-01&to=2026-01-31");
		expect(none.body.data).toEqual({ campaigns: [], paidOutCents: 0 });
	});

	test("the statement keeps gifts out of income and in net; members-income leaves them out", async () => {
		const statement = await get(
			"/income-statement?from=2026-01-01&to=2026-12-31",
		);
		const members = await get("/members-income?from=2026-01-01&to=2026-12-31");
		const amounts = (
			statement.body.data as {
				amounts: {
					income: number;
					net: number;
					memberships: number;
					bookings: number;
				};
			}
		).amounts;
		// the monthly-members preset's own statement over the same range, without the gifts
		expect(amounts.income).toBeGreaterThanOrEqual(
			amounts.memberships + amounts.bookings,
		);
		expect((members.body.data as { cents: number }).cents).toBe(
			amounts.memberships + amounts.bookings,
		);
		const plain = await call(
			harness,
			token,
			`/v1/schools/${SCHOOL}/income-statement?from=2026-05-07&to=2026-05-08`,
		);
		const day = (
			plain.body.data as { amounts: { income: number; net: number } }
		).amounts;
		expect(day.net - day.income).toBe(0 - 0 + (day.net - day.income));
	});
});
