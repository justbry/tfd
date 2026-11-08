import { Layer } from "effect";
import type { Reader as ReaderContract } from "$contract/data/reader.ts";
import type { Writer as WriterContract } from "$contract/data/writer.ts";
import { liveClockLayer } from "./clock.ts";
import { memoryLog } from "./log.ts";
import {
	type Clock,
	type Log,
	Reader,
	type Toasts,
	Writer,
} from "./services.ts";
import { toastsLayer } from "./toasts.ts";

export type AppServices = Reader | Writer | Clock | Toasts | Log;

/** The one composition of the app's services: a Reader and a Writer, the toasts and the log over a clock (the
 * browser's unless a test passes one moved by hand). The fixture and HTTP layers (layers.ts) and the size gate's
 * null adapters all build on it; it imports no adapter, so the size build stays free of them. */
export const appLayer = (options: {
	reader: ReaderContract;
	writer: WriterContract;
	clockLayer?: Layer.Layer<Clock>;
}): Layer.Layer<AppServices> =>
	Layer.mergeAll(
		Layer.succeed(Reader, options.reader),
		Layer.succeed(Writer, options.writer),
		Layer.mergeAll(toastsLayer, memoryLog().layer).pipe(
			Layer.provideMerge(options.clockLayer ?? liveClockLayer),
		),
	);
