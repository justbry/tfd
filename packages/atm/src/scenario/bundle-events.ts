/**
 * A committed scenario bundle (`fixtures/scenarios/<id>/`) as the event log a school's shipper would hold: the events the
 * bundle's steps write through the engine, led by one `catalog.published` per menu version the bundle serves, so a reader
 * that takes its catalogs from the log (`membersOf`, `buildViews`) replays members who bought on different versions.
 * For tests and staging checks that need a log of credit events (`packages/ledger-worker`); nothing here runs in a Worker.
 */
import { catalogPublishedEvent } from "../ledger/catalog.js";
import type { AtmEvent } from "../types.js";
import { loadScenarioBundle, resolveBundleDirectory } from "./bundle.js";
import { runBundle } from "./bundle-run.js";

export type BundleLog = {
	school: string;
	/** `catalog.published` events (version order), then the bundle's events. */
	events: AtmEvent[];
	/** The menu versions the log publishes, ascending. */
	versions: string[];
};

export const bundleLog = async (id: string): Promise<BundleLog> => {
	const bundle = await loadScenarioBundle(resolveBundleDirectory(id));
	const run = await runBundle(bundle, { channels: [] });
	try {
		const { school, menu, menus } = bundle.scenario;
		const events = run.schools.find((entry) => entry.school === school)?.events;
		const first = events?.[0];
		if (events === undefined || first === undefined)
			throw new Error(`bundle ${id} wrote no events for ${school}`);
		const versions = Object.keys(menus ?? { 1: menu }).sort(
			(a, b) => Number(a) - Number(b),
		);
		const published = versions.map((version) =>
			catalogPublishedEvent({
				school,
				menu: menus?.[version] ?? menu,
				version: Number(version),
				eventTime: first.event_time,
			}),
		);
		return { school, events: [...published, ...events], versions };
	} finally {
		await run.dispose();
	}
};
