import {
	createLedgerTokenSource,
	type LedgerTokenSource,
} from "./ledger-token.ts";
import {
	createPendingStore,
	type PendingStore,
	type StorageLike,
} from "./pending.ts";
import { createHttpReader, type HttpReader } from "./reader.ts";
import { createApiClient, type Fetch, type Scheduler } from "./transport.ts";
import type { WorkerSource } from "./worker-source.ts";
import { createHttpWriter, type FileSaver, type PinSource } from "./writer.ts";

/** One Reader and one Writer over the same session, ledger token and pending store. `worker` is part 1's
 * `notConnectedWorker()` or the fetch source of section 11 (`createFetchWorkerSource`), which needs `tokens`. */
export function createHttpAdapters(options: {
	fetch: Fetch;
	/** `https://api.b4uni.com`. */
	apiBase: string;
	scheduler: Scheduler;
	storage: StorageLike;
	newKey: () => string;
	worker: (tokens: LedgerTokenSource) => WorkerSource;
	files: FileSaver;
	pinSource?: PinSource;
}): {
	reader: HttpReader;
	writer: ReturnType<typeof createHttpWriter>;
	tokens: LedgerTokenSource;
	pending: PendingStore;
} {
	const api = createApiClient({
		fetch: options.fetch,
		base: options.apiBase,
		scheduler: options.scheduler,
	});
	const tokens = createLedgerTokenSource({ api, scheduler: options.scheduler });
	const pending = createPendingStore({
		storage: options.storage,
		newKey: options.newKey,
	});
	const worker = options.worker(tokens);
	return {
		reader: createHttpReader({ api, worker, tokens, pending }),
		writer: createHttpWriter({
			api,
			tokens,
			pending,
			files: options.files,
			...(options.pinSource ? { pinSource: options.pinSource } : {}),
		}),
		tokens,
		pending,
	};
}
