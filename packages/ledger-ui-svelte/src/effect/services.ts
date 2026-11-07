import { Context, type Effect } from "effect";
import type { Reader as ReaderContract } from "$contract/data/reader.ts";
import type { Writer as WriterContract } from "$contract/data/writer.ts";
import type { ToastInput, ToastPatch, ToastState } from "./toast-model.ts";

/** The services of the Svelte app's data layer (S9-plan section 5). The shared Reader and Writer stay promise-based;
 * these tags carry them, and `run` turns their calls into effects. A layer provides each: the fixture layer in tests
 * and the fixture build, the HTTP layer in the HTTP build. */
export class Reader extends Context.Service<Reader, ReaderContract>()(
	"ledger-ui-svelte/Reader",
) {}

export class Writer extends Context.Service<Writer, WriterContract>()(
	"ledger-ui-svelte/Writer",
) {}

/** The toasts' clock: the wait before a success or info toast leaves, so that a test can move it by hand. The
 * calendar (today, now) is the app context's, from the entry; retries back off on Effect's own clock. */
export class Clock extends Context.Service<
	Clock,
	{ readonly sleep: (milliseconds: number) => Effect.Effect<void> }
>()("ledger-ui-svelte/Clock") {}

/** The toast queue (section 5). `subscribe` is the synchronous edge the Svelte rune store reads: it hands the
 * listener the current state at once, then every change. */
export class Toasts extends Context.Service<
	Toasts,
	{
		readonly show: (toast: ToastInput) => Effect.Effect<string>;
		readonly update: (id: string, patch: ToastPatch) => Effect.Effect<void>;
		readonly dismiss: (id: string) => Effect.Effect<void>;
		readonly subscribe: (listener: (state: ToastState) => void) => () => void;
	}
>()("ledger-ui-svelte/Toasts") {}

export type LogEntry = {
	level: "error" | "warning";
	message: string;
	cause?: unknown;
};

/** Where an unexpected failure is written, never `console` (log.ts keeps it in memory). */
export class Log extends Context.Service<
	Log,
	{ readonly write: (entry: LogEntry) => Effect.Effect<void> }
>()("ledger-ui-svelte/Log") {}
