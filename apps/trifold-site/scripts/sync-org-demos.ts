/**
 * Copies the five demo orgs' KPI dashboards and their gallery from plans/ledger-ui/design/mart/orgs/ (made by
 * `cd packages/atm && bun run org-demos`) into static/demo/orgs/, byte for byte. Run with `bun run org-demos:sync`
 * after regenerating them; tests/org-demos.test.ts fails while a copy differs from its source.
 */
import { copyFile, mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";

export const ORG_DEMOS_SOURCE = join(
	import.meta.dir,
	"../../../plans/ledger-ui/design/mart/orgs",
);
export const ORG_DEMOS_TARGET = join(import.meta.dir, "../static/demo/orgs");

/** The pages to copy: every .html file in the source folder (the gallery and one page per org). */
export async function orgDemoFiles(): Promise<string[]> {
	const entries = await readdir(ORG_DEMOS_SOURCE);
	return entries.filter((file) => file.endsWith(".html")).sort();
}

if (import.meta.main) {
	const files = await orgDemoFiles();
	await mkdir(ORG_DEMOS_TARGET, { recursive: true });
	for (const file of files)
		await copyFile(join(ORG_DEMOS_SOURCE, file), join(ORG_DEMOS_TARGET, file));
	console.log(`org demos: copied ${files.join(", ")} to static/demo/orgs/`);
}
