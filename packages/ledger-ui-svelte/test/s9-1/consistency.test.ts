import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Disclosure } from "$contract/data/disclosure.ts";
import type { KpiDocument } from "$contract/data/kpi-document.ts";
import type { Reader } from "$contract/data/reader.ts";
import type { Clock } from "$contract/data/types.ts";
import type { Writer } from "$contract/data/writer.ts";
import { createFixtureReader } from "$contract/fixtures/reader.ts";
import { createFixtureWriter } from "$contract/fixtures/writer.ts";
import { mountApp } from "../../src/app/mount.ts";
import { appLayer } from "../../src/effect/app-layer.ts";
import { calendar } from "../helpers.ts";

/**
 * Gate C4 (protocol §5) on the Svelte Dashboard, with the Preact package's own check (its test/consistency-checks.ts,
 * imported in place): for every committed KPI document a school's viewer may preview (the audiences of the View as
 * rows they hold), the app is mounted on the document's route and every view of every shown period is rendered; every
 * `[data-kpi][data-period]` must carry the document's kind, exact text and reason, every day cell its kind and value,
 * and every KPI the view lists must be on screen. The check's mount is the Svelte `mountApp` over the fixture
 * adapters (`appLayer`), behind the Preact mount's signature. The check module is imported by a computed path: its
 * own type imports name the Preact mount (a .tsx file), which this package's type check does not compile.
 */
const contractRoot = join(import.meta.dir, "../../../ledger-ui");
type Mount = (
	root: HTMLElement,
	options: { reader: Reader; writer: Writer; clock: Clock },
) => { unmount(): void };
const { dashboardProblems } = (await import(
	join(contractRoot, "test/consistency-checks.ts")
)) as {
	dashboardProblems: (
		adapters: { mount: Mount; reader: Reader; writer: Writer; clock: Clock },
		expected: KpiDocument,
	) => Promise<{ problems: string[]; renders: number }>;
};
const documents = JSON.parse(
	readFileSync(join(contractRoot, "src/fixtures/mart/documents.json"), "utf8"),
) as Record<string, KpiDocument>;
const disclosures = (
	JSON.parse(
		readFileSync(join(contractRoot, "src/fixtures/disclosure.json"), "utf8"),
	) as { schools: Record<string, Pick<Disclosure, "viewAs">> }
).schools;

/** The documents a school's viewer can reach: the audiences of the View as rows they hold (mockup `vaAllowed`). */
const reachable = (document: KpiDocument): boolean =>
	(disclosures[document.school]?.viewAs ?? []).some(
		(option) => option.value === document.audience && option.held,
	);

/** The Preact mount's signature over the Svelte app: the given Reader and Writer as the app's layer. */
const mountSvelte: Mount = (root, options) => {
	const app = mountApp(root, {
		layer: appLayer({ reader: options.reader, writer: options.writer }),
		calendar: options.clock,
	});
	return {
		unmount: () => {
			app.unmount().then(
				() => undefined,
				(error: unknown) => {
					throw error;
				},
			);
		},
	};
};

/** C4's budget (protocol §5): all mounts and their renders. */
const budgetMilliseconds = 120_000;
let spentMilliseconds = 0;
let renders = 0;
const bySchool = new Map<string, KpiDocument[]>();
for (const document of Object.values(documents))
	if (reachable(document))
		bySchool.set(document.school, [
			...(bySchool.get(document.school) ?? []),
			document,
		]);

describe("C4: the Svelte Dashboard renders every document cell it shows exactly, for every audience a viewer may preview", () => {
	test("every school has documents to check", () => {
		expect([...bySchool.keys()].sort()).toEqual([
			"b4u",
			"har",
			"map",
			"nw",
			"vol",
		]);
	});
	for (const [school, schoolDocuments] of bySchool)
		test(
			school,
			async () => {
				const started = performance.now();
				const problems: string[] = [];
				for (const expected of schoolDocuments) {
					const found = await dashboardProblems(
						{
							mount: mountSvelte,
							reader: createFixtureReader({ clock: calendar }),
							writer: createFixtureWriter({ mode: "instant" }),
							clock: calendar,
						},
						expected,
					);
					renders += found.renders;
					problems.push(...found.problems);
				}
				spentMilliseconds += performance.now() - started;
				expect(problems.slice(0, 25)).toEqual([]);
			},
			budgetMilliseconds,
		);
	test("the matrix runs within its budget", () => {
		process.stdout.write(
			`C4: ${renders} renders in ${(spentMilliseconds / 1000).toFixed(1)} s (budget ${budgetMilliseconds / 1000} s)\n`,
		);
		expect(renders).toBeGreaterThan(0);
		expect(spentMilliseconds).toBeLessThanOrEqual(budgetMilliseconds);
	});
});
