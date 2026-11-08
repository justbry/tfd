import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { canonicalJson } from "$worker-config/canonical.ts";
import { definitions } from "$worker-config/definitions.ts";
import { CONFIG_NAMES, type PlansDraftConfig } from "$worker-config/types.ts";
import { putOnce } from "../../src/effect/config-save.ts";
import { createHttpConfig } from "../../src/effect/config-http.ts";
import { messageFor } from "../../src/effect/messages.ts";
import { UiError } from "../../src/effect/ui-error.ts";
import {
	ADMIN,
	hashOf,
	OWNER,
	seed,
	settle,
	storeFor,
	workerWire,
} from "./config-support.ts";

/**
 * The R2 config client (S9-plan sections 3 and 4, D18, D22). Two implementations of one interface: the fixture store
 * (an in-memory object per school and name, with the Worker's rules) and the HTTP client (the Worker's routes over
 * fetch). The validators, the canonical JSON, the hash and the diff are the Worker's own modules, imported read-only
 * (`$worker-config`), so for the five objects they cannot differ; what this file proves is the route's rules (the order
 * of its checks and the answer of each), which the fixture store and the HTTP client both follow the way
 * packages/ledger-worker/tests/config.test.ts has the Worker follow them.
 */

const plansDraft = async (): Promise<PlansDraftConfig> => {
	const store = storeFor(OWNER);
	const objects = await seed(store);
	return objects["plans-draft"];
};

describe("the fixture store follows the Worker's route", () => {
	test("reads the five objects the Worker seeds, each with the sha256 of its canonical JSON as its etag", async () => {
		const store = storeFor(OWNER);
		const objects = await seed(store);
		for (const name of CONFIG_NAMES) {
			const read = await settle(store.get("vol", name));
			expect(read.ok).toBe(true);
			if (!read.ok) continue;
			expect(read.value.value).toEqual(objects[name] as never);
			expect(read.value.etag).toBe(await hashOf(objects[name]));
		}
	});

	test("an unwritten object and an unknown school are not_found", async () => {
		const store = storeFor(OWNER);
		const absent = await settle(store.get("vol", "plans-draft"));
		expect(absent.ok ? null : [absent.error.kind, absent.error.detail.code]).toEqual(["not_found", "not_found"]);
		const other = await settle(store.get("elsewhere", "plans-draft"));
		expect(other.ok ? null : other.error.kind).toBe("not_found");
	});

	test("verify says ok with the hash of the canonical text, the diff and the base etag, and writes nothing", async () => {
		const store = storeFor(OWNER);
		const draft = await plansDraft();
		await seed(store);
		const before = store.peek("vol", "plans-draft");
		const edited = { ...draft, purchaseLinkShared: !draft.purchaseLinkShared };
		const verdict = await settle(store.verify("vol", "plans-draft", edited));
		expect(verdict.ok && verdict.value).toEqual({
			ok: true,
			problems: [],
			diff: [
				{
					path: "purchaseLinkShared",
					change: "changed",
					before: draft.purchaseLinkShared,
					after: edited.purchaseLinkShared,
				},
			],
			verifiedHash: await hashOf(edited),
			baseEtag: before?.etag ?? null,
		});
		expect(store.peek("vol", "plans-draft")).toEqual(before);
	});

	test("verify of an invalid value answers ok:false with every problem the Worker's validator finds, and no hash", async () => {
		const store = storeFor(OWNER);
		const draft = await plansDraft();
		const broken = {
			...draft,
			tiers: draft.tiers.map((tier, index) => (index === 0 ? { ...tier, name: "" } : tier)),
			tierOrder: ["ghost"],
		};
		const verdict = await settle(store.verify("vol", "plans-draft", broken));
		if (!verdict.ok) throw new Error("verify refused");
		expect(verdict.value.ok).toBe(false);
		expect(verdict.value.verifiedHash).toBeNull();
		expect(verdict.value.diff).toEqual([]);
		expect(verdict.value.problems).toEqual(definitions["plans-draft"].validate(broken, "vol"));
		expect(verdict.value.problems.map(({ path }) => path)).toContain("tiers[0].name");
		for (const problem of verdict.value.problems) {
			expect(problem.message).not.toBe("");
			expect(problem.hint).not.toBe("");
		}
	});

	test("every object's validator is the Worker's: a value it refuses, the store refuses with the same problems", async () => {
		const store = storeFor(OWNER);
		for (const name of CONFIG_NAMES) {
			const verdict = await settle(store.verify("vol", name, { schemaVersion: 2 } as never));
			if (!verdict.ok) throw new Error(`${name}: verify refused`);
			expect(verdict.value.ok).toBe(false);
			expect(verdict.value.problems).toEqual(definitions[name].validate({ schemaVersion: 2 }, "vol"));
		}
	});

	test("put writes a verified value over its base etag, and the stored bytes are the canonical JSON", async () => {
		const store = storeFor(OWNER);
		const draft = await plansDraft();
		await seed(store);
		const edited = { ...draft, purchaseLinkShared: !draft.purchaseLinkShared };
		const hash = await hashOf(edited);
		const base = store.peek("vol", "plans-draft")?.etag ?? null;
		const done = await settle(store.put("vol", "plans-draft", edited, hash, base));
		expect(done.ok && done.value).toEqual({
			name: "plans-draft",
			sha256: hash,
			bytes: new TextEncoder().encode(canonicalJson(edited)).length,
			changed: true,
		});
		expect(store.peek("vol", "plans-draft")).toEqual({ value: edited, etag: hash });
	});

	test("put of a value the object already holds answers changed:false and moves nothing", async () => {
		const store = storeFor(OWNER);
		const draft = await plansDraft();
		await seed(store);
		const base = store.peek("vol", "plans-draft")?.etag ?? null;
		const done = await settle(store.put("vol", "plans-draft", draft, await hashOf(draft), base));
		expect(done.ok && done.value.changed).toBe(false);
	});

	test("put over a new object needs no base etag (If-None-Match: *), and fails with 412 when the object exists", async () => {
		const store = storeFor(OWNER);
		const draft = await plansDraft();
		const hash = await hashOf(draft);
		const first = await settle(store.put("vol", "plans-draft", draft, hash, null));
		expect(first.ok && first.value.changed).toBe(true);
		const second = await settle(store.put("vol", "plans-draft", draft, hash, null));
		expect(second.ok ? null : second.error.detail.code).toBe("stale_etag");
	});

	test("put over a stale base etag is a 412 stale_etag (a conflict), and writes nothing", async () => {
		const store = storeFor(OWNER);
		const draft = await plansDraft();
		await seed(store);
		const base = store.peek("vol", "plans-draft")?.etag ?? null;
		await store.writeBehind("vol", "plans-draft", { ...draft, draftVersion: 9 });
		const moved = store.peek("vol", "plans-draft");
		const edited = { ...draft, purchaseLinkShared: !draft.purchaseLinkShared };
		const done = await settle(store.put("vol", "plans-draft", edited, await hashOf(edited), base));
		if (done.ok) throw new Error("the stale put was accepted");
		expect([done.error.kind, done.error.detail.status, done.error.detail.code]).toEqual(["conflict", 412, "stale_etag"]);
		expect(messageFor(done.error).title).toBe("Someone changed this. Review their change");
		expect(store.peek("vol", "plans-draft")).toEqual(moved);
	});

	test("put with a forged hash is a 422 invalid_config naming verifiedHash, and a malformed one a 400", async () => {
		const store = storeFor(OWNER);
		const draft = await plansDraft();
		await seed(store);
		const base = store.peek("vol", "plans-draft")?.etag ?? null;
		const edited = { ...draft, purchaseLinkShared: !draft.purchaseLinkShared };
		const forged = await settle(store.put("vol", "plans-draft", edited, await hashOf(draft), base));
		if (forged.ok) throw new Error("a forged hash was accepted");
		expect([forged.error.detail.status, forged.error.detail.code]).toEqual([422, "invalid_config"]);
		expect(forged.error.detail.problems?.map(({ path }) => path)).toEqual(["verifiedHash"]);
		const malformed = await settle(store.put("vol", "plans-draft", edited, "nope", base));
		expect(malformed.ok ? null : malformed.error.detail.status).toBe(400);
	});

	test("put of an invalid value is a 422 invalid_config with problems[], even with a hash", async () => {
		const store = storeFor(OWNER);
		const draft = await plansDraft();
		const broken = { ...draft, tierOrder: [] };
		const done = await settle(store.put("vol", "plans-draft", broken, await hashOf(broken), null));
		if (done.ok) throw new Error("an invalid value was accepted");
		expect(done.error.detail.code).toBe("invalid_config");
		expect(done.error.detail.problems).toEqual(definitions["plans-draft"].validate(broken, "vol"));
		expect(messageFor(done.error).action).toBe("show_problems");
	});

	test("only the owner verifies or puts: an admin gets 403 owner_only", async () => {
		const store = storeFor(ADMIN);
		const draft = await plansDraft();
		const verdict = await settle(store.verify("vol", "plans-draft", draft));
		const done = await settle(store.put("vol", "plans-draft", draft, await hashOf(draft), null));
		for (const refused of [verdict, done]) {
			if (refused.ok) throw new Error("an admin was let write");
			expect([refused.error.kind, refused.error.detail.status, refused.error.detail.code]).toEqual(["forbidden", 403, "owner_only"]);
			expect(messageFor(refused.error).title).toBe("Owners only");
		}
	});

	test("a put without a fresh step-up is a 403 step_up_required; verify still works; turning it on lets the put through", async () => {
		const store = storeFor(OWNER, { stepUp: false });
		const draft = await plansDraft();
		const hash = await hashOf(draft);
		expect((await settle(store.verify("vol", "plans-draft", draft))).ok).toBe(true);
		const refused = await settle(store.put("vol", "plans-draft", draft, hash, null));
		if (refused.ok) throw new Error("a put without step-up was accepted");
		expect([refused.error.kind, refused.error.detail.status, refused.error.detail.code]).toEqual(["step_up", 403, "step_up_required"]);
		expect(messageFor(refused.error).title).toBe("Confirm it is you");
		expect(store.peek("vol", "plans-draft")).toBeNull();
		store.setStepUp(true);
		expect((await settle(store.put("vol", "plans-draft", draft, hash, null))).ok).toBe(true);
	});

	test("the gate comes before the value: a non-owner without step-up is refused as owner_only, an invalid value before the etag", async () => {
		const store = storeFor(ADMIN, { stepUp: false });
		const done = await settle(store.put("vol", "plans-draft", { bad: true } as never, "x", "y"));
		expect(done.ok ? null : done.error.detail.code).toBe("owner_only");
		const owner = storeFor(OWNER, { stepUp: false });
		const second = await settle(owner.put("vol", "plans-draft", { bad: true } as never, "x", "y"));
		expect(second.ok ? null : second.error.detail.code).toBe("step_up_required");
		const fresh = storeFor(OWNER);
		const third = await settle(fresh.put("vol", "plans-draft", { bad: true } as never, "x", "stale"));
		expect(third.ok ? null : third.error.detail.code).toBe("invalid_config");
	});

	test("money-bearing promos need the finance grant even from the owner", async () => {
		const store = storeFor({ role: "owner", finance: false });
		const done = await settle(store.get("vol", "promos"));
		expect(done.ok ? null : done.error.detail.code).toBe("finance_required");
	});
});

describe("a retried put is idempotent by its verified hash and base etag", () => {
	test("a retry whose first try landed (the answer was lost) meets 412 on its own write, finds the object at its verified hash, and succeeds", async () => {
		const store = storeFor(OWNER);
		const draft = await plansDraft();
		await seed(store);
		const base = store.peek("vol", "plans-draft")?.etag ?? null;
		const edited = { ...draft, purchaseLinkShared: !draft.purchaseLinkShared };
		const hash = await hashOf(edited);
		let lost = true;
		// The first try reaches the store and writes, but its answer is lost: the client sees a network failure.
		const flaky = {
			...store,
			put: (...args: Parameters<typeof store.put>) =>
				store.put(...args).pipe(
					Effect.flatMap((done) =>
						lost
							? Effect.fail(
									new UiError({
										kind: "network",
										detail: {},
										reason: "no answer",
										retryable: true,
									}),
								)
							: Effect.succeed(done),
					),
				),
		};
		const action = putOnce(flaky as never, "vol", "plans-draft", edited, hash, base);
		const first = await settle(action);
		expect(first.ok ? null : first.error.kind).toBe("network");
		expect(store.peek("vol", "plans-draft")?.etag).toBe(hash);
		lost = false;
		const retried = await settle(action);
		expect(retried.ok && retried.value).toMatchObject({ sha256: hash, changed: false });
	});

	test("a 412 on the first try, or with the object at something else, stays a conflict", async () => {
		const store = storeFor(OWNER);
		const draft = await plansDraft();
		await seed(store);
		const base = store.peek("vol", "plans-draft")?.etag ?? null;
		await store.writeBehind("vol", "plans-draft", { ...draft, draftVersion: 5 });
		const edited = { ...draft, purchaseLinkShared: !draft.purchaseLinkShared };
		const action = putOnce(store, "vol", "plans-draft", edited, await hashOf(edited), base);
		const done = await settle(action);
		expect(done.ok ? null : done.error.detail.code).toBe("stale_etag");
		const again = await settle(action);
		expect(again.ok ? null : again.error.detail.code).toBe("stale_etag");
	});
});

describe("the HTTP client speaks the Worker's wire", () => {
	const clientOn = (store = storeFor(OWNER), script?: Parameters<typeof workerWire>[1]) => {
		const wire = workerWire(store, script);
		return {
			store,
			wire,
			client: createHttpConfig({ fetch: wire.fetch, base: "/v1", tokens: wire.tokens }),
		};
	};

	test("get sends the bearer and reads the ETag, the envelope and a value the Worker's validator accepts", async () => {
		const { store, wire, client } = clientOn();
		const draft = await plansDraft();
		await seed(store);
		const read = await settle(client.get("vol", "plans-draft"));
		expect(read.ok && read.value).toEqual({
			value: draft,
			etag: await hashOf(draft),
			asOf: null,
			lagMinutes: null,
		});
		expect(wire.seen[0]).toMatchObject({
			method: "GET",
			url: "/v1/schools/vol/config/plans-draft",
		});
		expect(wire.seen[0]?.headers.authorization).toBe("Bearer ledger.token.value");
	});

	test("a stored value the validator refuses is schema_mismatch, never shown", async () => {
		const { store, client } = clientOn();
		await store.writeBehind("vol", "plans-draft", { schemaVersion: 1 });
		const read = await settle(client.get("vol", "plans-draft"));
		expect(read.ok ? null : read.error.kind).toBe("schema_mismatch");
	});

	test("verify posts the value and returns the verdict as the fixture store does", async () => {
		const { store, wire, client } = clientOn();
		const draft = await plansDraft();
		await seed(store);
		const edited = { ...draft, purchaseLinkShared: !draft.purchaseLinkShared };
		const over = await settle(client.verify("vol", "plans-draft", edited));
		const direct = await settle(store.verify("vol", "plans-draft", edited));
		expect(over.ok ? over.value : null).toEqual(direct.ok ? direct.value : null);
		expect(wire.seen[0]).toMatchObject({ method: "POST", url: "/v1/schools/vol/config/plans-draft/verify", body: { value: edited } });
	});

	test("put sends If-Match with the quoted base etag and the verified hash, or If-None-Match: * for a new object", async () => {
		const { store, wire, client } = clientOn();
		const draft = await plansDraft();
		const hash = await hashOf(draft);
		const created = await settle(client.put("vol", "plans-draft", draft, hash, null));
		expect(created.ok && created.value.changed).toBe(true);
		expect(wire.seen[0]?.headers["if-none-match"]).toBe("*");
		const edited = { ...draft, purchaseLinkShared: !draft.purchaseLinkShared };
		const editedHash = await hashOf(edited);
		const updated = await settle(client.put("vol", "plans-draft", edited, editedHash, hash));
		expect(updated.ok && updated.value.sha256).toBe(editedHash);
		expect(wire.seen[1]?.headers["if-match"]).toBe(`"${hash}"`);
		expect(wire.seen[1]?.body).toEqual({ value: edited, verifiedHash: editedHash });
		expect(store.peek("vol", "plans-draft")?.etag).toBe(editedHash);
	});

	test("the Worker's refusals become UiErrors the message table knows: 412, 422 with problems, 403 owner_only, 403 step_up_required", async () => {
		const draft = await plansDraft();
		const hash = await hashOf(draft);
		const stale = clientOn();
		await seed(stale.store);
		const refusedStale = await settle(stale.client.put("vol", "plans-draft", draft, hash, "0".repeat(64)));
		const invalid = clientOn();
		const refusedInvalid = await settle(invalid.client.put("vol", "plans-draft", { ...draft, tierOrder: [] }, await hashOf({ ...draft, tierOrder: [] }), null));
		const admin = clientOn(storeFor(ADMIN));
		const refusedAdmin = await settle(admin.client.verify("vol", "plans-draft", draft));
		const noStepUp = clientOn(storeFor(OWNER, { stepUp: false }));
		const refusedStepUp = await settle(noStepUp.client.put("vol", "plans-draft", draft, hash, null));
		const kinds = [refusedStale, refusedInvalid, refusedAdmin, refusedStepUp].map((done) =>
			done.ok ? null : [done.error.kind, done.error.detail.status ?? 0, done.error.detail.code ?? "", done.error.retryable],
		);
		expect(kinds).toEqual([
			["conflict", 412, "stale_etag", false],
			["bad_request", 422, "invalid_config", false],
			["forbidden", 403, "owner_only", false],
			["step_up", 403, "step_up_required", false],
		]);
		expect(refusedInvalid.ok ? null : refusedInvalid.error.detail.problems?.length).toBeGreaterThan(0);
		const titles = [refusedStale, refusedInvalid, refusedAdmin, refusedStepUp].map((done) => (done.ok ? "" : messageFor(done.error).title));
		expect(titles).toEqual([
			"Someone changed this. Review their change",
			"Some fields need a change",
			"Owners only",
			"Confirm it is you",
		]);
	});

	test("a 401 takes a new token and tries once more; a second 401 is unauthenticated", async () => {
		let denied = 0;
		const { store, wire, client } = clientOn(storeFor(OWNER), {
			script: (_request, attempt) => {
				if (attempt > 2) return undefined;
				denied += 1;
				return new Response(JSON.stringify({ error: { code: "token_expired", message: "expired" } }), { status: 401 });
			},
		});
		await seed(store);
		const read = await settle(client.get("vol", "plans-draft"));
		expect(read.ok).toBe(false);
		expect(read.ok ? null : read.error.kind).toBe("unauthenticated");
		expect(denied).toBe(2);
		expect(wire.tokens.refreshes).toBe(1);
		const later = await settle(client.get("vol", "plans-draft"));
		expect(later.ok).toBe(true);
	});

	test("503, a lost connection and a 429 are retryable; 5xx other than 503 is a server failure", async () => {
		const replies: Array<[Response | "throw", string, boolean]> = [
			[new Response(JSON.stringify({ error: { code: "views_unavailable", message: "x" } }), { status: 503 }), "unavailable", true],
			[new Response(JSON.stringify({ error: { code: "rate_limited", message: "x", retryAfterSeconds: 7 } }), { status: 429 }), "rate_limited", true],
			[new Response("oops", { status: 500 }), "server", true],
			["throw", "network", true],
		];
		for (const [reply, kind, retryable] of replies) {
			const wire = workerWire(storeFor(OWNER));
			const client = createHttpConfig({
				fetch: async () => {
					if (reply === "throw") throw new Error("offline");
					return reply.clone();
				},
				base: "/v1",
				tokens: wire.tokens,
			});
			const done = await settle(client.get("vol", "plans-draft"));
			expect(done.ok ? null : { kind: String(done.error.kind), retryable: done.error.retryable }).toEqual({ kind, retryable });
		}
	});

	test("refreshSession takes a new ledger token", async () => {
		const { wire, client } = clientOn();
		await settle(client.refreshSession());
		expect(wire.tokens.refreshes).toBe(1);
	});
});
