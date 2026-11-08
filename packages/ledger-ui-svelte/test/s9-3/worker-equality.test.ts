import { beforeAll, describe, expect, mock, test } from "bun:test";
import { Effect } from "effect";
import { bytesOf, canonicalJson } from "$worker-config/canonical.ts";
import type { ConfigName } from "$worker-config/types.ts";
import type { ConfigApi } from "../../src/effect/config-client.ts";
import { createFixtureConfig } from "../../src/effect/config-fixture.ts";
import type { UiError } from "../../src/effect/ui-error.ts";
import { fixtureObjects, hashOf, settle } from "./config-support.ts";

/**
 * The fixture ConfigClient against the REAL ledger Worker routes (packages/ledger-worker/src/routes/config.ts, imported
 * read-only by path), side by side: the same seeded objects, the same case, and what each answers (status, code, problems,
 * the hash, the ETag, `changed`) compared. The Worker runs over a memory Store with the interface the R2 store has; its one
 * import of the views reader (`tfd/worker`, the freshness of the answer) is replaced by "no views yet", which is what the
 * routes do with a school that has none. A drift of the fixture from the Worker (the order of the checks, a code, a status,
 * a hash) fails here, not only in a test that the fixture agrees with itself.
 */
type Reply =
	| {
			ok: true;
			status: number;
			data: Record<string, unknown>;
			etag: string | null;
	  }
	| { ok: false; status: number; code: string; problems?: unknown };

type Grant = { role: string; finance: boolean };
const NOW = Date.parse("2026-11-05T12:00:00Z");
const SCHOOL = "vol";

class MemoryStore {
	readonly objects = new Map<string, { body: Uint8Array; etag: string }>();
	#counter = 0;
	async get(key: string) {
		const found = this.objects.get(key);
		if (!found)
			throw Object.assign(new Error("not found"), { name: "NotFound" });
		return { body: found.body, etag: found.etag };
	}
	async putIfAbsent(key: string, body: Uint8Array) {
		if (this.objects.has(key))
			throw Object.assign(new Error("exists"), { name: "AlreadyExists" });
		this.#counter += 1;
		this.objects.set(key, { body, etag: `e${this.#counter}` });
	}
	async putIfMatch(key: string, body: Uint8Array, etag: string) {
		const found = this.objects.get(key);
		if (!found) throw Object.assign(new Error("gone"), { name: "NotFound" });
		if (found.etag !== etag)
			throw Object.assign(new Error("stale"), { name: "Stale" });
		this.#counter += 1;
		this.objects.set(key, { body, etag: `e${this.#counter}` });
	}
}

type Routes = {
	readConfigRoute: (context: unknown) => Promise<Response>;
	verifyConfigRoute: (context: unknown) => Promise<Response>;
	putConfigRoute: (context: unknown) => Promise<Response>;
};
let routes: Routes;
beforeAll(async () => {
	mock.module("tfd/worker", () => ({
		readViewsFromStore: async () => ({ ok: false }),
	}));
	const href = new URL(
		"../../../ledger-worker/src/routes/config.ts",
		import.meta.url,
	).href;
	routes = (await import(href)) as Routes;
});

/** A world: the Worker's store and the fixture's, holding the same objects, and the same grant and step-up. */
async function world(options: {
	grant: Grant;
	stepUp: boolean;
	present?: ConfigName[];
}) {
	const store = new MemoryStore();
	const fixture = createFixtureConfig({
		grant: (school) =>
			school === SCHOOL
				? {
						role: options.grant.role as "owner" | "admin",
						finance: options.grant.finance,
					}
				: null,
		stepUp: options.stepUp,
	});
	const objects = (await fixtureObjects(SCHOOL, "vol")) as unknown as Record<
		string,
		unknown
	>;
	for (const name of options.present ?? ["plans-draft"]) {
		const value = objects[name];
		await store.putIfAbsent(
			`schools/${SCHOOL}/config/${name}.json`,
			bytesOf(canonicalJson(value)),
		);
		await fixture.writeBehind(SCHOOL, name as ConfigName, value);
	}
	return { store, fixture, objects };
}

const workerReply = async (
	store: MemoryStore,
	grant: Grant,
	stepUp: boolean,
	call: "read" | "verify" | "put",
	name: string,
	request: { body?: unknown; ifMatch?: string; ifNoneMatch?: string } = {},
): Promise<Reply> => {
	const headers = new Headers();
	if (request.ifMatch) headers.set("if-match", `"${request.ifMatch}"`);
	if (request.ifNoneMatch) headers.set("if-none-match", request.ifNoneMatch);
	const context = {
		store,
		school: SCHOOL,
		name,
		grant,
		subject: "profile_1",
		stepUpAt: stepUp ? Math.floor(NOW / 1000) : null,
		now: NOW,
		request: new Request(
			`https://ledger.test/v1/schools/${SCHOOL}/config/${name}`,
			{
				method: call === "read" ? "GET" : call === "verify" ? "POST" : "PUT",
				headers,
				...(request.body === undefined
					? {}
					: { body: JSON.stringify(request.body) }),
			},
		),
	};
	const route =
		call === "read"
			? routes.readConfigRoute
			: call === "verify"
				? routes.verifyConfigRoute
				: routes.putConfigRoute;
	try {
		const response = await route(context);
		const body = (await response.json()) as { data: Record<string, unknown> };
		return {
			ok: true,
			status: response.status,
			data: body.data,
			etag: response.headers.get("etag"),
		};
	} catch (error) {
		const failure = error as {
			status: number;
			code: string;
			problems?: unknown;
		};
		return {
			ok: false,
			status: failure.status,
			code: failure.code,
			...(failure.problems === undefined ? {} : { problems: failure.problems }),
		};
	}
};

/** The fixture's answer in the Worker's terms: status 200 and the data (plus the ETag), or the refusal's status and code. */
const fixtureReply = async (
	api: ConfigApi,
	call: "read" | "verify" | "put",
	name: ConfigName,
	request: { value?: unknown; hash?: string; base?: string | null },
): Promise<Reply> => {
	const effect: Effect.Effect<
		{ data: Record<string, unknown>; etag: string | null },
		UiError
	> =
		call === "read"
			? Effect.map(api.get(SCHOOL, name), (read) => ({
					data: read.value as unknown as Record<string, unknown>,
					etag: `"${read.etag}"`,
				}))
			: call === "verify"
				? Effect.map(
						api.verify(SCHOOL, name, request.value as never),
						(verdict) => ({
							data: verdict as unknown as Record<string, unknown>,
							etag: null,
						}),
					)
				: Effect.map(
						api.put(
							SCHOOL,
							name,
							request.value as never,
							request.hash ?? "",
							request.base ?? null,
						),
						(done) => ({
							data: done as unknown as Record<string, unknown>,
							etag: `"${done.sha256}"`,
						}),
					);
	const done = await settle(effect);
	if (done.ok) return { ok: true, status: 200, ...done.value };
	const { detail } = done.error;
	return {
		ok: false,
		status: detail.status ?? 0,
		code: detail.code ?? "",
		...(detail.problems === undefined ? {} : { problems: detail.problems }),
	};
};

/** What both must agree on: status, code, problems, and for an answer its data (the Worker's `bytes` and `asOf` aside) and ETag. */
const comparable = (reply: Reply) =>
	reply.ok
		? {
				ok: true,
				status: reply.status,
				etag: reply.etag,
				data: Object.fromEntries(
					Object.entries(reply.data).filter(([key]) => key !== "bytes"),
				),
			}
		: reply;

const OWNER: Grant = { role: "owner", finance: true };
const ADMIN: Grant = { role: "admin", finance: false };

describe("the fixture store answers what the Worker's routes answer", () => {
	const cases: Array<{
		name: string;
		grant?: Grant;
		stepUp?: boolean;
		call: "read" | "verify" | "put";
		object?: ConfigName;
		present?: ConfigName[];
		build: (
			objects: Record<string, unknown>,
			hash: (value: unknown) => Promise<string>,
		) => Promise<{
			value?: unknown;
			hash?: string;
			base?: string | null | "stored";
		}>;
	}> = [
		{ name: "read of a stored object", call: "read", build: async () => ({}) },
		{
			name: "read of an object not stored yet",
			call: "read",
			present: [],
			build: async () => ({}),
		},
		{
			name: "read of a money-bearing object without the finance grant",
			call: "read",
			grant: { role: "owner", finance: false },
			object: "promos",
			present: ["promos"],
			build: async () => ({}),
		},
		{
			name: "verify of a valid change",
			call: "verify",
			build: async (objects) => ({
				value: {
					...(objects["plans-draft"] as object),
					purchaseLinkShared: false,
				},
			}),
		},
		{
			name: "verify of an invalid value",
			call: "verify",
			build: async (objects) => ({
				value: {
					...(objects["plans-draft"] as object),
					tierOrder: [],
					extra: 1,
				},
			}),
		},
		{
			name: "verify by an admin",
			call: "verify",
			grant: ADMIN,
			build: async (objects) => ({ value: objects["plans-draft"] }),
		},
		{
			name: "verify of an object not stored yet",
			call: "verify",
			present: [],
			build: async (objects) => ({ value: objects["plans-draft"] }),
		},
		{
			name: "put of a verified value over the stored ETag",
			call: "put",
			build: async (objects, hash) => {
				const value = {
					...(objects["plans-draft"] as object),
					purchaseLinkShared: false,
				};
				return { value, hash: await hash(value), base: "stored" };
			},
		},
		{
			name: "put of the value already stored",
			call: "put",
			build: async (objects, hash) => ({
				value: objects["plans-draft"],
				hash: await hash(objects["plans-draft"]),
				base: "stored",
			}),
		},
		{
			name: "put over a stale ETag",
			call: "put",
			build: async (objects, hash) => {
				const value = {
					...(objects["plans-draft"] as object),
					purchaseLinkShared: false,
				};
				return { value, hash: await hash(value), base: "0".repeat(64) };
			},
		},
		{
			name: "put creating an object (If-None-Match: *) that exists",
			call: "put",
			build: async (objects, hash) => ({
				value: objects["plans-draft"],
				hash: await hash(objects["plans-draft"]),
				base: null,
			}),
		},
		{
			name: "put creating an object that does not exist",
			call: "put",
			present: [],
			build: async (objects, hash) => ({
				value: objects["plans-draft"],
				hash: await hash(objects["plans-draft"]),
				base: null,
			}),
		},
		{
			name: "put with a forged hash",
			call: "put",
			build: async (objects, hash) => {
				const value = {
					...(objects["plans-draft"] as object),
					purchaseLinkShared: false,
				};
				return {
					value,
					hash: await hash(objects["plans-draft"]),
					base: "stored",
				};
			},
		},
		{
			name: "put with a malformed hash",
			call: "put",
			build: async (objects) => ({
				value: {
					...(objects["plans-draft"] as object),
					purchaseLinkShared: false,
				},
				hash: "nope",
				base: "stored",
			}),
		},
		{
			name: "put of an invalid value",
			call: "put",
			build: async (objects, hash) => {
				const value = { ...(objects["plans-draft"] as object), tierOrder: [] };
				return { value, hash: await hash(value), base: "stored" };
			},
		},
		{
			name: "put by an admin",
			call: "put",
			grant: ADMIN,
			build: async (objects, hash) => ({
				value: objects["plans-draft"],
				hash: await hash(objects["plans-draft"]),
				base: "stored",
			}),
		},
		{
			name: "put without a fresh step-up",
			call: "put",
			stepUp: false,
			build: async (objects, hash) => {
				const value = {
					...(objects["plans-draft"] as object),
					purchaseLinkShared: false,
				};
				return { value, hash: await hash(value), base: "stored" };
			},
		},
		{
			name: "put without a step-up and with an invalid value (the gate comes first)",
			call: "put",
			stepUp: false,
			build: async (objects, hash) => {
				const value = { ...(objects["plans-draft"] as object), tierOrder: [] };
				return { value, hash: await hash(value), base: "stored" };
			},
		},
	];
	for (const item of cases)
		test(item.name, async () => {
			const grant = item.grant ?? OWNER;
			const stepUp = item.stepUp ?? true;
			const object = item.object ?? "plans-draft";
			const { store, fixture, objects } = await world({
				grant,
				stepUp,
				present: item.present ?? [object],
			});
			const built = await item.build(objects, hashOf);
			const stored = await fixture.peek(SCHOOL, object);
			const base =
				built.base === "stored" ? (stored?.etag ?? null) : (built.base ?? null);
			const worker = await workerReply(
				store,
				grant,
				stepUp,
				item.call,
				object,
				{
					...(item.call === "read"
						? {}
						: {
								body:
									item.call === "verify"
										? { value: built.value }
										: { value: built.value, verifiedHash: built.hash },
							}),
					...(item.call === "put"
						? base === null
							? { ifNoneMatch: "*" }
							: { ifMatch: base }
						: {}),
				},
			);
			const ours = await fixtureReply(fixture, item.call, object, {
				value: built.value,
				hash: built.hash ?? "",
				base,
			});
			expect(comparable(ours)).toEqual(comparable(worker));
			// And whatever each stored afterwards is the same bytes: the hash of the canonical text.
			if (worker.ok && item.call === "put") {
				const after = await store.get(
					`schools/${SCHOOL}/config/${object}.json`,
				);
				const digest = Array.from(
					new Uint8Array(await crypto.subtle.digest("SHA-256", after.body)),
					(byte) => byte.toString(16).padStart(2, "0"),
				).join("");
				expect(fixture.peek(SCHOOL, object)?.etag).toBe(digest);
			}
		});
});
