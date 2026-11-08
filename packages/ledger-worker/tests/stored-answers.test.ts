/**
 * The stored answers (`routes/stored.ts`, `data/answers.ts`) and the demo index (`data/demo-index.ts`): what they answer
 * is byte for byte what the endpoints compute, a request that has them reads nothing of the log, a generation without
 * them computes as before, the cache never widens what a caller may read, and the ETag revalidates.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { R2BindingStore, type R2BucketBinding } from "tfd/worker";
import {
	ANSWER_NAMES,
	answersBundleKey,
	answersLogKey,
	answersPointerKey,
	readPointer,
	readStoredAnswers,
} from "../src/data/answers.js";
import { DEMO_INDEX_KEY } from "../src/data/demo-index.js";
import { forgetGenerations, openSnapshot } from "../src/data/snapshot.js";
import { disclosureRoute, kpiRoute } from "../src/routes/kpi.js";
import {
	type AnswersCache,
	forgetStoredAnswers,
} from "../src/routes/stored.js";
import {
	type LedgerHarness,
	type SchoolGrantInput,
	startLedgerWorker,
} from "../src/testing/harness.js";
import { createLedgerWorker } from "../src/worker.js";

const PRESETS = [
	"monthly-members",
	"heavy-refunds",
	"free-only",
	"non-usd",
] as const;
const OTHER = "growth-12mo";
const DEMO = "demo-child-only";
const STORED_PRIVATE = "private, max-age=0, must-revalidate";
const DAY_MS = 86_400_000;

/** Every request a stored answer serves, for a school. */
const storedPaths = (school: string): string[] => [
	...["public", "member", "governance", "finance", "owner"].flatMap(
		(audience) =>
			["open", "locked"].map(
				(pin) => `/v1/schools/${school}/kpi?audience=${audience}&pin=${pin}`,
			),
	),
	`/v1/schools/${school}/disclosure`,
	...["public", "member", "governance"].map(
		(audience) =>
			`/v1/schools/${school}/audience-report?audience=${audience}&from=2026-06-01&to=2026-06-30`,
	),
];

let harness: LedgerHarness;
let store: R2BindingStore;
let owner: string;
beforeAll(async () => {
	harness = await startLedgerWorker({
		presets: [...PRESETS, OTHER],
		demoPresets: ["child-only", "monthly-members"],
	});
	store = new R2BindingStore(harness.bucket);
	owner = await harness.mintToken({
		sub: "profile_owner",
		schools: PRESETS.map((id) => ({ id, role: "owner", finance: true })),
	});
}, 180_000);
afterAll(async () => {
	await harness.stop();
});

const raw = async (
	token: string | null,
	path: string,
	headers: Record<string, string> = {},
) => {
	const response = await fetch(`${harness.url}${path}`, {
		headers: {
			...(token === null ? {} : { authorization: `Bearer ${token}` }),
			...headers,
		},
	});
	return {
		status: response.status,
		headers: response.headers,
		text: await response.text(),
	};
};

const textAt = async (key: string): Promise<string | null> => {
	const object = await harness.bucket.get(key);
	return object === null
		? null
		: new TextDecoder().decode(await object.arrayBuffer());
};

/** Runs `body` with the objects at `keys` gone, and puts them back after. */
const without = async <Result>(
	keys: readonly string[],
	body: () => Promise<Result>,
): Promise<Result> => {
	const kept = await Promise.all(keys.map(textAt));
	await Promise.all(keys.map((key) => harness.bucket.delete(key)));
	try {
		return await body();
	} finally {
		await Promise.all(
			keys.map((key, index) => {
				const text = kept[index];
				return text === null || text === undefined
					? undefined
					: harness.bucket.put(key, new TextEncoder().encode(text), {});
			}),
		);
	}
};

/** A bucket that records every key read and every listing. */
const counting = (bucket: R2BucketBinding) => {
	const reads: string[] = [];
	const lists: string[] = [];
	const wrapped: R2BucketBinding = {
		get: (key, options) => {
			reads.push(key);
			return bucket.get(key, options);
		},
		head: (key) => {
			reads.push(key);
			return bucket.head(key);
		},
		put: (key, value, options) => bucket.put(key, value, options),
		delete: (key) => bucket.delete(key),
		list: (options) => {
			lists.push(options.prefix ?? "");
			return bucket.list(options);
		},
	};
	return { bucket: wrapped, reads, lists };
};

/** A cache that keeps what is put in it, by key. */
const memoryCache = () => {
	const entries = new Map<string, string>();
	const cache: AnswersCache = {
		match: async (key) => {
			const text = entries.get(key);
			return text === undefined ? undefined : new Response(text);
		},
		put: async (key, response) => {
			entries.set(key, await response.text());
		},
	};
	return { cache, entries };
};

/** The Worker in this process over the harness's bucket (wrapped), its keys and its clock: a cold isolate each time. */
const inProcess = (bucket: R2BucketBinding, cache: AnswersCache | null) => {
	forgetGenerations();
	forgetStoredAnswers();
	const worker = createLedgerWorker({
		clock: () => Date.parse(harness.clock.now()),
		fetchJwks: async () =>
			new Response(JSON.stringify({ keys: harness.jwks.keys() })),
		answersCache: cache,
	});
	return async (token: string | null, path: string) => {
		const response = await worker.fetch(
			new Request(`https://ledger.test${path}`, {
				headers: token === null ? {} : { authorization: `Bearer ${token}` },
			}),
			{
				LEDGER_BUCKET: bucket,
				LEDGER_ISS: harness.issuer,
				LEDGER_JWKS_URL: "https://jwks.test",
				LEDGER_DEMO_SCHOOLS: "on",
			},
		);
		return {
			status: response.status,
			headers: response.headers,
			text: await response.text(),
		};
	};
};

const tokenFor = (schools: SchoolGrantInput[]) =>
	harness.mintToken({ sub: "profile_other", schools });

describe("a stored answer is what the endpoint computes", () => {
	test("each stored answer equals the route's own, worked out here", async () => {
		const now = Date.parse(harness.clock.now());
		for (const school of PRESETS) {
			const pointer = await readPointer(store, school);
			if (pointer === null) throw new Error(`${school} has no stored answers`);
			const stored = await readStoredAnswers(store, school, pointer);
			expect([...(stored?.keys() ?? [])].sort()).toEqual(
				ANSWER_NAMES.map(({ name }) => name).sort(),
			);
			forgetGenerations();
			const snapshot = await openSnapshot(store, school);
			for (const { name, kind, audience, pinLocked } of ANSWER_NAMES)
				expect(stored?.get(name), `${school} ${name}`).toBe(
					JSON.stringify(
						kind === "kpi"
							? await kpiRoute(snapshot, audience, pinLocked, now)
							: await disclosureRoute(snapshot, now, audience),
					),
				);
		}
	});

	test("over HTTP, byte for byte, with and without the stored answers", async () => {
		const admin = await tokenFor(
			PRESETS.map((id) => ({ id, role: "admin", finance: false })),
		);
		for (const school of PRESETS) {
			const paths = storedPaths(school);
			const served = await Promise.all(paths.map((path) => raw(owner, path)));
			const servedAdmin = await raw(admin, `/v1/schools/${school}/disclosure`);
			for (const [index, reply] of served.entries()) {
				expect(reply.status, paths[index]).toBe(200);
				expect(reply.headers.get("etag"), paths[index]).not.toBeNull();
				expect(reply.headers.get("cache-control")).toBe(STORED_PRIVATE);
			}
			await without([answersPointerKey(school)], async () => {
				const computed = await Promise.all(
					paths.map((path) => raw(owner, path)),
				);
				for (const [index, reply] of computed.entries()) {
					expect(reply.headers.get("etag")).toBeNull();
					expect(reply.headers.get("cache-control")).toBe("private, no-store");
					expect(reply.text, paths[index]).toBe(served[index]?.text as string);
				}
				const computedAdmin = await raw(
					admin,
					`/v1/schools/${school}/disclosure`,
				);
				expect(computedAdmin.text).toBe(servedAdmin.text);
			});
		}
	});

	test("the stored log is the events the day files give", async () => {
		const pointer = await readPointer(store, "monthly-members");
		if (pointer === null) throw new Error("no stored answers");
		forgetGenerations();
		const fromLog = await (
			await openSnapshot(store, "monthly-members")
		).events();
		forgetGenerations();
		const fromDays = await without(
			[answersPointerKey("monthly-members")],
			async () => (await openSnapshot(store, "monthly-members")).events(),
		);
		expect(fromLog.length).toBeGreaterThan(0);
		expect(fromLog).toEqual(fromDays);
	});
});

describe("a request with a stored answer does not open the snapshot", () => {
	test("the KPI document, the disclosure and the report read the manifest, the pointer and the answers only", async () => {
		const { bucket, reads } = counting(harness.bucket);
		const get = inProcess(bucket, null);
		const school = "monthly-members";
		for (const path of storedPaths(school))
			expect((await get(owner, path)).status, path).toBe(200);
		const keys = new Set(reads);
		expect([...keys].sort()).toEqual(
			[
				`schools/${school}/views/manifest.json`,
				answersPointerKey(school),
				answersBundleKey(school),
			].sort(),
		);
		// one read of the answers for the whole generation: the isolate keeps them
		expect(
			reads.filter((key) => key === answersBundleKey(school)),
		).toHaveLength(1);
	});

	test("the ledger, the income statement and a member's money read the stored log, not the day files", async () => {
		const { bucket, reads } = counting(harness.bucket);
		const get = inProcess(bucket, null);
		for (const path of [
			"/v1/schools/monthly-members/ledger?from=2026-03-01&to=2026-03-31",
			"/v1/schools/monthly-members/income-statement?from=2026-01-01&to=2026-12-31&compare=0",
			"/v1/schools/monthly-members/fundraising?from=2026-01-01&to=2026-12-31",
		])
			expect((await get(owner, path)).status, path).toBe(200);
		expect(reads).toContain(answersLogKey("monthly-members"));
		expect(reads.filter((key) => key.includes("/events/"))).toEqual([]);
	});
});

describe("without stored answers the endpoint computes", () => {
	test("no pointer: the day files are read, and the answer is the same", async () => {
		const path = "/v1/schools/heavy-refunds/kpi?audience=owner&pin=open";
		const stored = await raw(owner, path);
		await without([answersPointerKey("heavy-refunds")], async () => {
			const { bucket, reads } = counting(harness.bucket);
			const reply = await inProcess(bucket, null)(owner, path);
			expect(reply.status).toBe(200);
			expect(reply.text).toBe(stored.text);
			expect(reply.headers.get("etag")).toBeNull();
			expect(reads.some((key) => key.includes("/events/"))).toBe(true);
			expect(reads).not.toContain(answersBundleKey("heavy-refunds"));
		});
	});

	test("a pointer but no answers object: computed from the stored log", async () => {
		const path = "/v1/schools/heavy-refunds/disclosure";
		const stored = await raw(owner, path);
		await without([answersBundleKey("heavy-refunds")], async () => {
			const { bucket, reads } = counting(harness.bucket);
			const reply = await inProcess(bucket, null)(owner, path);
			expect(reply.status).toBe(200);
			expect(reply.text).toBe(stored.text);
			expect(reads).toContain(answersLogKey("heavy-refunds"));
			expect(reads.some((key) => key.includes("/events/"))).toBe(false);
		});
	});

	test("a pointer of another generation (written before the views changed) is not used", async () => {
		const key = answersPointerKey("free-only");
		const text = (await textAt(key)) as string;
		const stale = { ...JSON.parse(text), generation: "0000000000" };
		await harness.bucket.put(
			key,
			new TextEncoder().encode(JSON.stringify(stale)),
			{},
		);
		try {
			const reply = await raw(
				owner,
				"/v1/schools/free-only/kpi?audience=owner&pin=open",
			);
			expect(reply.status).toBe(200);
			expect(reply.headers.get("etag")).toBeNull();
		} finally {
			await harness.bucket.put(key, new TextEncoder().encode(text), {});
		}
	});

	test("on another local day than the answers', the endpoint computes", async () => {
		const path = "/v1/schools/free-only/kpi?audience=owner&pin=open";
		expect((await raw(owner, path)).headers.get("etag")).not.toBeNull();
		harness.clock.advance(DAY_MS);
		try {
			const late = await harness.mintToken({
				sub: "p",
				schools: [{ id: "free-only", role: "owner", finance: true }],
			});
			const reply = await raw(late, path);
			expect(reply.status).toBe(200);
			expect(reply.headers.get("etag")).toBeNull();
			expect(reply.headers.get("cache-control")).toBe("private, no-store");
		} finally {
			harness.clock.advance(-DAY_MS);
		}
	});
});

describe("GET /v1/schools from the demo index", () => {
	test("the same answer with the index as from the bucket, with and without a token", async () => {
		const other = await tokenFor([
			{ id: "monthly-members", role: "owner", finance: true },
		]);
		const withIndex = [
			await raw(null, "/v1/schools"),
			await raw(other, "/v1/schools"),
		];
		expect(await textAt(DEMO_INDEX_KEY)).not.toBeNull();
		await without([DEMO_INDEX_KEY], async () => {
			expect((await raw(null, "/v1/schools")).text).toBe(
				withIndex[0]?.text as string,
			);
			expect((await raw(other, "/v1/schools")).text).toBe(
				withIndex[1]?.text as string,
			);
		});
		const listed = JSON.parse(withIndex[1]?.text as string).data.schools as {
			id: string;
		}[];
		// the token's school, then the demo schools: no other real school
		expect(listed.map((school) => school.id)).toEqual([
			"monthly-members",
			DEMO,
			"demo-monthly-members",
		]);
	});

	test("the index names demo schools only, and the list reads it without listing the bucket", async () => {
		const index = JSON.parse((await textAt(DEMO_INDEX_KEY)) as string) as {
			schools: Record<string, unknown>;
		};
		expect(Object.keys(index.schools)).toEqual([DEMO, "demo-monthly-members"]);
		const { bucket, reads, lists } = counting(harness.bucket);
		const reply = await inProcess(bucket, null)(owner, "/v1/schools");
		expect(reply.status).toBe(200);
		expect(lists).toEqual([]);
		// the index, and each of the token's schools' manifests at once
		expect(reads.sort()).toEqual(
			[
				DEMO_INDEX_KEY,
				...PRESETS.map((id) => `schools/${id}/views/manifest.json`),
			].sort(),
		);
	});
});

describe("the cache never widens what a caller may read", () => {
	test("two tokens on one cache: each is checked before the cache, and the keys name no caller", async () => {
		const { cache, entries } = memoryCache();
		const ownerGet = inProcess(harness.bucket, cache);
		const ownerKpi = await ownerGet(
			owner,
			"/v1/schools/monthly-members/kpi?audience=governance&pin=open",
		);
		const ownerDisclosure = await ownerGet(
			owner,
			"/v1/schools/monthly-members/disclosure",
		);
		expect(ownerKpi.status).toBe(200);
		// the first read put every answer of the generation in the cache
		expect(entries.size).toBe(ANSWER_NAMES.length);
		for (const key of entries.keys())
			expect(key).not.toMatch(/profile|Bearer|owner_|admin/);

		// a fresh isolate on the same cache, for an admin without the finance grant on one school only
		const admin = await tokenFor([
			{ id: "monthly-members", role: "admin", finance: false },
		]);
		const { bucket, reads } = counting(harness.bucket);
		const adminGet = inProcess(bucket, cache);
		const refused = await adminGet(
			admin,
			"/v1/schools/monthly-members/kpi?audience=governance&pin=open",
		);
		expect(refused.status).toBe(403);
		expect(JSON.parse(refused.text).error.code).toBe("audience_not_allowed");
		// another school, cached for the owner: not this token's
		expect(
			(
				await adminGet(
					admin,
					"/v1/schools/heavy-refunds/kpi?audience=public&pin=open",
				)
			).status,
		).toBe(404);
		expect(
			(
				await adminGet(
					admin,
					"/v1/schools/monthly-members/ledger?from=2026-03-01&to=2026-03-31",
				)
			).status,
		).toBe(403);
		// the admin's own audience and disclosure: from the cache, and not the owner's
		const publicKpi = await adminGet(
			admin,
			"/v1/schools/monthly-members/kpi?audience=public&pin=open",
		);
		expect(publicKpi.status).toBe(200);
		expect(publicKpi.text).not.toBe(ownerKpi.text);
		const adminDisclosure = await adminGet(
			admin,
			"/v1/schools/monthly-members/disclosure",
		);
		expect(adminDisclosure.status).toBe(200);
		// the answer of the admin's audience (the B4 Uni defaults may word both alike), not the owner's
		expect(adminDisclosure.headers.get("etag")).toMatch(/-disclosure-public"$/);
		expect(ownerDisclosure.headers.get("etag")).toMatch(/-disclosure-member"$/);
		expect(reads).not.toContain(answersBundleKey("monthly-members"));
		// and each is what the endpoint computes for that caller
		await without([answersPointerKey("monthly-members")], async () => {
			expect(
				(await raw(admin, "/v1/schools/monthly-members/disclosure")).text,
			).toBe(adminDisclosure.text);
			expect(
				(
					await raw(
						admin,
						"/v1/schools/monthly-members/kpi?audience=public&pin=open",
					)
				).text,
			).toBe(publicKpi.text);
		});
	});

	test("on Miniflare's cache too: a token that may not read the audience is refused after the owner's read", async () => {
		const path = "/v1/schools/non-usd/kpi?audience=owner&pin=locked";
		expect((await raw(owner, path)).status).toBe(200);
		const admin = await tokenFor([
			{ id: "non-usd", role: "admin", finance: true },
		]);
		expect((await raw(admin, path)).status).toBe(403);
		expect((await raw(null, path)).status).toBe(401);
	});
});

describe("ETag and 304", () => {
	test("If-None-Match with the ETag is a 304 with no body; another ETag is a 200", async () => {
		const path = "/v1/schools/monthly-members/kpi?audience=member&pin=open";
		const first = await raw(owner, path);
		const etag = first.headers.get("etag") as string;
		expect(etag).toMatch(
			/^"v\d+-[0-9a-f]+-\d{4}-\d{2}-\d{2}-kpi-member-open"$/,
		);
		const again = await raw(owner, path, { "if-none-match": etag });
		expect(again.status).toBe(304);
		expect(again.text).toBe("");
		expect(again.headers.get("etag")).toBe(etag);
		expect(again.headers.get("cache-control")).toBe(STORED_PRIVATE);
		expect(
			(await raw(owner, path, { "if-none-match": `"other", W/${etag}` }))
				.status,
		).toBe(304);
		expect(
			(await raw(owner, path, { "if-none-match": '"other"' })).status,
		).toBe(200);
	});

	test("the disclosure's ETag names the caller's audience: a token change reads it again", async () => {
		const path = "/v1/schools/monthly-members/disclosure";
		const ownerEtag = (await raw(owner, path)).headers.get("etag") as string;
		const admin = await tokenFor([
			{ id: "monthly-members", role: "admin", finance: false },
		]);
		const reply = await raw(admin, path, { "if-none-match": ownerEtag });
		expect(reply.status).toBe(200);
		expect(reply.headers.get("etag")).not.toBe(ownerEtag);
	});

	test("the checks come first: a 304 needs a token that may read it", async () => {
		const path = "/v1/schools/monthly-members/kpi?audience=owner&pin=open";
		const etag = (await raw(owner, path)).headers.get("etag") as string;
		const admin = await tokenFor([
			{ id: "monthly-members", role: "admin", finance: false },
		]);
		expect((await raw(admin, path, { "if-none-match": etag })).status).toBe(
			403,
		);
		expect((await raw(null, path, { "if-none-match": etag })).status).toBe(401);
	});

	test("a new generation is a new ETag", async () => {
		const before = await raw(
			owner,
			"/v1/schools/heavy-refunds/kpi?audience=owner&pin=open",
		);
		harness.clock.advance(60_000);
		try {
			await harness.runCron();
			const after = await raw(
				await harness.mintToken({
					sub: "p",
					schools: [{ id: "heavy-refunds", role: "owner", finance: true }],
				}),
				"/v1/schools/heavy-refunds/kpi?audience=owner&pin=open",
				{ "if-none-match": before.headers.get("etag") as string },
			);
			expect(after.status).toBe(200);
			expect(after.headers.get("etag")).not.toBe(before.headers.get("etag"));
			expect(JSON.parse(after.text).asOf).not.toBe(
				JSON.parse(before.text).asOf,
			);
		} finally {
			harness.clock.advance(-60_000);
		}
	});

	test("a demo school's stored answer is public for a minute", async () => {
		const reply = await raw(
			null,
			`/v1/schools/${DEMO}/kpi?audience=owner&pin=open`,
		);
		expect(reply.status).toBe(200);
		expect(reply.headers.get("cache-control")).toBe("public, max-age=60");
		expect(reply.headers.get("etag")).not.toBeNull();
	});

	test("a bad query on a stored answer is still a 400", async () => {
		const reply = await raw(
			owner,
			"/v1/schools/monthly-members/audience-report?audience=public&from=June&to=2026-06-30",
		);
		expect(reply.status).toBe(400);
	});
});
