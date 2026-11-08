import type { Layer } from "effect";
import type { Clock as CalendarClock } from "$contract/data/types.ts";
import { createFixtureReader } from "$contract/fixtures/reader.ts";
import { createFixtureWriter } from "$contract/fixtures/writer.ts";
import { createHttpAdapters } from "$contract/http/adapters.ts";
import type { StorageLike } from "$contract/http/pending.ts";
import { type Fetch, timerScheduler } from "$contract/http/transport.ts";
import { createFetchWorkerSource } from "$contract/http/worker-source.ts";
import type { FileSaver } from "$contract/http/writer.ts";
import { type AppServices, appLayer } from "./app-layer.ts";
import type { ConfigApi } from "./config-client.ts";
import { createFixtureConfig } from "./config-fixture.ts";
import { createHttpConfig } from "./config-http.ts";
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
}): Layer.Layer<AppServices> {
	const reader = createFixtureReader({ clock: options.calendar });
	return appLayer({
		reader,
		writer: createFixtureWriter({ mode: options.writerMode ?? "instant" }),
		config:
			options.config ??
			createFixtureConfig({
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

/** The HTTP layer: the Preact package's HTTP adapters (S8e), imported read-only, on buzz-school's routes at
 * `apiBase` and the ledger Worker's at `workerBase`. The browser entry supplies fetch, storage and keys, so that
 * this layer reads no global itself. */
export function httpLayer(options: {
	fetch: Fetch;
	apiBase: string;
	workerBase: string;
	storage: StorageLike;
	newKey: () => string;
	files: FileSaver;
	clockLayer?: Layer.Layer<Clock>;
}): Layer.Layer<AppServices> {
	const { reader, writer, tokens } = createHttpAdapters({
		fetch: options.fetch,
		apiBase: options.apiBase,
		scheduler: timerScheduler,
		storage: options.storage,
		newKey: options.newKey,
		worker: (tokens) =>
			createFetchWorkerSource({
				fetch: options.fetch,
				base: options.workerBase,
				tokens,
				scheduler: timerScheduler,
			}),
		files: options.files,
	});
	return appLayer({
		reader,
		writer,
		config: createHttpConfig({
			fetch: options.fetch,
			base: options.workerBase,
			tokens,
		}),
		...(options.clockLayer ? { clockLayer: options.clockLayer } : {}),
	});
}
