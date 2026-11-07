/**
 * Every endpoint of contract section 11 on a money-heavy, a refund-heavy, a free-only and a non-USD preset, against the
 * same function of `atm/worker` called directly on the same events.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
	audiences,
	audienceViews,
	financeMonthsFor,
	incomeStatement,
	ledgerRows,
	membersIncome,
} from "atm/worker";
import { DISCLOSURE_FILE, sizeOf } from "../src/data/disclosure.js";
import {
	type LedgerHarness,
	startLedgerWorker,
} from "../src/testing/harness.js";
import {
	byId,
	call,
	expectedKpiDocument,
	kpiInputs,
	menuOf,
	viewsOf,
	wire,
} from "./support.js";

const PRESETS = [
	"monthly-members",
	"heavy-refunds",
	"free-only",
	"non-usd",
] as const;
const FULL_YEAR = { from: "2026-01-01", to: "2026-12-31" };

let harness: LedgerHarness;
let token: string;
beforeAll(async () => {
	harness = await startLedgerWorker({ presets: PRESETS });
	token = await harness.mintToken({
		sub: "profile_owner",
		schools: PRESETS.map((id) => ({ id, role: "owner", finance: true })),
	});
}, 120_000);
afterAll(async () => {
	await harness.stop();
});

const get = (path: string) => call(harness, token, `/v1${path}`);
/** Minutes from `asOf` to the Worker's clock, rounded up: the Worker's `lagMinutes`. */
const lagOf = (asOf: string): number =>
	Math.ceil((Date.parse(harness.clock.now()) - Date.parse(asOf)) / 60_000);

describe("every success carries asOf, lagMinutes and no-store", () => {
	for (const preset of PRESETS)
		test(preset, async () => {
			const school = harness.seeded[preset];
			if (!school) throw new Error("not seeded");
			for (const path of [
				`/schools/${preset}/kpi?audience=owner&pin=open`,
				`/schools/${preset}/disclosure`,
				`/schools/${preset}/audience-report?audience=public&from=2026-06-01&to=2026-06-30`,
				`/schools/${preset}/ledger?from=2026-03-01&to=2026-03-31`,
				`/schools/${preset}/income-statement?from=2026-01-01&to=2026-12-31&compare=0`,
				`/schools/${preset}/members-income?from=2026-01-01&to=2026-12-31`,
				`/schools/${preset}/fundraising?from=2026-01-01&to=2026-12-31`,
			]) {
				const reply = await get(path);
				if (reply.status === 501) {
					expect(reply.body.error?.code).toBe("not_available");
					expect(reply.headers.get("cache-control")).toBe("private, no-store");
					continue;
				}
				expect(reply.status, path).toBe(200);
				expect(reply.body.asOf, path).toBe(school.asOf);
				expect(reply.body.lagMinutes, path).toBe(lagOf(school.asOf));
				expect(reply.headers.get("cache-control"), path).toBe(
					"private, no-store",
				);
			}
		});
});

describe("GET /v1/schools", () => {
	test("the token's schools, with how fresh each is", async () => {
		const reply = await get("/schools");
		expect(reply.status).toBe(200);
		const data = reply.body.data as {
			schools: {
				id: string;
				asOf: string | null;
				lagMinutes: number | null;
				stale: boolean;
			}[];
		};
		expect(data.schools.map((school) => school.id).sort()).toEqual(
			[...PRESETS].sort(),
		);
		for (const school of data.schools) {
			expect(school.asOf).toBe(harness.seeded[school.id]?.asOf as string);
			expect(school.lagMinutes).toBe(
				lagOf(harness.seeded[school.id]?.asOf as string),
			);
			expect(school.stale).toBe((school.lagMinutes ?? 0) > 15);
		}
	});

	test("a school with no views has nulls and is stale; a stale one is marked once it is over 15 minutes old", async () => {
		const early = await harness.mintToken({
			sub: "p",
			schools: [
				{ id: "no-views-yet", role: "owner", finance: true },
				{ id: "free-only", role: "owner", finance: true },
			],
		});
		const fresh = await call(harness, early, "/v1/schools");
		const data = fresh.body.data as {
			schools: {
				id: string;
				asOf: string | null;
				lagMinutes: number | null;
				stale: boolean;
			}[];
		};
		expect(data.schools.find((s) => s.id === "no-views-yet")).toEqual({
			id: "no-views-yet",
			asOf: null,
			lagMinutes: null,
			stale: true,
		});
		expect(fresh.body.asOf).toBe(harness.seeded["free-only"]?.asOf as string);
		const before = lagOf(harness.seeded["free-only"]?.asOf as string);
		harness.clock.advance((16 - before) * 60_000);
		const later = await harness.mintToken({
			sub: "p",
			schools: [{ id: "free-only", role: "owner", finance: true }],
		});
		const aged = await call(harness, later, "/v1/schools");
		const agedSchool = (
			aged.body.data as { schools: { lagMinutes: number; stale: boolean }[] }
		).schools[0];
		expect(agedSchool).toMatchObject({ lagMinutes: 16, stale: true });
		harness.clock.advance((before - 16) * 60_000);
	});
});

describe("GET /healthz", () => {
	test("answers ok with no token and no asOf", async () => {
		const reply = await call(harness, null, "/healthz");
		expect(reply.status).toBe(200);
		expect(reply.body).toEqual({ ok: true } as never);
	});
});

describe("kpi equals kpiDocument on the same inputs", () => {
	for (const preset of PRESETS)
		test(`${preset}: every audience, PIN open and locked from governance up`, async () => {
			const school = harness.seeded[preset];
			if (!school) throw new Error("not seeded");
			for (const audience of audiences) {
				const pins =
					audiences.indexOf(audience) >= audiences.indexOf("governance")
						? ["open", "locked"]
						: ["open"];
				for (const pin of pins) {
					const reply = await get(
						`/schools/${preset}/kpi?audience=${audience}&pin=${pin}`,
					);
					expect(reply.status, `${audience} ${pin}`).toBe(200);
					expect(reply.body.data, `${audience} ${pin}`).toEqual(
						expectedKpiDocument(
							school,
							harness.clock.now(),
							audience,
							pin === "locked",
						),
					);
				}
			}
		}, 60_000);

	test("the document is of the school's events, in the unit the books are kept in", async () => {
		const reply = await get(
			"/schools/monthly-members/kpi?audience=owner&pin=open",
		);
		expect(reply.body.data).toMatchObject({
			school: "monthly-members",
			source: { kind: "events" },
			dataSource: "events",
			currency: "usd",
			basis: "cash",
		});
	});
});

describe("the KPIs the log cannot answer have no figure, not 0", () => {
	const seriesOf = async (preset: string, kpi: string) => {
		const reply = await get(`/schools/${preset}/kpi?audience=owner&pin=open`);
		const document = reply.body.data as {
			empty: boolean;
			tables: { month?: { series: Record<string, unknown[]> } };
		};
		return { document, series: document.tables.month?.series[kpi] };
	};

	test("a non-USD school's money KPIs are not computed", async () => {
		const { document, series } = await seriesOf("non-usd", "gross_collected");
		expect(series).toBeDefined();
		expect(
			series?.every(
				(cell) => (cell as { hidden?: string }).hidden === "not_computed",
			),
		).toBe(true);
		expect(document).toMatchObject({ empty: true });
	});

	test("a USD school's money KPIs are figures", async () => {
		const { series } = await seriesOf("monthly-members", "gross_collected");
		expect(series?.some((cell) => typeof cell === "number" && cell > 0)).toBe(
			true,
		);
	});
});

describe("disclosure", () => {
	test("the B4 Uni file, no override, the school's size", async () => {
		const reply = await get("/schools/monthly-members/disclosure");
		const data = reply.body.data as Record<string, unknown>;
		expect(data).toMatchObject({
			school: "monthly-members",
			year: 2026,
			size: "small",
			override: null,
			source: "defaults",
		});
		expect(data.file).toMatchObject({ version: 1, catalog: "school.v1" });
		// the five audiences' views, from audienceViews of atm/worker; viewer and viewAs are the adapter's
		expect(Object.keys(data.views as object)).toEqual([
			"public",
			"member",
			"governance",
			"finance",
			"owner",
		]);
		const school = harness.seeded["monthly-members"];
		if (!school) throw new Error("not seeded");
		const { rows, context, year } = kpiInputs(school, harness.clock.now());
		expect(data.views).toEqual(
			wire(
				audienceViews({
					file: DISCLOSURE_FILE,
					override: {},
					size: sizeOf(rows, year),
					year,
					clock: context.clock,
				}),
			),
		);
		expect(data).not.toHaveProperty("viewer");
		expect(data).not.toHaveProperty("viewAs");
	});
});

describe("audience-report derives from the same document", () => {
	for (const audience of ["public", "member", "governance"] as const)
		test(`${audience}: the report's figures are the document's cells`, async () => {
			const school = harness.seeded["monthly-members"];
			if (!school) throw new Error("not seeded");
			const reply = await get(
				`/schools/monthly-members/audience-report?audience=${audience}&from=2026-06-01&to=2026-06-30`,
			);
			expect(reply.status).toBe(200);
			const report = reply.body.data as {
				audience: string;
				grain: string;
				periodLabel: string;
				figures: Record<string, unknown>;
				rounding: unknown;
			};
			const document = expectedKpiDocument(
				school,
				harness.clock.now(),
				audience,
				false,
			) as unknown as {
				grain: string;
				roundTo: number;
				size: string;
				periods: {
					period: string;
					label: string;
					from: string;
					to: string;
					state: string;
				}[];
				tables: Record<
					string,
					{ periods: string[]; series: Record<string, unknown[]> }
				>;
			};
			const table = document.tables[document.grain];
			const shown =
				document.periods.find(
					(p) =>
						p.from <= "2026-06-01" &&
						"2026-06-01" <= p.to &&
						p.state === "shown",
				) ??
				document.periods.filter((p) => p.state === "shown").at(-1) ??
				document.periods[0];
			const at = (kpi: string) =>
				table?.series[kpi]?.[table.periods.indexOf(shown?.period ?? "")];
			expect(report.audience).toBe(audience);
			expect(report.grain).toBe(document.grain);
			expect(report.periodLabel).toBe(shown?.label);
			expect(report.figures.income).toEqual(at("gross_collected") as never);
			expect(report.figures.refunds).toEqual(at("refunds") as never);
			expect(report.figures.net).toEqual(at("net_income") as never);
			expect(report.rounding).toEqual(
				document.roundTo === 0
					? null
					: { unitCents: document.roundTo, size: document.size },
			);
		});

	test("gifts outstanding is not computed for governance and not theirs to see below it", async () => {
		const governance = await get(
			"/schools/monthly-members/audience-report?audience=governance&from=2026-06-01&to=2026-06-30",
		);
		expect(
			(governance.body.data as { figures: { giftsOutstanding: unknown } })
				.figures.giftsOutstanding,
		).toEqual({ hidden: "not_computed", text: "Not computed" });
		const pub = await get(
			"/schools/monthly-members/audience-report?audience=public&from=2026-06-01&to=2026-06-30",
		);
		expect(
			(pub.body.data as { figures: { giftsOutstanding: unknown } }).figures
				.giftsOutstanding,
		).toEqual({ hidden: "no_grant", who: "Governance and up" });
	});
});

describe("ledger equals ledgerRows", () => {
	for (const preset of PRESETS)
		test(`${preset}: a month, a type filter and a drill`, async () => {
			const school = harness.seeded[preset];
			if (!school) throw new Error("not seeded");
			const events = [...school.events].sort(byId);
			const menu = menuOf(events);
			for (const filter of [
				{ from: "2026-03-01", to: "2026-03-31", type: null, drill: null },
				{
					from: "2026-01-01",
					to: "2026-02-28",
					type: "payment" as const,
					drill: null,
				},
				{
					from: "2026-04-01",
					to: "2026-05-31",
					type: null,
					drill: "income" as const,
				},
				{
					from: "2026-04-01",
					to: "2026-05-31",
					type: null,
					drill: "disc" as const,
				},
			]) {
				const query = new URLSearchParams({ from: filter.from, to: filter.to });
				if (filter.type) query.set("type", filter.type);
				if (filter.drill) query.set("drill", filter.drill);
				const reply = await get(`/schools/${preset}/ledger?${query}`);
				expect(reply.status).toBe(200);
				const page = reply.body.data as {
					count: number;
					pending: unknown[];
					timeZone: string | null;
					currency: string | null;
					days: {
						date: string;
						count: number;
						credits: number;
						amountCents: number;
						entries: {
							event: unknown;
							localTime: string;
							member: { key: string } | null;
							credits: number | null;
							amountCents: number | null;
							paymentId: string | null;
							promo: unknown;
							pending: boolean;
						}[];
					}[];
				};
				const rows = ledgerRows(events, filter, null, 1000).rows;
				expect(page.count).toBe(rows.length);
				expect(page.pending).toEqual([]);
				expect(page.timeZone).toBe(menu?.timeZone ?? null);
				expect(page.currency).toBe(menu?.currency ?? null);
				const entries = page.days.flatMap((day) => day.entries);
				expect(entries.map((entry) => entry.event)).toEqual(
					wire(rows.map((row) => row.event)),
				);
				expect(
					entries.map((entry) => [
						entry.localTime,
						entry.member?.key ?? null,
						entry.credits,
						entry.amountCents,
						entry.paymentId,
					]),
				).toEqual(
					rows.map((row) => [
						row.localTime,
						row.holderKey,
						row.credits,
						row.amountCents,
						row.paymentId,
					]),
				);
				expect(entries.every((entry) => entry.pending === false)).toBe(true);
				// newest day first, and a day's counts are its entries'
				expect(page.days.map((day) => day.date)).toEqual(
					[...page.days.map((day) => day.date)].sort().reverse(),
				);
				for (const day of page.days) expect(day.count).toBe(day.entries.length);
				if (filter.drill === "disc") expect(rows).toEqual([]);
			}
		});

	test("a page is one range of at most 62 days; promo is not available", async () => {
		const tooLong = await get(
			"/schools/monthly-members/ledger?from=2026-01-01&to=2026-03-04",
		);
		expect(tooLong.status).toBe(400);
		expect(tooLong.body.error).toMatchObject({
			code: "bad_request",
			field: "to",
		});
		const longest = await get(
			"/schools/monthly-members/ledger?from=2026-01-01&to=2026-03-03",
		);
		expect(longest.status).toBe(200);
		const promo = await get(
			"/schools/monthly-members/ledger?from=2026-01-01&to=2026-01-31&promo=x",
		);
		expect(promo.status).toBe(501);
		expect(promo.body.error?.code).toBe("not_available");
	});
});

describe("income-statement and members-income equal S8a's", () => {
	const stripSchool = <Month extends { school: string; month: string }>(
		months: Month[],
	) => months;
	for (const preset of PRESETS)
		test(preset, async () => {
			const school = harness.seeded[preset];
			if (!school) throw new Error("not seeded");
			const views = viewsOf(school);
			const monthObjects = Object.entries(views.finance.months).map(
				([month, view]) => ({ school: school.id, month, ...view }),
			);
			for (const range of [
				FULL_YEAR,
				{ from: "2026-03-10", to: "2026-09-20" },
				{ from: "2026-02-01", to: "2026-02-14" },
			]) {
				const skipped = monthObjects.some(
					(month) =>
						month.skippedNonUsd > 0 &&
						financeMonthsFor(range.from, range.to, true).includes(month.month),
				);
				const reply = await get(
					`/schools/${preset}/income-statement?from=${range.from}&to=${range.to}&compare=1`,
				);
				const money = await get(
					`/schools/${preset}/members-income?from=${range.from}&to=${range.to}`,
				);
				if (skipped) {
					expect(reply.status).toBe(501);
					expect(reply.body.error?.code).toBe("not_available");
					expect(money.status).toBe(501);
					continue;
				}
				const expected = incomeStatement(stripSchool(monthObjects), {
					...range,
					compare: true,
				});
				expect(reply.status).toBe(200);
				const statement = reply.body.data as {
					school: string;
					amounts: Record<string, number | null>;
					counts: Record<string, number>;
					basis: unknown;
					matchesStripe: unknown;
					giftsOutstanding: unknown;
					income: {
						totalCents: number;
						step: string;
						through: string;
						points: { start: string; amountCents: number }[];
					};
					previous: {
						from: string;
						to: string;
						amounts: Record<string, number | null>;
						changes: Record<string, number | null>;
					} | null;
				};
				const f = expected.figures;
				expect(statement.amounts).toEqual({
					memberships: f.memberships,
					bookings: f.bookings,
					discounts: null,
					income: f.income - f.fundraising,
					refunds: f.refunds,
					fees: f.fees,
					net: f.net,
					giftsSold: null,
					paidOut: f.paidOut,
				});
				expect(statement.counts).toEqual({
					payments: expected.counts.payments,
					refunds: expected.counts.refunds,
					payouts: expected.counts.payouts,
				});
				expect(statement.basis).toEqual({ kind: "cash" });
				expect(statement.matchesStripe).toBeNull();
				expect(statement.giftsOutstanding).toBeNull();
				expect(statement.previous?.from).toBe(
					expected.previous?.from as string,
				);
				expect(statement.previous?.to).toBe(expected.previous?.to as string);
				const c = expected.previous?.changes;
				expect(statement.previous?.changes).toEqual({
					memberships: c?.memberships,
					bookings: c?.bookings,
					discounts: null,
					income: (c?.income ?? 0) - (c?.fundraising ?? 0),
					refunds: c?.refunds,
					fees: c?.fees,
					net: c?.net,
					giftsSold: null,
					paidOut: c?.paidOut,
				} as never);
				// the series adds up to the statement's income, in whole days up to 62 and in weeks beyond
				expect(statement.income.totalCents).toBe(f.income - f.fundraising);
				expect(statement.income.step).toBe(
					range === FULL_YEAR || range.to === "2026-09-20" ? "week" : "day",
				);
				expect(
					statement.income.points.reduce((sum, p) => sum + p.amountCents, 0),
				).toBe(statement.income.totalCents);
				expect(money.status).toBe(200);
				expect(money.body.data).toEqual({
					cents: membersIncome(monthObjects, range.from, range.to),
				});
			}
		});

	test("compare=0 has no previous period; a bad range is a 400 naming the field", async () => {
		const alone = await get(
			"/schools/monthly-members/income-statement?from=2026-03-01&to=2026-03-31&compare=0",
		);
		expect((alone.body.data as { previous: unknown }).previous).toBeNull();
		const backwards = await get(
			"/schools/monthly-members/income-statement?from=2026-04-01&to=2026-03-31",
		);
		expect(backwards.body.error).toMatchObject({
			code: "bad_request",
			field: "from",
		});
		const garbage = await get(
			"/schools/monthly-members/income-statement?from=2026-04-31x&to=2026-05-31",
		);
		expect(garbage.body.error).toMatchObject({
			code: "bad_request",
			field: "from",
		});
		const missing = await get(
			"/schools/monthly-members/members-income?from=2026-04-01",
		);
		expect(missing.body.error).toMatchObject({
			code: "bad_request",
			field: "to",
		});
		const flag = await get(
			"/schools/monthly-members/income-statement?from=2026-03-01&to=2026-03-31&compare=yes",
		);
		expect(flag.body.error).toMatchObject({
			code: "bad_request",
			field: "compare",
		});
	});
});

describe("members/:key/money", () => {
	test("a member's payments and history are their finance object and their events", async () => {
		const school = harness.seeded["heavy-refunds"];
		if (!school) throw new Error("not seeded");
		const views = viewsOf(school);
		const refunded = Object.values(views.finance.members).find(
			(member) => member.refunds.length > 0,
		);
		if (!refunded) throw new Error("the preset has no refunded member");
		const reply = await get(
			`/schools/heavy-refunds/members/${encodeURIComponent(refunded.key)}/money`,
		);
		expect(reply.status).toBe(200);
		const data = reply.body.data as {
			payments: {
				date: string;
				description: string;
				amountCents: number;
				status: string;
				invoiceId: string | null;
				paymentId: string | null;
			}[];
			history: {
				at: string;
				type: string;
				text: string;
				amountCents: number | null;
			}[];
		};
		const sales = data.payments.filter(
			(row) => row.amountCents > 0 || row.description !== "Refund",
		);
		expect(sales.reduce((sum, row) => sum + row.amountCents, 0)).toBe(
			refunded.paidCents,
		);
		const refunds = data.payments.filter((row) => row.description === "Refund");
		expect(refunds.reduce((sum, row) => sum + row.amountCents, 0)).toBe(
			0 - refunded.refundedCents,
		);
		expect(
			refunds.every((row) => row.status === "Refunded" && row.amountCents < 0),
		).toBe(true);
		expect(
			data.payments.some(
				(row) => row.status === "Refunded" || row.status === "Partly refunded",
			),
		).toBe(true);
		const own = school.events.filter((event) => event.key === refunded.key);
		expect(data.history).toHaveLength(own.length);
		expect(data.history.map((entry) => entry.at)).toEqual(
			[...data.history.map((entry) => entry.at)].sort().reverse(),
		);
		expect(JSON.stringify(data)).not.toMatch(
			/[\w.+-]+@[\w-]+\.[\w.]+|billing_email|billing_name|cus_/,
		);
	});

	test("an unknown key is a 404 not_found, a malformed escape a 400", async () => {
		const unknown = await get(
			"/schools/heavy-refunds/members/family%3Anobody/money",
		);
		expect(unknown.status).toBe(404);
		expect(unknown.body.error?.code).toBe("not_found");
		const bad = await get("/schools/heavy-refunds/members/%E0%A4%A/money");
		expect(bad.status).toBe(400);
	});

	test("a member with no payments has an empty list, and still their history", async () => {
		const school = harness.seeded["free-only"];
		if (!school) throw new Error("not seeded");
		const key = school.events.find((event) => event.key.startsWith("family:"))
			?.key as string;
		const reply = await get(
			`/schools/free-only/members/${encodeURIComponent(key)}/money`,
		);
		expect(reply.status).toBe(200);
		const data = reply.body.data as { payments: unknown[]; history: unknown[] };
		expect(data.payments).toEqual([]);
		expect(data.history.length).toBeGreaterThan(0);
	});
});
