import type { Layer } from "effect";
import type { Reader as ReaderContract } from "$contract/data/reader.ts";
import type { Writer as WriterContract } from "$contract/data/writer.ts";
import { createHttpAdapters } from "$contract/http/adapters.ts";
import type { LedgerTokenSource } from "$contract/http/ledger-token.ts";
import type { StorageLike } from "$contract/http/pending.ts";
import type { HttpReader } from "$contract/http/reader.ts";
import { type Fetch, timerScheduler } from "$contract/http/transport.ts";
import { createFetchWorkerSource } from "$contract/http/worker-source.ts";
import type { FileSaver } from "$contract/http/writer.ts";
import { type AppServices, appLayer } from "./app-layer.ts";
import type { ConfigApi } from "./config-client.ts";
import { createHttpConfig } from "./config-http.ts";
import type { Clock } from "./services.ts";

/** The HTTP build's layer, apart from the fixture layer (layers.ts): this module imports no fixture, so that the HTTP
 * build holds none of the fixture schools' names (the staging check reads them, scripts/check-http-build.ts). */

/** The HTTP build's services before they are a layer: the Preact package's HTTP adapters (S8e), imported read-only, on
 * buzz-school's routes at `apiBase` and the ledger Worker's at `workerBase`, and the config client on the Worker's.
 * The browser entry supplies fetch, storage and keys, so that this reads no global itself. The entry reads
 * `reader.session()` once the schools are read, to know whether the visitor sees only the demo schools. */
export function createHttpServices(options: {
	fetch: Fetch;
	apiBase: string;
	workerBase: string;
	storage: StorageLike;
	newKey: () => string;
	files: FileSaver;
}): {
	reader: HttpReader;
	writer: WriterContract;
	tokens: LedgerTokenSource;
	config: ConfigApi;
} {
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
	return {
		reader,
		writer,
		tokens,
		config: createHttpConfig({
			fetch: options.fetch,
			base: options.workerBase,
			tokens,
		}),
	};
}

/** The HTTP layer over services (`createHttpServices`); `reader` replaces theirs with one that answers the same (the
 * entry's first load hands the app the reads it began before the app mounted). */
export function httpLayerOf(
	services: ReturnType<typeof createHttpServices>,
	options: { reader?: ReaderContract; clockLayer?: Layer.Layer<Clock> } = {},
): Layer.Layer<AppServices> {
	return appLayer({
		reader: options.reader ?? services.reader,
		writer: services.writer,
		config: services.config,
		...(options.clockLayer ? { clockLayer: options.clockLayer } : {}),
	});
}

/** The HTTP layer: `httpLayerOf` over fresh services. */
export function httpLayer(options: {
	fetch: Fetch;
	apiBase: string;
	workerBase: string;
	storage: StorageLike;
	newKey: () => string;
	files: FileSaver;
	clockLayer?: Layer.Layer<Clock>;
}): Layer.Layer<AppServices> {
	return httpLayerOf(createHttpServices(options), {
		...(options.clockLayer ? { clockLayer: options.clockLayer } : {}),
	});
}
