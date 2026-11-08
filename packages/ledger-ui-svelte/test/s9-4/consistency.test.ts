import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createFixtureReader } from "$contract/fixtures/reader.ts";
import * as booksText from "../../src/app/books-shared/books-text.ts";
import * as ledgerModel from "../../src/app/ledger/ledger-model.ts";
import * as reportsModel from "../../src/app/reports/reports-model.ts";
import { calendar } from "../helpers.ts";

/**
 * Consistency check C for the Ledger and Reports tabs. The Svelte tabs' wording, money, figures and tables are copies of
 * the Preact package's (money.ts, wording.ts, books-pane.ts, report-figure.tsx, ledger.tsx, reports.tsx), which sit beside
 * its Preact UI and so cannot all be imported into the Svelte build. The two that import nothing from Preact (money.ts,
 * wording.ts) are loaded by path and run over the same inputs; for all of them the source is compared, line by line for
 * `books-text.ts` (the Preact lines are all in the copy, and the copy has no line the Preact files lack), and literal by
 * literal, whitespace and trailing commas aside, for the tables and functions of the two tabs' models. The Preact modules
 * are loaded by path, so the type checker never follows them into Preact.
 */
const packages = join(import.meta.dir, "../../../");
const preactApp = join(packages, "ledger-ui/src/app");
const read = (path: string): string => readFileSync(path, "utf8");
const preactMoney = (await import(
	join(preactApp, "money.ts")
)) as typeof booksText;
const preactWording = (await import(
	join(preactApp, "wording.ts")
)) as typeof booksText;
const preactPane = (await import(
	join(preactApp, "books-pane.ts")
)) as typeof booksText;

const normalise = (source: string): string[] =>
	source
		.replace(/^import[\s\S]*?;\n/gm, "")
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/^\s*\/\/.*$/gm, "")
		.split("\n")
		.map((line) => line.replace(/\s+/g, " ").trim())
		.filter((line) => line !== "");
const linesOnlyIn = (first: string[], second: string[]): string[] => {
	const left = [...second];
	return first.filter((line) => {
		const at = left.indexOf(line);
		if (at < 0) return true;
		left.splice(at, 1);
		return false;
	});
};
/** The source without whitespace, comments, `export`, the types of a `const` and trailing commas: two literals that mean
 * the same compare equal however each was formatted. */
const compact = (source: string): string =>
	source
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/^\s*\/\/.*$/gm, "")
		.replace(/\bexport\s+/g, "")
		.replace(/BooksIconName/g, "IconName")
		.replace(/\s+/g, "")
		.replace(/,([}\])])/g, "$1");
const between = (source: string, start: string, end: string): string => {
	const from = source.indexOf(start);
	const to = source.indexOf(end, from + start.length);
	if (from < 0 || to < 0) throw new Error(`no ${start} … ${end}`);
	return source.slice(from, to);
};

describe("books-text.ts is the Preact money, wording, books-pane and figure code", () => {
	const figure = read(join(preactApp, "report-figure.tsx"));
	const preactSources = [
		read(join(preactApp, "money.ts")),
		read(join(preactApp, "wording.ts")),
		read(join(preactApp, "books-pane.ts")),
		between(figure, "/** `7 Jan", "/** One figure of an audience"),
	];
	test("every line of the Preact sources is in the copy, and the copy has no other line (the Preact pane props are not copied)", () => {
		const theirs = preactSources.flatMap(normalise);
		const mine = normalise(
			read(join(import.meta.dir, "../../src/app/books-shared/books-text.ts")),
		);
		expect(linesOnlyIn(mine, theirs)).toEqual([]);
		expect(linesOnlyIn(theirs, mine).sort()).toEqual(
			[
				"clock: Clock;",
				"export type BooksPaneProps = {",
				"navigate: (route: Route) => void;",
				"onRendered: () => void;",
				"onToast: (text: string) => void;",
				"reader: Reader;",
				"route: Route;",
				"school: School;",
				"writer: Writer;",
				"};",
			].sort(),
		);
	});
	test("money, counts, names and constants answer as the Preact modules do", () => {
		const amounts = [
			0, 1, -1, 5, 99, 100, 5000, -5000, 123_456, -987_654_321, 70_000_000,
		];
		const currencies = [null, "", "USD", "CAD", "EUR", "JPY", "GBP", "chf"];
		for (const currency of currencies)
			for (const cents of amounts)
				for (const whole of [false, true]) {
					expect(booksText.formatMoney(cents, currency, whole)).toBe(
						preactMoney.formatMoney(cents, currency, whole),
					);
				}
		for (const currency of currencies) {
			expect(booksText.currencySymbol(currency)).toBe(
				preactMoney.currencySymbol(currency),
			);
			expect(booksText.csvCurrency(currency)).toBe(
				preactMoney.csvCurrency(currency),
			);
		}
		for (const count of [-12, -1, 0, 1, 2, 40]) {
			expect(booksText.signedCount(count)).toBe(preactMoney.signedCount(count));
			expect(booksText.plural(count, "event")).toBe(
				preactWording.plural(count, "event"),
			);
		}
		for (const word of ["", "gift", "sessions", "Credits"])
			expect(booksText.capitalise(word)).toBe(preactWording.capitalise(word));
		expect(booksText.noCurrencyText).toBe(preactMoney.noCurrencyText);
		expect(booksText.smallCount).toBe(preactPane.smallCount);
		expect(booksText.identitiesLockHeading).toBe(
			preactPane.identitiesLockHeading,
		);
	});
});

describe("the Ledger model is the Preact Ledger's tables and functions", () => {
	const source = read(join(preactApp, "ledger.tsx"));
	const mine = compact(
		read(join(import.meta.dir, "../../src/app/ledger/ledger-model.ts")),
	);
	const holds = (preact: string): void => {
		expect(mine).toContain(compact(preact));
	};
	test("the type chips, the event colours and icons, the Amount column and the admin sentence", () => {
		const literal = (text: string): string =>
			text.slice(text.indexOf("= ") + 2);
		holds(
			literal(
				between(source, "const typeChips:", "/** The mockup's `C`"),
			).trim(),
		);
		holds(literal(between(source, "const eventColors:", "const eventIcons")));
		holds(literal(between(source, "const eventIcons:", "function eventIcon(")));
		holds(between(source, "const adminBooksSentence =", "const typeChips"));
		holds(between(source, "function entryAmount(", "function EntryRows"));
		holds(between(source, "const columnCount", "/** The Amount column"));
	});
	test("the icon of an event follows eventIcon's cases", () => {
		const body = between(source, "function eventIcon(", "const isDrill");
		expect(compact(body)).toContain(
			compact(
				'if (event.event_type !== "payment.succeeded") return eventIcons[event.event_type] ?? "dot"; if (event.labels.kind === "booking") return "ticket"; return event.labels.kind === "gift" ? "gift" : "coin";',
			),
		);
		expect(mine).toContain(
			compact(
				'if (event.event_type !== "payment.succeeded") return eventIcons[event.event_type] ?? "dot"; if (event.labels.kind === "booking") return "ticket"; return event.labels.kind === "gift" ? "gift" : "coin";',
			),
		);
	});
	test("the details line carries the same five fields", () => {
		const fields =
			"id: event.id, event_type: event.event_type, key: event.key, labels: event.labels, postings: event.postings";
		expect(compact(source)).toContain(compact(fields));
		expect(mine).toContain(compact(fields));
	});
	test("the types and drill-downs the route may name are the Preact ones", () => {
		expect(ledgerModel.typeChips.map(({ type }) => type)).toEqual([
			null,
			"payment",
			"credit",
			"booking",
			"code",
			"payout",
			"admin",
		]);
		expect(ledgerModel.typeOf("everything")).toBeNull();
		expect(ledgerModel.typeOf("payout")).toBe("payout");
		expect(ledgerModel.isDrill("memb")).toBe(true);
		expect(ledgerModel.isDrill("nonsense")).toBe(false);
	});
});

describe("the Reports model is the Preact Reports' tables and functions", () => {
	const source = read(join(preactApp, "reports.tsx"));
	const mine = compact(
		read(join(import.meta.dir, "../../src/app/reports/reports-model.ts")),
	);
	const holds = (preact: string): void => {
		expect(mine).toContain(compact(preact));
	};
	test("the texts, the KPI tiles and the statement's lines", () => {
		holds(between(source, "const drillTitle", "const grainWords"));
		holds(between(source, "const grainWords", "/** A figure the source"));
		holds(
			between(
				source,
				'const notAvailableText = "—"',
				"const donorsNotAvailableText",
			),
		);
		holds(between(source, "const whoSees:", "/** A money figure"));
		holds(between(source, "const slug =", "// ---- The sparkline"));
		holds(between(source, "const sparkLabel =", "function Spark("));
		holds(between(source, "const kpis: Array", "/** The statement's rows"));
		holds(between(source, "const statementRows: Array", '/** "▲ $X'));
		holds(between(source, "const changeText =", "function StatementBody"));
	});
	test("the sparkline's geometry, the audience document's lines and its CSV", () => {
		holds(
			between(source, "const amounts = series.points.map", "const title ="),
		);
		holds(between(source, "const slot = sparkWidth", "return ("));
		holds(
			between(
				source,
				"const documentColumns =",
				"/** The document's six figures",
			),
		);
		holds(
			between(
				source,
				"/** The document's six figures",
				"return lines.map",
			).replace(/^[\s\S]*?\{\n/, ""),
		);
		expect(compact(source)).toContain(
			compact(
				"return lines.map(({ line, kpi, cell, money }) => ({ line, kpi, ...cellText(cell, money, currency, whole), }));",
			),
		);
		expect(mine).toContain(
			compact(
				"return lines.map(({ line, kpi, cell, money }) => ({ line, kpi, ...cellText(cell, money, currency, whole), }));",
			),
		);
	});
	test("the Ledger route a drill-down opens keeps the period and sets the type back to All", () => {
		holds(between(source, "const ledgerRoute =", "const documentColumns"));
	});
	test("the sparkline draws the Reader's points: the dashed line is the previous period, cut to the same length", async () => {
		const reader = createFixtureReader({ clock: calendar });
		const statement = await reader.incomeStatement({
			school: "vol",
			from: "2026-11-01",
			to: "2026-11-30",
			compare: true,
		});
		const shape = reportsModel.sparkShape(
			statement.income,
			statement.previous?.income ?? null,
		);
		expect(shape.income.split(" ").length).toBe(statement.income.points.length);
		expect(shape.columns.map(({ start }) => start)).toEqual(
			statement.income.points.map(({ start }) => start),
		);
		expect(shape.previous?.split(" ").length).toBe(
			Math.min(
				statement.income.points.length,
				statement.previous?.income.points.length ?? 0,
			),
		);
	});
});
