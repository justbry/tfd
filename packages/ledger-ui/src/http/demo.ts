import { AdapterError } from "./errors.ts";

/**
 * Demo schools (owner decision 2026-11-08; the ledger Worker's `src/demo.ts`, S8-contract section 11 "Demo schools"):
 * on staging, the golden school scenarios are `demo-<preset>` schools anyone may read, signed in or not. Their figures
 * come from the Worker alone: buzz-school knows no such school, so the HTTP adapters never ask it about one (its
 * buzz-school reads go to the Worker's `demo-api` answers, `reader.ts`), and every write on one is refused before a
 * request. Real school ids are UUIDs, so the prefix cannot meet one.
 */
const demoSchoolPattern = /^demo-[a-z0-9-]+$/;

export const isDemoSchool = (school: string): boolean =>
	demoSchoolPattern.test(school);

export const demoReadOnlyText = "Demo school: read-only";

/** Any write on a demo school, before a request. */
export const demoReadOnly = (call: string): AdapterError =>
	new AdapterError(
		"read_only",
		`${demoReadOnlyText}. ${call} changes nothing here.`,
		{ code: "demo_read_only" },
	);
