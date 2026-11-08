import { Cause, Effect, Exit } from "effect";
import { UiError } from "../../src/effect/ui-error.ts";
import type { LedgerToken, LedgerTokenSource } from "$contract/http/ledger-token.ts";
import type { Fetch } from "$contract/http/transport.ts";
import { sha256Hex, bytesOf, canonicalJson } from "$worker-config/canonical.ts";
import type { ConfigApi, ConfigName, ConfigValues } from "../../src/effect/config-client.ts";
import {
	createFixtureConfig,
	type FixtureConfig,
	type FixtureGrant,
} from "../../src/effect/config-fixture.ts";

export const OWNER: FixtureGrant = { role: "owner", finance: true };
export const ADMIN: FixtureGrant = { role: "admin", finance: false };

/** A fixture store where `school` gives the person `grant`; any other school is not in the token. */
export function storeFor(
	grant: FixtureGrant,
	options: { stepUp?: boolean; school?: string } = {},
): FixtureConfig {
	const school = options.school ?? "vol";
	return createFixtureConfig({
		grant: (asked) => (asked === school ? grant : null),
		...(options.stepUp === undefined ? {} : { stepUp: options.stepUp }),
	});
}

/** The Worker's seeder (packages/ledger-worker/src/testing/seed-config.ts): `fixtureObjects` makes the five config objects
 * of a fixture school from the UI's own fixtures. Imported by a computed specifier, because the file's type-only import of
 * `tfd` is not installed in this package. */
const workerSeeds = new URL("../../../ledger-worker/src/testing/seed-config.ts", import.meta.url).href;
type Seeds = { fixtureObjects: (id: string, fixture: string) => ConfigValues };
export const fixtureObjects = async (id: string, fixture: string): Promise<ConfigValues> =>
	((await import(workerSeeds)) as Seeds).fixtureObjects(id, fixture);

/** The Worker's own seeds for the school, written into the store. */
export async function seed(store: FixtureConfig, school = "vol"): Promise<ConfigValues> {
	const objects = await fixtureObjects(school, "vol");
	for (const name of Object.keys(objects) as ConfigName[])
		await store.writeBehind(school, name, objects[name]);
	return objects;
}

export const outcome = <A>(effect: Effect.Effect<A, UiError>) =>
	Effect.runPromiseExit(effect);

/** The value of a success, or the UiError of a failure. */
export async function settle<A>(
	effect: Effect.Effect<A, UiError>,
): Promise<{ ok: true; value: A } | { ok: false; error: UiError }> {
	const exit = await Effect.runPromiseExit(effect);
	if (Exit.isSuccess(exit)) return { ok: true, value: exit.value };
	const failure = Cause.squash(exit.cause);
	if (!(failure instanceof UiError)) throw new Error(`defect: ${String(failure)}`);
	return { ok: false, error: failure };
}

export const hashOf = async (value: unknown): Promise<string> =>
	sha256Hex(bytesOf(canonicalJson(value)));

const tokenSource = (): LedgerTokenSource & { refreshes: number } => {
	const token: LedgerToken = {
		token: "ledger.token.value",
		expiresAt: 4_000_000_000,
		issuedAt: 3_999_999_700,
		subject: "profile_1",
		schools: [{ id: "vol", role: "owner", finance: true }],
	};
	const source = {
		refreshes: 0,
		current: async () => token,
		refresh: async () => {
			source.refreshes += 1;
			return token;
		},
		stop: () => undefined,
	};
	return source;
};

/** The ledger Worker's wire over a fixture store: the same rules, spoken as HTTP (status, envelope, ETag, If-Match),
 * so that the HTTP client is tested against what the Worker answers. `script` can answer a request first. */
export function workerWire(
	store: ConfigApi,
	options: {
		script?: (request: { method: string; url: string }, attempt: number) => Response | undefined;
	} = {},
) {
	const seen: Array<{ method: string; url: string; headers: Record<string, string>; body: unknown }> = [];
	const tokens = tokenSource();
	let attempts = 0;
	const errorBody = (
		status: number,
		code: string,
		message: string,
		extra: Record<string, unknown> = {},
	) =>
		new Response(JSON.stringify({ error: { code, message, ...extra } }), {
			status,
			headers: { "content-type": "application/json" },
		});
	const fetch: Fetch = async (url, init) => {
		const headers = Object.fromEntries(
			Object.entries((init.headers ?? {}) as Record<string, string>),
		);
		const body = init.body ? JSON.parse(String(init.body)) : undefined;
		seen.push({ method: String(init.method), url, headers, body });
		attempts += 1;
		const scripted = options.script?.({ method: String(init.method), url }, attempts);
		if (scripted) return scripted;
		const match = /\/schools\/([^/]+)\/config\/([^/]+?)(\/verify)?$/.exec(url);
		if (!match) return errorBody(404, "not_found", "No such route.");
		const [, school = "", name = "", verify] = match;
		const run = async <A>(effect: Effect.Effect<A, UiError>) => settle(effect);
		const refusal = (error: UiError): Response => {
			const status = error.detail.status ?? 500;
			return errorBody(status, error.detail.code ?? "server", error.reason, {
				...(error.detail.problems ? { problems: error.detail.problems } : {}),
				...(error.detail.field ? { field: error.detail.field } : {}),
			});
		};
		if (init.method === "GET") {
			const done = await run(store.get(school, name as ConfigName));
			if (!done.ok) return refusal(done.error);
			return new Response(
				JSON.stringify({ asOf: done.value.asOf, lagMinutes: done.value.lagMinutes, data: done.value.value }),
				{ status: 200, headers: { etag: `"${done.value.etag}"`, "content-type": "application/json" } },
			);
		}
		if (verify) {
			const done = await run(store.verify(school, name as ConfigName, body.value));
			return done.ok
				? new Response(JSON.stringify({ asOf: null, lagMinutes: null, data: done.value }), { status: 200 })
				: refusal(done.error);
		}
		const ifMatch = headers["if-match"];
		const base = ifMatch ? ifMatch.replace(/"/g, "") : null;
		const done = await run(
			store.put(school, name as ConfigName, body.value, body.verifiedHash, base),
		);
		if (!done.ok) return refusal(done.error);
		return new Response(JSON.stringify({ asOf: null, lagMinutes: null, data: done.value }), {
			status: 200,
			headers: { etag: `"${done.value.sha256}"` },
		});
	};
	return { fetch, seen, tokens };
}
