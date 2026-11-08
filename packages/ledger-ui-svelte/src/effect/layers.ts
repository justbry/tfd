import type { Layer } from "effect";
import type { Clock as CalendarClock } from "$contract/data/types.ts";
import { createFixtureReader } from "$contract/fixtures/reader.ts";
import { createFixtureWriter } from "$contract/fixtures/writer.ts";
import { type AppServices, appLayer } from "./app-layer.ts";
import type { ConfigApi } from "./config-client.ts";
import { createFixtureConfig } from "./config-fixture.ts";
import type { Clock } from "./services.ts";

/** The fixture layer (tests, the fixture build): the Preact package's fixture Reader and Writer, imported read-only,
 * on the mockup's calendar. `clockLayer` lets a test move time by hand. */
export function fixtureLayer(options: {
	calendar: CalendarClock;
	clockLayer?: Layer.Layer<Clock>;
	writerMode?: "instant" | "hold";
	/** The config client; by default an in-memory store that follows the Worker's rules, the person holding each
	 * fixture school's role (an owner has the finance grant, an admin does not). */
	config?: ConfigApi;
	/** A state of the default config store for the fixture build's reviews (`#/…?config=stale|step-up`): "stale" has
	 * someone else write the copy before it is verified (a 412), "step-up" has no fresh `su` (a 403). */
	configScenario?: "stale" | "step-up";
}): Layer.Layer<AppServices> {
	const reader = createFixtureReader({ clock: options.calendar });
	return appLayer({
		reader,
		writer: createFixtureWriter({ mode: options.writerMode ?? "instant" }),
		config:
			options.config ??
			createFixtureConfig({
				stepUp: options.configScenario !== "step-up",
				concurrentWriter: options.configScenario === "stale",
				grant: async (school) => {
					const found = (await reader.schools()).find(
						({ id }) => id === school,
					);
					return found
						? { role: found.role, finance: found.role === "owner" }
						: null;
				},
			}),
		...(options.clockLayer ? { clockLayer: options.clockLayer } : {}),
	});
}
