/**
 * Contract suites for the storage ports, framework-free: each returns named async cases that throw on failure, so
 * bun:test, vitest and node:test can all run them:
 *
 *   for (const { name, run } of credentialStoreContract(() => myStore())) test(name, run);
 *
 * `makeStore` must return a fresh, empty store on every call.
 */
import { canonicalize } from "../canonical.js";
import type {
	CredentialStore,
	StatusListRecord,
	StatusListStore,
	StoredCredential,
} from "../ports.js";
import { OPEN_BADGE_CONTEXT, STATUS_LIST_CONTEXT } from "../types.js";

export type ContractCase = { name: string; run: () => Promise<void> };

class ContractFailure extends Error {
	override name = "ContractFailure";
}

const check = (condition: boolean, message: string): void => {
	if (!condition) throw new ContractFailure(message);
};

const same = (actual: unknown, expected: unknown, message: string): void => {
	check(actual !== null && actual !== undefined, `${message}: got nothing`);
	check(
		canonicalize(actual) === canonicalize(expected),
		`${message}: stored value differs`,
	);
};

const sampleCredential = (
	id: string,
	options: {
		holder?: string | null;
		level?: string | null;
		name?: string;
	} = {},
): StoredCredential => ({
	credential: {
		"@context": [...OPEN_BADGE_CONTEXT],
		id,
		type: ["VerifiableCredential", "OpenBadgeCredential"],
		name: options.name ?? "Contract sample",
		issuer: {
			id: "did:web:issuer.example",
			type: ["Profile"],
			name: "Example Issuer",
		},
		validFrom: "2026-01-01T00:00:00Z",
		credentialSubject: {
			id: "did:example:holder",
			type: ["AchievementSubject"],
			achievement: {
				id: "https://issuer.example/achievements/sample",
				type: ["Achievement"],
				name: "Sample",
				description: "A sample achievement.",
				criteria: { narrative: "None." },
				humanCode: options.level ?? "Sample",
			},
		},
	},
	holder: options.holder === undefined ? "holder-a" : options.holder,
	level: options.level === undefined ? "Sample" : options.level,
});

const ids = {
	first: "urn:uuid:00000000-0000-4000-8000-000000000001",
	second: "urn:uuid:00000000-0000-4000-8000-000000000002",
	third: "urn:uuid:00000000-0000-4000-8000-000000000003",
};

export const credentialStoreContract = (
	makeStore: () => CredentialStore | Promise<CredentialStore>,
): ContractCase[] => [
	{
		name: "get of an unknown id is null",
		run: async () => {
			const store = await makeStore();
			check((await store.get(ids.first)) === null, "expected null");
		},
	},
	{
		name: "put creates, get returns the same entry",
		run: async () => {
			const store = await makeStore();
			const entry = sampleCredential(ids.first);
			check(
				(await store.put(entry)) === "created",
				"first put must be created",
			);
			same(await store.get(ids.first), entry, "get after put");
		},
	},
	{
		name: "a repeated identical put is existing",
		run: async () => {
			const store = await makeStore();
			const entry = sampleCredential(ids.first);
			await store.put(entry);
			check(
				(await store.put(sampleCredential(ids.first))) === "existing",
				"repeat must be existing",
			);
		},
	},
	{
		name: "another credential under a taken id is a conflict and changes nothing",
		run: async () => {
			const store = await makeStore();
			const entry = sampleCredential(ids.first);
			await store.put(entry);
			const other = sampleCredential(ids.first, { name: "Different" });
			check((await store.put(other)) === "conflict", "must be conflict");
			same(await store.get(ids.first), entry, "stored entry after conflict");
		},
	},
	{
		name: "list filters by holder and level, and by both",
		run: async () => {
			const store = await makeStore();
			await store.put(
				sampleCredential(ids.first, { holder: "holder-a", level: "Coach" }),
			);
			await store.put(
				sampleCredential(ids.second, { holder: "holder-a", level: "Mediator" }),
			);
			await store.put(
				sampleCredential(ids.third, { holder: null, level: "Coach" }),
			);
			const idsOf = (entries: StoredCredential[]): string =>
				entries
					.map((entry) => entry.credential.id)
					.sort()
					.join(",");
			check(
				idsOf(await store.list()) ===
					[ids.first, ids.second, ids.third].join(","),
				"list all",
			);
			check(
				idsOf(await store.list({ holder: "holder-a" })) ===
					[ids.first, ids.second].join(","),
				"by holder",
			);
			check(
				idsOf(await store.list({ level: "Coach" })) ===
					[ids.first, ids.third].join(","),
				"by level",
			);
			check(
				idsOf(await store.list({ holder: "holder-a", level: "Coach" })) ===
					ids.first,
				"by both",
			);
			check((await store.list({ holder: "nobody" })).length === 0, "no match");
		},
	},
	{
		name: "changing a returned value does not change the store",
		run: async () => {
			const store = await makeStore();
			const entry = sampleCredential(ids.first);
			await store.put(entry);
			const read = await store.get(ids.first);
			if (read !== null) read.credential.name = "Mutated";
			entry.credential.name = "Mutated too";
			same(
				await store.get(ids.first),
				sampleCredential(ids.first),
				"after mutation",
			);
		},
	},
];

const sampleRecord = (id: string, encodedList: string): StatusListRecord => ({
	credential: {
		"@context": [...STATUS_LIST_CONTEXT],
		id,
		type: ["VerifiableCredential", "BitstringStatusListCredential"],
		issuer: "did:web:issuer.example",
		validFrom: "2026-01-01T00:00:00Z",
		credentialSubject: {
			id: `${id}#list`,
			type: "BitstringStatusList",
			statusPurpose: "revocation",
			encodedList,
		},
	},
	allocations: "uAllocations",
});

const listIds = {
	first: "https://issuer.example/status/1",
	second: "https://issuer.example/status/2",
};

export const statusListStoreContract = (
	makeStore: () => StatusListStore | Promise<StatusListStore>,
): ContractCase[] => [
	{
		name: "get of an unknown list is null",
		run: async () => {
			const store = await makeStore();
			check((await store.get(listIds.first)) === null, "expected null");
		},
	},
	{
		name: "putIfAbsent writes once; get returns the value and the same etag",
		run: async () => {
			const store = await makeStore();
			const record = sampleRecord(listIds.first, "uOne");
			const outcome = await store.putIfAbsent(listIds.first, record);
			check(outcome.status === "written", "first putIfAbsent must write");
			const read = await store.get(listIds.first);
			same(read?.value, record, "get after putIfAbsent");
			check(
				outcome.status === "written" && read?.etag === outcome.etag,
				"etag from put must equal etag from get",
			);
			const again = await store.putIfAbsent(
				listIds.first,
				sampleRecord(listIds.first, "uTwo"),
			);
			check(again.status === "conflict", "second putIfAbsent must conflict");
			same(
				(await store.get(listIds.first))?.value,
				record,
				"unchanged after conflict",
			);
		},
	},
	{
		name: "putIfMatch with the current etag writes and changes the etag",
		run: async () => {
			const store = await makeStore();
			await store.putIfAbsent(
				listIds.first,
				sampleRecord(listIds.first, "uOne"),
			);
			const before = await store.get(listIds.first);
			check(before !== null, "list exists");
			const next = sampleRecord(listIds.first, "uTwo");
			const outcome = await store.putIfMatch(
				listIds.first,
				next,
				before?.etag ?? "",
			);
			check(outcome.status === "written", "must write");
			const after = await store.get(listIds.first);
			same(after?.value, next, "value after putIfMatch");
			check(after?.etag !== before?.etag, "etag must change with the content");
		},
	},
	{
		name: "putIfMatch with a stale etag conflicts and changes nothing",
		run: async () => {
			const store = await makeStore();
			await store.putIfAbsent(
				listIds.first,
				sampleRecord(listIds.first, "uOne"),
			);
			const stale = (await store.get(listIds.first))?.etag ?? "";
			await store.putIfMatch(
				listIds.first,
				sampleRecord(listIds.first, "uTwo"),
				stale,
			);
			const outcome = await store.putIfMatch(
				listIds.first,
				sampleRecord(listIds.first, "uThree"),
				stale,
			);
			check(outcome.status === "conflict", "stale etag must conflict");
			same(
				(await store.get(listIds.first))?.value,
				sampleRecord(listIds.first, "uTwo"),
				"unchanged",
			);
		},
	},
	{
		name: "putIfMatch on a missing list conflicts",
		run: async () => {
			const store = await makeStore();
			const outcome = await store.putIfMatch(
				listIds.first,
				sampleRecord(listIds.first, "uOne"),
				'"any"',
			);
			check(outcome.status === "conflict", "must conflict");
			check((await store.get(listIds.first)) === null, "nothing written");
		},
	},
	{
		name: "of two concurrent putIfMatch on one etag, exactly one writes",
		run: async () => {
			const store = await makeStore();
			await store.putIfAbsent(
				listIds.first,
				sampleRecord(listIds.first, "uOne"),
			);
			const etag = (await store.get(listIds.first))?.etag ?? "";
			const outcomes = await Promise.all([
				store.putIfMatch(
					listIds.first,
					sampleRecord(listIds.first, "uLeft"),
					etag,
				),
				store.putIfMatch(
					listIds.first,
					sampleRecord(listIds.first, "uRight"),
					etag,
				),
			]);
			const written = outcomes.filter(
				(outcome) => outcome.status === "written",
			).length;
			check(written === 1, `exactly one write must land, ${written} did`);
		},
	},
	{
		name: "lists are kept apart by id",
		run: async () => {
			const store = await makeStore();
			await store.putIfAbsent(
				listIds.first,
				sampleRecord(listIds.first, "uOne"),
			);
			await store.putIfAbsent(
				listIds.second,
				sampleRecord(listIds.second, "uTwo"),
			);
			same(
				(await store.get(listIds.first))?.value,
				sampleRecord(listIds.first, "uOne"),
				"first",
			);
			same(
				(await store.get(listIds.second))?.value,
				sampleRecord(listIds.second, "uTwo"),
				"second",
			);
		},
	},
];
