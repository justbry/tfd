/**
 * A caller without the finance grant (an admin, `finance:false`) can never get an exact figure, a row, a member's
 * payments or the income statement, whatever they ask for. The Worker reads the finance objects to build a coarser
 * document; what it returns is the audience's.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { audiences } from "tfd/worker";
import {
	type LedgerHarness,
	startLedgerWorker,
} from "../src/testing/harness.js";
import { call, viewsOf } from "./support.js";

const SCHOOL = "monthly-members";
const BASE = `/v1/schools/${SCHOOL}`;

let harness: LedgerHarness;
let admin: string;
let financeAdmin: string;
let owner: string;
beforeAll(async () => {
	harness = await startLedgerWorker({ presets: [SCHOOL] });
	admin = await harness.mintToken({
		sub: "a",
		schools: [{ id: SCHOOL, role: "admin", finance: false }],
	});
	financeAdmin = await harness.mintToken({
		sub: "f",
		schools: [{ id: SCHOOL, role: "admin", finance: true }],
	});
	owner = await harness.mintToken({
		sub: "o",
		schools: [{ id: SCHOOL, role: "owner", finance: true }],
	});
}, 120_000);
afterAll(async () => {
	await harness.stop();
});

const school = () => {
	const found = harness.seeded[SCHOOL];
	if (!found) throw new Error("not seeded");
	return found;
};

/** Every exact money figure of the books at 1000 cents or more, and every member key. */
const exactFigures = () => {
	const views = viewsOf(school());
	const figures = new Set<number>();
	let gross = 0;
	for (const month of Object.values(views.finance.months)) {
		for (const cents of [
			month.money.grossCents,
			month.money.refundedCents,
			month.money.feeCents,
			month.money.netCents,
			month.money.payoutCents,
		])
			if (Math.abs(cents) >= 1000) figures.add(Math.abs(cents));
		gross += month.money.grossCents;
		for (const cents of month.grossByDay) if (cents >= 1000) figures.add(cents);
	}
	figures.add(gross);
	for (const member of Object.values(views.finance.members)) {
		if (member.paidCents >= 1000) figures.add(member.paidCents);
		for (const payment of member.payments)
			if (payment.amountCents >= 1000) figures.add(payment.amountCents);
	}
	return { figures, keys: Object.keys(views.finance.members) };
};

/** The numbers a body writes, read once: a figure is "in" the body when some number token equals it. */
const NUMBER = /(?<![\d.])-?\d+(?![\d.])/g;
const numbersIn = (text: string): Set<number> =>
	new Set((text.match(NUMBER) ?? []).map((token) => Math.abs(Number(token))));

describe("a caller without the finance grant", () => {
	test("every finance endpoint is a 403, whatever the query", async () => {
		const { keys } = exactFigures();
		const month = "from=2026-03-01&to=2026-03-31";
		for (const path of [
			`${BASE}/ledger?${month}`,
			`${BASE}/ledger?${month}&type=payment`,
			`${BASE}/ledger?${month}&drill=income`,
			`${BASE}/income-statement?${month}`,
			`${BASE}/income-statement?${month}&compare=1`,
			`${BASE}/members-income?${month}`,
			`${BASE}/fundraising?${month}`,
			`${BASE}/members/${encodeURIComponent(keys[0] as string)}/money`,
		]) {
			const reply = await call(harness, admin, path);
			expect(reply.status, path).toBe(403);
			expect(reply.body.error?.code, path).toBe("finance_required");
			expect(reply.body.data, path).toBeUndefined();
		}
	});

	test("the KPI document is served at public and no finer", async () => {
		for (const audience of audiences) {
			const reply = await call(
				harness,
				admin,
				`${BASE}/kpi?audience=${audience}&pin=open`,
			);
			if (audience === "public") expect(reply.status).toBe(200);
			else {
				expect(reply.status, audience).toBe(403);
				expect(reply.body.error?.code, audience).toBe("audience_not_allowed");
			}
		}
		for (const audience of ["member", "governance"]) {
			const reply = await call(
				harness,
				admin,
				`${BASE}/audience-report?audience=${audience}&from=2026-06-01&to=2026-06-30`,
			);
			expect(reply.status, audience).toBe(403);
		}
	});

	test("the public document is the public audience's, the same as an owner asking for public", async () => {
		const asAdmin = await call(
			harness,
			admin,
			`${BASE}/kpi?audience=public&pin=open`,
		);
		const asOwner = await call(
			harness,
			owner,
			`${BASE}/kpi?audience=public&pin=open`,
		);
		expect(asAdmin.body.data).toEqual(asOwner.body.data);
		expect(asAdmin.body.data).toMatchObject({
			audience: "public",
			live: false,
		});
		expect((asAdmin.body.data as { roundTo: number }).roundTo).toBeGreaterThan(
			0,
		);
	});

	test("nothing it can read holds an exact figure or a member key", async () => {
		const { figures, keys } = exactFigures();
		expect(figures.size).toBeGreaterThan(10);
		const readable = [
			`/v1/schools`,
			`${BASE}/kpi?audience=public&pin=open`,
			`${BASE}/disclosure`,
			`${BASE}/audience-report?audience=public&from=2026-06-01&to=2026-06-30`,
			`${BASE}/audience-report?audience=public&from=2025-06-01&to=2025-06-30`,
			`${BASE}/audience-report?audience=public&from=2026-01-01&to=2026-12-31`,
		];
		for (const path of readable) {
			const reply = await call(harness, admin, path);
			expect(reply.status, path).toBe(200);
			const text = JSON.stringify(reply.body);
			const written = numbersIn(text);
			for (const figure of figures)
				expect(written.has(figure), `${path} holds ${figure}`).toBe(false);
			for (const key of keys) expect(text, path).not.toContain(key);
			expect(text, path).not.toMatch(/family:|fam_|in_fam|pi_/);
		}
	});

	test("a finance grant opens the books to the finance audience, and the owner's role to the owner's", async () => {
		const month = "from=2026-03-01&to=2026-03-31";
		expect(
			(await call(harness, financeAdmin, `${BASE}/income-statement?${month}`))
				.status,
		).toBe(200);
		expect(
			(
				await call(
					harness,
					financeAdmin,
					`${BASE}/kpi?audience=finance&pin=open`,
				)
			).status,
		).toBe(200);
		expect(
			(await call(harness, financeAdmin, `${BASE}/kpi?audience=owner&pin=open`))
				.status,
		).toBe(403);
		expect(
			(await call(harness, owner, `${BASE}/kpi?audience=owner&pin=open`))
				.status,
		).toBe(200);
	});

	test("the exact figures are reachable with the grant (so the scan above is not vacuous)", async () => {
		const { figures } = exactFigures();
		const reply = await call(
			harness,
			financeAdmin,
			`${BASE}/income-statement?from=2026-01-01&to=2026-12-31`,
		);
		const written = numbersIn(JSON.stringify(reply.body));
		expect([...figures].some((figure) => written.has(figure))).toBe(true);
	});
});
