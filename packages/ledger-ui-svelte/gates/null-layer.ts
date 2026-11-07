import { Layer } from "effect";
import type { Reader as ReaderContract } from "$contract/data/reader.ts";
import type { Writer as WriterContract } from "$contract/data/writer.ts";
import { liveClockLayer } from "../src/effect/clock.ts";
import type { AppServices } from "../src/effect/layers.ts";
import { memoryLogLayer } from "../src/effect/log.ts";
import { Reader, Writer } from "../src/effect/services.ts";
import { toastsLayer } from "../src/effect/toasts.ts";

export const sizeCalendar = { today: "2026-11-05", now: "2026-11-05T12:00" };

/** Adapters whose every call stays pending: the size build measures the app without any data or fixture code. */
const pending = new Proxy(
	{},
	{ get: () => () => new Promise(() => undefined) },
);

export const nullLayer: Layer.Layer<AppServices> = Layer.mergeAll(
	Layer.succeed(Reader, pending as ReaderContract),
	Layer.succeed(Writer, pending as WriterContract),
	Layer.mergeAll(toastsLayer, memoryLogLayer).pipe(
		Layer.provideMerge(liveClockLayer(sizeCalendar)),
	),
);
