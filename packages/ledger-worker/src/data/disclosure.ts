/**
 * The disclosure the Worker applies (contract section 4): the B4 Uni file shipped with it, no school override (buzz-school
 * stores none yet, build list group 8), and the school's size. `disclosure.v1.json` is the file `packages/ledger-ui`
 * ships as `src/fixtures/disclosure.json`'s `file`; `tests/disclosure-file.test.ts` keeps the two equal.
 */
import type { DisclosureFile, KpiDisclosure, KpiDocumentRow } from "atm/worker";
import disclosureFile from "./disclosure.v1.json";

export const DISCLOSURE_FILE = disclosureFile as unknown as DisclosureFile;

/** A KPI the size is taken from: the cash collected (mockup `bkSize`: the last closed year's income against `largeFrom`). */
const SIZE_KPI = "gross_collected";

/** `large` when the last closed year's gross collected reached the file's `largeFrom`; a school with no closed year is `small`. */
export const sizeOf = (
	rows: readonly KpiDocumentRow[],
	year: number,
): KpiDisclosure["size"] => {
	const closed = String(year - 1);
	const income = rows
		.filter((row) => row.kpiId === SIZE_KPI && row.period.startsWith(closed))
		.reduce((total, row) => total + row.value, 0);
	return income >= DISCLOSURE_FILE.rounding.largeFrom ? "large" : "small";
};

export const disclosureOf = (
	rows: readonly KpiDocumentRow[],
	year: number,
): KpiDisclosure => ({
	size: sizeOf(rows, year),
	file: DISCLOSURE_FILE,
	override: {},
});
