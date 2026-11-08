import { expect, test } from "bun:test";
import type { WorkerLedgerPage } from "../../src/http/worker-source.ts";
import { schoolId } from "./helpers.ts";
import { memberRow, membersAnswer } from "./recorded.ts";
import { adapters } from "./setup.ts";

/**
 * The real Worker's answers where they are wider than the `Reader` types (S8e part 2, found against S8c's harness): a
 * ledger entry's promo carries the id only (`code: null`, the log holds no code), and a statement's currency and unit
 * are null for a school with no published menu. The adapter shows neither as something it is not.
 */

const envelope = (data: unknown) => ({
	asOf: "2026-11-07T12:00:00Z",
	lagMinutes: 3,
	data,
});

test("a ledger promo without a code is no promo label, never a made-up code", async () => {
	const { reader, http } = adapters({ worker: "fetch" });
	const entry = (promo: { id: string; code: string | null } | null) => ({
		event: { id: `01J${promo?.id ?? "none"}` },
		pending: false,
		localTime: "2026-11-06T10:00",
		member: null,
		credits: null,
		amountCents: 3250,
		paymentId: "pi_1",
		promo,
	});
	const page = {
		school: schoolId,
		from: "2026-11-01",
		to: "2026-11-07",
		timeZone: "America/Denver",
		currency: "usd",
		unit: null,
		count: 3,
		pending: [],
		days: [
			{
				date: "2026-11-06",
				count: 3,
				credits: 0,
				amountCents: 9750,
				entries: [
					entry({ id: "c1", code: null }),
					entry({ id: "c2", code: "SPRING" }),
					entry(null),
				],
			},
		],
	} as unknown as WorkerLedgerPage;
	http.on("GET", /\/ledger$/, { status: 200, body: envelope(page) });
	http.on("GET", /members-list$/, {
		status: 200,
		body: membersAnswer([memberRow()]),
	});
	const result = await reader.ledger({
		school: schoolId,
		from: "2026-11-01",
		to: "2026-11-07",
		type: null,
		drill: null,
		promo: null,
	});
	expect(result.days[0]?.entries.map(({ promo }) => promo)).toEqual([
		null,
		{ id: "c2", code: "SPRING" },
		null,
	]);
});

test("a statement with no currency or unit (no published menu) comes through as null: Reports uses the school's own", async () => {
	const { reader, http } = adapters({ worker: "fetch" });
	http.on("GET", /\/income-statement$/, {
		status: 200,
		body: envelope({ school: schoolId, currency: null, unit: null }),
	});
	const statement = await reader.incomeStatement({
		school: schoolId,
		from: "2026-11-01",
		to: "2026-11-30",
		compare: false,
	});
	expect(statement.currency).toBeNull();
	expect(statement.unit).toBeNull();
});
