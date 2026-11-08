import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FolderStore } from "../../atm/src/store/folder-store.js";
import {
	memoryCredentialStore,
	memoryStatusListStore,
	type ObjectStore,
	objectStoreCredentialStore,
	objectStoreStatusListStore,
} from "../src/index.js";
import {
	type ContractCase,
	credentialStoreContract,
	memoryObjectStore,
	statusListStoreContract,
} from "../src/testing.js";

const run = (cases: ContractCase[]): void => {
	for (const { name, run: body } of cases) test(name, body);
};

describe("memory CredentialStore contract", () =>
	run(credentialStoreContract(memoryCredentialStore)));
describe("memory StatusListStore contract", () =>
	run(statusListStoreContract(memoryStatusListStore)));

describe("ObjectStore adapter over an in-memory object store", () => {
	describe("CredentialStore", () =>
		run(
			credentialStoreContract(() =>
				objectStoreCredentialStore(memoryObjectStore()),
			),
		));
	describe("StatusListStore", () =>
		run(
			statusListStoreContract(() =>
				objectStoreStatusListStore(memoryObjectStore()),
			),
		));
});

// atm's own FolderStore, unmodified: the structural ObjectStore interface must accept it as it is.
const folders: string[] = [];
const folderStore = async (): Promise<ObjectStore> => {
	const root = await mkdtemp(join(tmpdir(), "tfd-credentials-"));
	folders.push(root);
	return new FolderStore({ root });
};
afterAll(async () => {
	for (const root of folders) await rm(root, { recursive: true, force: true });
});

describe("ObjectStore adapter over atm's FolderStore", () => {
	describe("CredentialStore", () =>
		run(
			credentialStoreContract(async () =>
				objectStoreCredentialStore(await folderStore(), {
					prefix: "orgs/urlu/",
				}),
			),
		));
	describe("StatusListStore", () =>
		run(
			statusListStoreContract(async () =>
				objectStoreStatusListStore(await folderStore(), {
					prefix: "orgs/urlu/",
				}),
			),
		));

	test("a retried putIfMatch whose first try landed reads as written", async () => {
		const objects = await folderStore();
		const store = objectStoreStatusListStore(objects);
		const record = {
			credential: {
				"@context": ["https://www.w3.org/ns/credentials/v2"],
				id: "https://urlu.example/status/9",
				type: ["VerifiableCredential", "BitstringStatusListCredential"],
				issuer: "did:web:urlu.example",
				validFrom: "2026-01-01T00:00:00Z",
				credentialSubject: {
					id: "https://urlu.example/status/9#list",
					type: "BitstringStatusList" as const,
					statusPurpose: "revocation" as const,
					encodedList: "uA",
				},
			},
			allocations: "uA",
		};
		const created = await store.putIfAbsent(record.credential.id, record);
		if (created.status !== "written") throw new Error("not created");
		const next = { ...record, allocations: "uB" };
		const first = await store.putIfMatch(
			record.credential.id,
			next,
			created.etag,
		);
		const retry = await store.putIfMatch(
			record.credential.id,
			next,
			created.etag,
		);
		expect(first.status).toBe("written");
		expect(retry.status).toBe("written");
		const other = await store.putIfMatch(
			record.credential.id,
			{ ...record, allocations: "uC" },
			created.etag,
		);
		expect(other.status).toBe("conflict");
	});
});
