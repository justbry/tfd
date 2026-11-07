/** The KPI rows a log gives: the atm channel's rows, less the KPIs the log cannot answer. */
import { describe, expect, test } from "bun:test";
import {
	atmChannel,
	evaluateKpis,
	isExportableKpiId,
	periodsFrom,
	SCHOOL_KPI_SPEC,
} from "atm/worker";
import { kpiRowsOf } from "../src/data/snapshot.js";
import { presetEvents } from "../src/testing/seed.js";
import { byId } from "./support.js";

const eventsOf = (preset: string) => presetEvents(preset).sort(byId);
const idsOf = (rows: { kpiId: string }[]) =>
	new Set(rows.map((row) => row.kpiId.split(":")[0]));

describe("kpiRowsOf", () => {
	test("a log with money and credits gives the plain rows of the atm channel", () => {
		const events = eventsOf("monthly-members");
		const periods = periodsFrom("2026-01", 12);
		const plain = evaluateKpis({
			spec: SCHOOL_KPI_SPEC,
			base: atmChannel.base({ events, spec: SCHOOL_KPI_SPEC, periods }),
			periods,
		})
			.filter((row) => isExportableKpiId(row.kpiId))
			.map(({ kpiId, period, unit, value }) => ({
				kpiId,
				period,
				unit,
				value,
			}));
		expect(kpiRowsOf(events, "2026-12")).toEqual(plain);
	});

	test("a log with no credit event has no credit KPI row, not a row of 0", () => {
		const events = eventsOf("monthly-members").filter(
			(event) => !event.event_type.startsWith("credit."),
		);
		const ids = idsOf(kpiRowsOf(events, "2026-12"));
		for (const credit of [
			"credits_granted",
			"credits_consumed",
			"credits_expired",
			"breakage_rate",
		])
			expect(ids.has(credit)).toBe(false);
		expect(ids.has("gross_collected")).toBe(true);
	});

	test("a log that skipped money in another currency has no money KPI row", () => {
		const ids = idsOf(kpiRowsOf(eventsOf("non-usd"), "2026-12"));
		for (const money of [
			"gross_collected",
			"refunds",
			"net_income",
			"payments_count",
			"paying_members",
			"arpa",
			"payouts",
		])
			expect(ids.has(money), money).toBe(false);
		expect(ids.has("credits_granted")).toBe(true);
	});

	test("rows stop at the month the views are as of, and none has a holder in its id", () => {
		const rows = kpiRowsOf(eventsOf("monthly-members"), "2026-06");
		expect(rows.every((row) => row.period <= "2026-06")).toBe(true);
		expect(rows.some((row) => /family|profile/.test(row.kpiId))).toBe(false);
		expect(kpiRowsOf([], "2026-06")).toEqual([]);
	});
});
