// SPDX-License-Identifier: Apache-2.0
/**
 * Runs every golden vector under tests/golden/<function>/<name>.input.json against <name>.expected.json. The folder
 * name picks the function; add a folder and a runner below to add a function. The comparison is the stringified result
 * against the stringified expected file, so key order and every digit must match (spec R-18, AC-10).
 */
import { describe, expect, it } from "bun:test";
import { type CountedPayment, replayBalance } from "../src/accrual";
import {
	type ApprovalPolicy,
	approvalStatus,
	checkAppend,
	pendingApprovals,
} from "../src/approvals";
import { validateStream } from "../src/events";
import {
	boardReport,
	boardReportCsv,
	type PortfolioNote,
	portfolio,
} from "../src/portfolio";
import { generateSchedule } from "../src/schedule";
import { statement } from "../src/statement";
import type {
	ApprovalAction,
	CivilDate,
	GrantLevel,
	NoteTerms,
} from "../src/types";
import { sharedView } from "../src/visibility";
import { chainRunner, documentsRunner } from "./chain-golden";

const GOLDEN_DIRECTORY = `${import.meta.dir}/golden`;
const INPUT_SUFFIX = ".input.json";
const EXPECTED_SUFFIX = ".expected.json";

interface StatementInput {
	events: unknown[];
	as_of: CivilDate;
}

interface VisibilityInput {
	events: unknown[];
	level: GrantLevel;
	as_of: CivilDate;
}

interface AccrualInput {
	terms: NoteTerms;
	payments: {
		id: string;
		value_date: CivilDate;
		amount_minor: string;
		seq: number;
	}[];
	as_of: CivilDate;
}

interface ApprovalsInput {
	events: unknown[];
	two_person: ApprovalAction[];
	request: { action: ApprovalAction; target: string };
	candidates: unknown[];
}

interface PortfolioInput {
	notes: PortfolioNote[];
	as_of: CivilDate;
}

const runners: Record<string, (input: unknown) => unknown | Promise<unknown>> =
	{
		chain: chainRunner,
		documents: documentsRunner,
		schedule: (input) => generateSchedule(input as NoteTerms),
		accrual: (input) => {
			const { terms, payments, as_of: asOf } = input as AccrualInput;
			const counted: CountedPayment[] = payments.map((entry) => ({
				id: entry.id,
				value_date: entry.value_date,
				amount_minor: BigInt(entry.amount_minor),
				seq: entry.seq,
			}));
			return replayBalance(terms, counted, asOf);
		},
		statement: (input) => {
			const { events, as_of: asOf } = input as StatementInput;
			return statement(events, asOf);
		},
		visibility: (input) => {
			const { events, level, as_of: asOf } = input as VisibilityInput;
			return sharedView(events, level, asOf);
		},
		approvals: (input) => {
			const {
				events,
				two_person: twoPerson,
				request,
				candidates,
			} = input as ApprovalsInput;
			const stream = validateStream(events);
			const policy: ApprovalPolicy = { twoPerson: new Set(twoPerson) };
			return {
				status: approvalStatus(stream, request),
				pending: pendingApprovals(stream, policy),
				checks: candidates.map((candidate) => {
					try {
						checkAppend(stream, candidate, policy);
						return "ok";
					} catch (error) {
						return error instanceof Error ? error.message : String(error);
					}
				}),
			};
		},
		portfolio: (input) => {
			const { notes, as_of: asOf } = input as PortfolioInput;
			const result = portfolio(notes, asOf);
			const report = boardReport(result, asOf);
			return {
				rows: result.rows,
				totals: result.totals,
				invalid_note_ids: result.invalid.map((entry) => entry.note_id),
				report,
				csv: boardReportCsv(report),
			};
		},
	};

const listFiles = (suffix: string): string[] =>
	Array.from(new Bun.Glob(`*/*${suffix}`).scanSync(GOLDEN_DIRECTORY)).sort();

const inputFiles = listFiles(INPUT_SUFFIX);
const expectedFiles = listFiles(EXPECTED_SUFFIX);

describe("golden vectors", () => {
	it("pairs every input with an expected file", () => {
		expect(inputFiles.length).toBeGreaterThan(0);
		const inputNames = inputFiles.map((file) =>
			file.slice(0, -INPUT_SUFFIX.length),
		);
		const expectedNames = expectedFiles.map((file) =>
			file.slice(0, -EXPECTED_SUFFIX.length),
		);
		expect(expectedNames).toEqual(inputNames);
	});

	it("has at least three schedule and three accrual vectors", () => {
		expect(
			inputFiles.filter((file) => file.startsWith("schedule/")).length,
		).toBeGreaterThanOrEqual(3);
		expect(
			inputFiles.filter((file) => file.startsWith("accrual/")).length,
		).toBeGreaterThanOrEqual(3);
	});

	it("has at least four statement vectors", () => {
		expect(
			inputFiles.filter((file) => file.startsWith("statement/")).length,
		).toBeGreaterThanOrEqual(4);
	});

	for (const inputFile of inputFiles) {
		const name = inputFile.slice(0, -INPUT_SUFFIX.length);
		const folder = name.split("/")[0] ?? "";
		it(name, async () => {
			const runner = runners[folder];
			if (runner === undefined) {
				throw new Error(`No golden runner for folder "${folder}"`);
			}
			const input: unknown = JSON.parse(
				await Bun.file(`${GOLDEN_DIRECTORY}/${inputFile}`).text(),
			);
			const expectedText = await Bun.file(
				`${GOLDEN_DIRECTORY}/${name}${EXPECTED_SUFFIX}`,
			).text();
			expect(JSON.stringify(await runner(input))).toBe(
				JSON.stringify(JSON.parse(expectedText)),
			);
		});
	}
});
