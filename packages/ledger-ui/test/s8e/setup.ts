import type { DownloadFile } from "../../src/data/ledger.ts";
import { createHttpAdapters } from "../../src/http/adapters.ts";
import {
	createFetchWorkerSource,
	notConnectedWorker,
} from "../../src/http/worker-source.ts";
import type { PinSource } from "../../src/http/writer.ts";
import {
	type Answer,
	apiBase,
	fakeFetch,
	manualScheduler,
	memoryStore,
	sequentialKeys,
} from "./helpers.ts";
import { ledgerTokenAnswer } from "./recorded.ts";

export const workerBase = "https://ledger.b4uni.test/v1";

/** The adapters over one fake fetch (buzz-school and, when `worker` is "fetch", the section 11 Worker). */
export function adapters(
	options: {
		worker?: "not_connected" | "fetch";
		pin?: string | null;
		storage?: ReturnType<typeof memoryStore>;
		schools?: Parameters<typeof ledgerTokenAnswer>[0];
		/** The ledger-token answer, every time (default: the recorded token). */
		token?: Answer;
	} = {},
) {
	const http = fakeFetch();
	const scheduler = manualScheduler();
	const storage = options.storage ?? memoryStore();
	const saved: DownloadFile[] = [];
	const pinAsks: Array<{ school: string; purpose: string }> = [];
	const pinSource: PinSource = {
		pin: async (query) => {
			pinAsks.push(query);
			return options.pin === undefined ? "4821" : options.pin;
		},
	};
	http.always(
		"POST",
		/\/school-admin\/ledger-token$/,
		options.token ?? { status: 200, body: ledgerTokenAnswer(options.schools) },
	);
	const built = createHttpAdapters({
		fetch: http.fetch,
		apiBase,
		scheduler,
		storage,
		newKey: sequentialKeys(),
		worker: (tokens) =>
			options.worker === "fetch"
				? createFetchWorkerSource({
						fetch: http.fetch,
						base: workerBase,
						tokens,
						scheduler,
					})
				: notConnectedWorker(),
		files: { save: async (file) => void saved.push(file) },
		pinSource,
	});
	return { ...built, http, scheduler, storage, saved, pinAsks };
}

/** The buzz-school calls only (the ledger token is fetched by every adapter that needs it). */
export const apiCalls = (http: ReturnType<typeof fakeFetch>) =>
	http.calls.filter(
		({ url }) =>
			url.startsWith(apiBase) && !url.endsWith("/school-admin/ledger-token"),
	);
