/**
 * The pricing page against Trifold's tfd catalog (catalog/trifold): the catalog passes tfd's own checks and publishes to
 * the lookup keys checkout will use, and what `bun run build` rendered (the page and pricing.md) shows the catalog's
 * prices and limits. Run `bun run build` first.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
	checkTrifoldCatalog,
	trifoldLookupKey,
} from "../../../catalog/trifold/check.ts";
import {
	TRIFOLD_ANNUAL_MONTHS,
	TRIFOLD_MENUS,
	TRIFOLD_ORGS,
	TRIFOLD_PLANS,
	TRIFOLD_SCHOOL_IDS,
} from "../../../catalog/trifold/index.ts";
import { menuToStripe, validateMenu } from "../../../packages/atm/src/index.ts";
import { BUILD } from "../scripts/agent-files";
import { EVENTS_PER_FAMILY, PLANS } from "../src/lib/pricing/data";

const paid = TRIFOLD_PLANS.filter((plan) => plan.monthly.std > 0);
const count = (value: number) => value.toLocaleString("en-US");
const dollars = (amount: number) =>
	`$${Math.round(amount).toLocaleString("en-US")}`;
/** A family-count blurb ("About 700 families") may round the events-per-family estimate by this much. */
const FAMILY_ROUNDING = 0.1;

describe("the catalog, checked by tfd", () => {
	test("both menus, the policy and Free pass tfd's checks", () => {
		const { menus, policy } = checkTrifoldCatalog();
		expect(policy.memberCode).toBeNull();
		for (const org of TRIFOLD_ORGS) {
			expect(validateMenu(TRIFOLD_MENUS[org])).toEqual({
				ok: true,
				menu: menus[org],
			});
		}
	});

	test("the non-profit menu differs from the standard one only in its amounts", () => {
		const withoutAmounts = (org: (typeof TRIFOLD_ORGS)[number]) =>
			JSON.stringify(TRIFOLD_MENUS[org], (key, value) =>
				key === "amount" && typeof value === "number" && value >= 50
					? 0
					: value,
			);
		expect(withoutAmounts("np")).toBe(withoutAmounts("std"));
	});

	test("each menu publishes one price per sold plan and interval, at trifoldLookupKey", () => {
		for (const org of TRIFOLD_ORGS) {
			const ops = menuToStripe({
				schoolId: TRIFOLD_SCHOOL_IDS[org],
				menu: checkTrifoldCatalog().menus[org],
				previous: null,
				policy: checkTrifoldCatalog().policy,
			});
			const published = ops
				.flatMap((op) => (op.op === "price.create" ? [op.lookupKey] : []))
				.sort();
			const expected = paid
				.filter((plan) => plan.sold)
				.flatMap((plan) =>
					(["month", "year"] as const).map((interval) =>
						trifoldLookupKey(org, plan.id, interval),
					),
				)
				.sort();
			expect(published).toEqual(expected);
			expect(ops.some((op) => op.op.startsWith("coupon"))).toBe(false);
		}
		expect(trifoldLookupKey("std", "starter", "month")).toBe(
			"b4u_tf-std_t_starter_month_2900_usd",
		);
	});

	test("yearly prices charge the same number of months for every plan", () => {
		for (const plan of paid)
			for (const org of TRIFOLD_ORGS)
				expect(plan.yearly[org]).toBe(
					plan.monthly[org] * TRIFOLD_ANNUAL_MONTHS,
				);
	});
});

describe("the pricing data", () => {
	test("lists the catalog's plans, in its order, with its prices and limits", () => {
		expect(
			PLANS.map(({ id, name, price, events, credits }) => ({
				id,
				name,
				price,
				events,
				credits,
			})),
		).toEqual(
			TRIFOLD_PLANS.map(({ id, name, monthly, events, credits }) => ({
				id,
				name,
				price: monthly,
				events,
				credits,
			})),
		);
	});

	test("each plan's family count follows its event limit", () => {
		for (const plan of PLANS) {
			const families = Number(plan.families.replace(/\D/g, ""));
			const estimate = plan.events / EVENTS_PER_FAMILY;
			expect(Math.abs(families - estimate) / estimate).toBeLessThan(
				FAMILY_ROUNDING,
			);
		}
	});
});

describe("the rendered page", () => {
	if (!existsSync(join(BUILD, "pricing.html")))
		throw new Error(
			"No build/pricing.html: run `bun run build` before `bun test`",
		);
	const html = readFileSync(join(BUILD, "pricing.html"), "utf8");
	const markdown = readFileSync(join(BUILD, "pricing.md"), "utf8");
	const text = (fragment: string) =>
		fragment
			.replace(/<[^>]+>/g, "")
			.replace(/\s+/g, " ")
			.trim();
	/** The comparison matrix's cells for one row, by its label. */
	const matrixRow = (label: string): string[] => {
		const start = html.indexOf(`>${label}<`);
		expect(start).toBeGreaterThan(-1);
		const row = html.slice(start, html.indexOf("</tr>", start));
		return [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((match) =>
			text(match[1] ?? ""),
		);
	};

	test("cards show each plan's monthly standard price (the page's default state)", () => {
		for (const plan of TRIFOLD_PLANS) {
			const start = html.indexOf(`id="plan-${plan.id}"`);
			expect(start).toBeGreaterThan(-1);
			const price = html
				.slice(start)
				.match(/<span[^>]*>(\$[\d,]+)<\/span>/)?.[1];
			expect(price).toBe(dollars(plan.monthly.std));
		}
	});

	test("the matrix shows the catalog's events and credits a month", () => {
		const middle = (cells: string[]) => cells.slice(1, -1);
		expect(middle(matrixRow("Ledger events a month"))).toEqual(
			TRIFOLD_PLANS.map((plan) => count(plan.events)),
		);
		expect(middle(matrixRow("Credits a month"))).toEqual(
			TRIFOLD_PLANS.map((plan) => count(plan.credits)),
		);
	});

	test("pricing.md lists every catalog price, monthly and annual, standard and non-profit", () => {
		for (const plan of paid) {
			const row = markdown
				.split("\n")
				.find((line) => line.startsWith(`| ${plan.name} |`));
			const cells = (org: (typeof TRIFOLD_ORGS)[number]) => [
				`${dollars(plan.monthly[org])}/mo`,
				`${dollars(plan.yearly[org] / 12)}/mo, billed ${dollars(plan.yearly[org])} a year`,
			];
			expect(row).toBe(
				`| ${[plan.name, ...cells("std"), ...cells("np")].join(" | ")} | ${count(plan.events)} (${PLANS.find((entry) => entry.id === plan.id)?.families.toLowerCase()}) |`,
			);
		}
	});
});
