import {
	buildDidWebDocument,
	composeDidResolver,
	type DidDocument,
	didWebFor,
	didWebToUrl,
	ensureStatusList,
	issue,
	issuerProfile,
	memoryCredentialStore,
	memoryStatusListStore,
	type Signer,
	type StatusListStore,
	URLU_ISSUER_NAME,
	urluLevels,
} from "../src/index.js";
import { createTestKey, seededRandomBytes } from "../src/testing.js";

export const NOW = Date.UTC(2026, 10, 7, 12, 0, 0);
export const DAY = 24 * 60 * 60 * 1000;

export const ISSUER_DID = didWebFor("urlu.example");
export const KEY_ID = `${ISSUER_DID}#key-1`;
export const REVOCATION_LIST = "https://urlu.example/status/revocation/1";
export const SUSPENSION_LIST = "https://urlu.example/status/suspension/1";
export const LEVELS = urluLevels("https://urlu.example/achievements");

/** A did:web issuer with one authorised key, its document served by a fake fetch, and memory stores. */
export const setupIssuer = async (label = "urlu") => {
	const key = createTestKey(label);
	const signer: Signer = key.signer(KEY_ID);
	const documents = new Map<string, DidDocument>([
		[
			didWebToUrl(ISSUER_DID),
			buildDidWebDocument({
				did: ISSUER_DID,
				keys: [{ fragment: "key-1", publicKey: key.publicKey }],
			}),
		],
	]);
	const resolveDid = composeDidResolver({
		fetchJson: async (url) => {
			const document = documents.get(url);
			if (document === undefined) throw new Error(`404 ${url}`);
			return structuredClone(document);
		},
	});
	const statusLists: StatusListStore = memoryStatusListStore();
	const credentials = memoryCredentialStore();
	for (const [id, statusPurpose] of [
		[REVOCATION_LIST, "revocation"],
		[SUSPENSION_LIST, "suspension"],
	] as const) {
		await ensureStatusList({
			store: statusLists,
			id,
			issuer: ISSUER_DID,
			statusPurpose,
			signer,
			now: NOW,
		});
	}
	const resolveStatusList = async (url: string): Promise<unknown> => {
		const record = await statusLists.get(url);
		if (record === null) throw new Error(`404 ${url}`);
		return structuredClone(record.value.credential);
	};
	const randomBytes = seededRandomBytes(`${label} entropy`);
	const issuer = issuerProfile({
		id: ISSUER_DID,
		name: URLU_ISSUER_NAME,
		url: "https://urlu.example",
	});
	const issueMediator = (id: string, holderKey = "member-1") =>
		issue({
			kind: "achievement",
			credential: {
				id,
				issuer,
				level: LEVELS.Mediator,
				holder: {
					reference: { value: holderKey, salt: "salt-for-tests" },
					name: "Ada Example",
				},
			},
			now: NOW,
			signer,
			randomBytes,
			statusList: { store: statusLists, id: REVOCATION_LIST },
			credentials,
			holderKey,
			actor: "staff-1",
			onBehalfOf: "org-urlu",
		});
	return {
		key,
		signer,
		documents,
		resolveDid,
		resolveStatusList,
		statusLists,
		credentials,
		randomBytes,
		issuer,
		issueMediator,
	};
};

export const CREDENTIAL_IDS = {
	first: "urn:uuid:7d3c1d4e-2f1a-4c55-9a51-0c8e2b6f1a01",
	second: "urn:uuid:7d3c1d4e-2f1a-4c55-9a51-0c8e2b6f1a02",
	third: "urn:uuid:7d3c1d4e-2f1a-4c55-9a51-0c8e2b6f1a03",
};
