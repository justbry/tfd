import { Layer } from "effect";
import type { Clock as CalendarClock } from "$contract/data/types.ts";
import { createFixtureReader } from "$contract/fixtures/reader.ts";
import { createFixtureWriter } from "$contract/fixtures/writer.ts";
import { createHttpAdapters } from "$contract/http/adapters.ts";
import type { StorageLike } from "$contract/http/pending.ts";
import { type Fetch, timerScheduler } from "$contract/http/transport.ts";
import { createFetchWorkerSource } from "$contract/http/worker-source.ts";
import type { FileSaver } from "$contract/http/writer.ts";
import { liveClockLayer } from "./clock.ts";
import { memoryLogLayer } from "./log.ts";
import {
	type Clock,
	type Log,
	Reader,
	type Toasts,
	Writer,
} from "./services.ts";
import { toastsLayer } from "./toasts.ts";

export type AppServices = Reader | Writer | Clock | Toasts | Log;

/** Toasts and the log over a clock layer: what every app layer shares. */
const uiLayer = (clockLayer: Layer.Layer<Clock>) =>
	Layer.mergeAll(toastsLayer, memoryLogLayer).pipe(
		Layer.provideMerge(clockLayer),
	);

/** The fixture layer (tests, the fixture build): the Preact package's fixture Reader and Writer, imported read-only,
 * on the mockup's calendar. `clockLayer` lets a test move time by hand. */
export function fixtureLayer(options: {
	calendar: CalendarClock;
	clockLayer?: Layer.Layer<Clock>;
	writerMode?: "instant" | "hold";
}): Layer.Layer<AppServices> {
	return Layer.mergeAll(
		Layer.succeed(Reader, createFixtureReader({ clock: options.calendar })),
		Layer.succeed(
			Writer,
			createFixtureWriter({ mode: options.writerMode ?? "instant" }),
		),
		uiLayer(options.clockLayer ?? liveClockLayer(options.calendar)),
	);
}

/** The HTTP layer: the Preact package's HTTP adapters (S8e), imported read-only, on buzz-school's routes at
 * `apiBase` and the ledger Worker's at `workerBase`. The browser entry supplies fetch, storage, keys and the
 * calendar, so that this layer reads no global itself. */
export function httpLayer(options: {
	fetch: Fetch;
	apiBase: string;
	workerBase: string;
	storage: StorageLike;
	newKey: () => string;
	files: FileSaver;
	calendar: CalendarClock;
	clockLayer?: Layer.Layer<Clock>;
}): Layer.Layer<AppServices> {
	const { reader, writer } = createHttpAdapters({
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
	return Layer.mergeAll(
		Layer.succeed(Reader, reader),
		Layer.succeed(Writer, writer),
		uiLayer(options.clockLayer ?? liveClockLayer(options.calendar)),
	);
}
