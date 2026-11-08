import { Effect } from "effect";
import type { MenuVersionBody, PlanSummary } from "$contract/data/plans.ts";
import type { School } from "$contract/data/types.ts";
import { recoverFrom } from "../../effect/config-save.ts";
import { read } from "../../effect/run.ts";
import { Log } from "../../effect/services.ts";
import { emptyMenu, type PlansSession } from "./plans-menu.ts";

const noStripe: MenuVersionBody["stripe"] = {
	products: [],
	prices: [],
	portal: false,
};

/** The menu half of what the Plans tab starts from: the newest published version is live, an unpublished newer one is
 * the saved draft (otherwise the draft starts as a copy of the live menu), and a school with no version starts empty
 * (from the summary's features, so it comes second). Its own read, apart from the summary's: each fails, retries and
 * toasts on its own. */
export const loadMenu = (school: School) =>
	Effect.gen(function* () {
		const { versions } = yield* read((reader) => reader.menuVersions(school.id));
		const published = versions.find(({ publishedAt }) => publishedAt !== null);
		const newest = versions[0];
		const saved = newest && newest.publishedAt === null ? newest : undefined;
		const liveBody = published
			? yield* read((reader) => reader.menuVersion(school.id, published.version))
			: undefined;
		const draftBody = saved
			? yield* read((reader) => reader.menuVersion(school.id, saved.version))
			: undefined;
		return { liveBody, draftBody };
	});

export type LoadedMenu = Effect.Success<ReturnType<typeof loadMenu>>;

/** The counts, collected and Get started facts: where nothing provides them (the HTTP build) the read fails with
 * `not_available` and the pane says so, never a 0 and never fixture data. */
export const loadSummary = (school: School) =>
	read((reader) => reader.planSummary(school.id));

/** The session the tab keeps, from its two reads. */
export function sessionOf(
	school: School,
	{ liveBody, draftBody }: LoadedMenu,
	summary: PlanSummary,
): PlansSession {
	const live =
		liveBody?.menu ??
		emptyMenu(school.currency, school.timeZone, summary.features);
	const draft = draftBody?.menu ?? live;
	return {
		version: liveBody?.version ?? 0,
		live,
		stripe: liveBody?.stripe ?? noStripe,
		draft,
		summary,
		yamlText: null,
		saveStatus: "saved",
		savesStarted: 0,
		lastSave: Promise.resolve(true),
	};
}

/** The re-read of a version after a publish: its Stripe facts when it can be read; when it cannot, the pane works the
 * facts out from the draft, and the log keeps why. */
export const readPublished = (school: string, version: number) =>
	read((reader) => reader.menuVersion(school, version)).pipe(
		(effect) =>
			recoverFrom(
				effect,
				() => true,
				(error) =>
					Log.use((log) =>
						log.write({
							level: "warning",
							message: `the published version ${version} could not be re-read: ${error.reason}`,
						}),
					).pipe(Effect.map(() => undefined)),
			),
	);
