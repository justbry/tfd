/**
 * The disclosure the Worker applies (contract section 4): the B4 Uni file shipped with it, no school override (buzz-school
 * stores none yet, build list group 8), and the school's size. `disclosure.v1.json` is the file `packages/ledger-ui`
 * ships as `src/fixtures/disclosure.json`'s `file`; `tests/disclosure-file.test.ts` keeps the two equal.
 */
import {
	type DisclosureFile,
	type KpiDisclosure,
	type KpiDocumentRow,
	schoolSize,
} from "atm/worker";
import disclosureFile from "./disclosure.v1.json";

export const DISCLOSURE_FILE = disclosureFile as unknown as DisclosureFile;

/** A KPI the size is taken from: the cash collected (mockup `bkSize`: the last closed year's income against `largeFrom`). */
const SIZE_KPI = "gross_collected";

/** The school's size (`schoolSize` of atm/worker) from the last closed year's gross collected; no row for that year is no closed year. */
export const sizeOf = (
	rows: readonly KpiDocumentRow[],
	year: number,
): KpiDisclosure["size"] => {
	const closed = String(year - 1);
	const found = rows.filter(
		(row) => row.kpiId === SIZE_KPI && row.period.startsWith(closed),
	);
	return schoolSize(
		DISCLOSURE_FILE,
		found.length === 0
			? null
			: found.reduce((total, row) => total + row.value, 0),
	);
};

export const disclosureOf = (
	rows: readonly KpiDocumentRow[],
	year: number,
): KpiDisclosure => ({
	size: sizeOf(rows, year),
	file: DISCLOSURE_FILE,
	override: {},
});
