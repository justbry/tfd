/**
 * One Durable Object per note (steps-2-5 plan, W2a). Its SQLite holds that note's event log, chain links, the two
 * parties' contact records, invites, sessions, step-up codes, counters and idempotency records (`do-store.ts`). The
 * Worker reaches it only through `RemoteNoteStore`: one `POST /rpc` per store method, named from an allowlist.
 */
import type { CloudEnv } from "../env";
import type { DurableObjectState } from "../org-do";
import { isStoreMethod, migrateNote, SqliteNoteStore } from "./do-store";
import type { NoteStore } from "./store";

type RpcCall = (...args: unknown[]) => Promise<unknown>;

export class NoteDO {
	private version = 0;
	private readonly store: SqliteNoteStore;

	constructor(state: DurableObjectState, _env: CloudEnv) {
		this.store = new SqliteNoteStore(state);
		void state.blockConcurrencyWhile(async () => {
			this.version = migrateNote(state);
		});
	}

	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);
		if (url.pathname !== "/rpc" || request.method !== "POST")
			return Response.json({ schemaVersion: this.version });
		const body: unknown = await request.json();
		if (typeof body !== "object" || body === null)
			return Response.json({ error: "bad_request" }, { status: 400 });
		const { method, noteId, args } = body as {
			method?: unknown;
			noteId?: unknown;
			args?: unknown;
		};
		if (
			!isStoreMethod(method) ||
			typeof noteId !== "string" ||
			!Array.isArray(args)
		)
			return Response.json({ error: "bad_request" }, { status: 400 });
		const target: NoteStore = this.store;
		const run = target[method].bind(target) as RpcCall;
		const result = await run(noteId, ...args);
		return Response.json({ result: result ?? null });
	}
}
