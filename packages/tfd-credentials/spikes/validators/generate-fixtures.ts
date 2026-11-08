/**
 * Interop spike: generate the fixture matrix with tfd-credentials itself, deterministically.
 *
 *   bun spikes/validators/generate-fixtures.ts <output dir>
 *
 * Writes `<out>/credentials/<name>.json`, `<out>/manifest.json` (what each fixture is and what a correct verifier
 * should say) and `<out>/site/` (the did:web documents and signed status lists, to be served at
 * https://localhost:8443/). Keys are derived at run time from labels (`createTestKey`); no key material is written.
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
	addProof,
	buildAchievementCredential,
	buildDidWebDocument,
	type DidDocument,
	didKeyFromPublicKey,
	didWebFor,
	didWebToUrl,
	eddsaJcs2022,
	ensureStatusList,
	issue,
	issuerProfile,
	type LevelDefinition,
	memoryCredentialStore,
	memoryStatusListStore,
	type OpenBadgeCredential,
	type ProofSuite,
	revoke,
	type Signer,
	type StatusListStore,
	suspend,
	URLU_ISSUER_NAME,
	urluLevels,
} from "../../src/index.js";
import {
	CERTIFIABLE_PROOF_SUITES,
	eddsaRdfc2022,
	RDFC_AND_JCS_PROOFS,
	RDFC_AND_JCS_SUITES,
} from "../../src/rdfc.js";
import { createTestKey, seededRandomBytes } from "../../src/testing.js";

const ORIGIN = "https://localhost:8443";
const HOST = "localhost";
const PORT = 8443;
/** 2026-11-01T12:00:00Z: in the past for every verifier's real clock, so validFrom never trips. */
const NOW = Date.UTC(2026, 10, 1, 12, 0, 0);
const DAY = 24 * 60 * 60 * 1000;
const created = new Date(NOW).toISOString().replace(".000Z", "Z");

const outDir = process.argv[2];
if (outDir === undefined) {
	console.error("usage: bun generate-fixtures.ts <output dir>");
	process.exit(2);
}
rmSync(outDir, { recursive: true, force: true });

const writeJson = (path: string, value: unknown): void => {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
};

/** The site path a URL on ORIGIN is served from. */
const sitePath = (url: string): string => {
	if (!url.startsWith(`${ORIGIN}/`))
		throw new Error(`not on ${ORIGIN}: ${url}`);
	return join(outDir, "site", url.slice(ORIGIN.length + 1));
};

type Expectation = {
	/** What a verifier that follows VC DI 1.0, VC DM 2.0, BSL 1.0 and OB 3.0 should conclude. */
	verdict: "accept" | "reject";
	/** For accepted ones: the status a status-checking verifier should report. */
	status?: "valid" | "revoked" | "suspended" | "none";
	note: string;
};
const manifest: Record<string, Expectation & { issuer: string }> = {};

type Issuer = {
	slug: string;
	did: string;
	signer: Signer;
	/** A key that is NOT an authorised assertionMethod of `did` (did:web: listed but not authorised; did:key: another DID). */
	rogue: Signer;
	/** The rogue key under a verificationMethod that names the ISSUER as controller with the key in the fragment. */
	fragmentForgery: Signer;
	statusLists: StatusListStore;
	lists: {
		revocationRdfc: string;
		suspensionRdfc: string;
		revocationJcs: string;
	};
};

const makeIssuer = async (
	slug: string,
	kind: "key" | "web-path" | "web-root",
): Promise<Issuer> => {
	const key = createTestKey(`interop spike ${slug} issuer`);
	const rogueKey = createTestKey(`interop spike ${slug} rogue`);
	let did: string;
	let signer: Signer;
	let rogue: Signer;
	if (kind === "key") {
		did = didKeyFromPublicKey(key.publicKey);
		signer = key.signer(`${did}#${key.publicKeyMultibase}`);
		const rogueDid = didKeyFromPublicKey(rogueKey.publicKey);
		rogue = rogueKey.signer(`${rogueDid}#${rogueKey.publicKeyMultibase}`);
	} else {
		did =
			kind === "web-path"
				? didWebFor(HOST, { port: PORT, path: ["issuers", slug] })
				: didWebFor(HOST, { port: PORT });
		signer = key.signer(`${did}#key-1`);
		rogue = rogueKey.signer(`${did}#key-2`);
		const document: DidDocument = buildDidWebDocument({
			did,
			keys: [
				{ fragment: "key-1", publicKey: key.publicKey },
				{ fragment: "key-2", publicKey: rogueKey.publicKey },
			],
			assertionMethod: ["key-1"],
		});
		writeJson(sitePath(didWebToUrl(did)), document);
	}
	const statusLists = memoryStatusListStore();
	const lists = {
		revocationRdfc: `${ORIGIN}/status/${slug}/revocation-rdfc`,
		suspensionRdfc: `${ORIGIN}/status/${slug}/suspension-rdfc`,
		revocationJcs: `${ORIGIN}/status/${slug}/revocation-jcs`,
	};
	const listSpecs: [
		string,
		"revocation" | "suspension",
		readonly ProofSuite[],
	][] = [
		[lists.revocationRdfc, "revocation", CERTIFIABLE_PROOF_SUITES],
		[lists.suspensionRdfc, "suspension", CERTIFIABLE_PROOF_SUITES],
		[lists.revocationJcs, "revocation", [eddsaJcs2022]],
	];
	for (const [id, statusPurpose, proofSuites] of listSpecs) {
		await ensureStatusList({
			store: statusLists,
			id,
			issuer: did,
			statusPurpose,
			signer,
			now: NOW,
			proofSuites,
		});
	}
	const fragmentForgery = rogueKey.signer(
		`${did}#${rogueKey.publicKeyMultibase}`,
	);
	return { slug, did, signer, rogue, fragmentForgery, statusLists, lists };
};

const levels = urluLevels(`${ORIGIN}/achievements`);
/** A level whose text exercises N-Quads escaping: tab, newline, quote, backslash, non-ASCII, astral, DEL. */
const escapesLevel: LevelDefinition = {
	level: "Mediator",
	achievementId: `${ORIGIN}/achievements/mediator-escapes`,
	name: "URLU Certified Mediator (escapes test)",
	description:
		'Certified by the URLU Institute as a Mediator.\tTab, "quotes", back\\slash,\nnewline, café, 調停, 🕊️, DEL\u007f end.',
	criteria: { narrative: "Pass the assessed mediations." },
};

const randomBytes = seededRandomBytes("interop spike entropy");
let idCounter = 0;
const nextId = (): string =>
	`urn:uuid:5f0c2a4e-8b1d-4c3a-9e2f-${(++idCounter).toString(16).padStart(12, "0")}`;

const credentialsDir = join(outDir, "credentials");
const fixtures = new Map<string, OpenBadgeCredential>();
const save = (
	name: string,
	issuer: Issuer,
	credential: unknown,
	expectation: Expectation,
): void => {
	fixtures.set(name, credential as OpenBadgeCredential);
	writeJson(join(credentialsDir, `${name}.json`), credential);
	manifest[name] = { ...expectation, issuer: issuer.did };
};

const issueOne = async (
	issuer: Issuer,
	options: {
		level: LevelDefinition;
		kind?: "achievement" | "standing";
		list: string;
		statusPurpose?: "revocation" | "suspension";
		suites: readonly ProofSuite[];
		validFrom?: number;
		validUntil?: number;
		holderReference: string;
	},
): Promise<OpenBadgeCredential> => {
	const { credential } = await issue({
		kind: options.kind ?? "achievement",
		credential: {
			id: nextId(),
			issuer: issuerProfile({
				id: issuer.did,
				name: URLU_ISSUER_NAME,
				url: "https://urlu.example",
			}),
			level: options.level,
			holder: {
				reference: { value: options.holderReference, salt: "interop-salt" },
				name: "Ada Example",
			},
			...(options.validFrom === undefined
				? {}
				: { validFrom: options.validFrom }),
			...(options.validUntil === undefined
				? {}
				: { validUntil: options.validUntil }),
		},
		now: NOW,
		signer: issuer.signer,
		randomBytes,
		statusList: {
			store: issuer.statusLists,
			id: options.list,
			...(options.statusPurpose === undefined
				? {}
				: { statusPurpose: options.statusPurpose }),
		},
		credentials: memoryCredentialStore(),
		actor: "spike",
		proofSuites: options.suites,
	});
	return credential;
};

const clone = <Value>(value: Value): Value => structuredClone(value);
const withoutProof = (
	credential: OpenBadgeCredential,
): Record<string, unknown> => {
	const { proof: _proof, ...rest } = credential;
	return rest;
};
/** Flip one base58 character in the middle of a proofValue (stays valid base58, wrong signature). */
const corrupt = (proofValue: string): string => {
	const middle = Math.floor(proofValue.length / 2);
	const replacement = proofValue[middle] === "A" ? "B" : "A";
	return `${proofValue.slice(0, middle)}${replacement}${proofValue.slice(middle + 1)}`;
};
const proofArray = (credential: OpenBadgeCredential) =>
	Array.isArray(credential.proof)
		? credential.proof
		: credential.proof === undefined
			? []
			: [credential.proof];

const generateFor = async (issuer: Issuer, full: boolean): Promise<void> => {
	const prefix = issuer.slug;
	const a = await issueOne(issuer, {
		level: levels.Mediator,
		list: issuer.lists.revocationRdfc,
		suites: CERTIFIABLE_PROOF_SUITES,
		holderReference: `${prefix}-a`,
	});
	save(`${prefix}.A-rdfc`, issuer, a, {
		verdict: "accept",
		status: "valid",
		note: "issueCertifiable: one eddsa-rdfc-2022 proof, revocation entry on an rdfc-signed list",
	});
	if (!full) return;

	const b = await issueOne(issuer, {
		level: levels.Coach,
		list: issuer.lists.revocationJcs,
		suites: [eddsaJcs2022],
		holderReference: `${prefix}-b`,
	});
	save(`${prefix}.B-jcs`, issuer, b, {
		verdict: "accept",
		status: "valid",
		note: "main-entry issue(): one eddsa-jcs-2022 proof, revocation entry on a JCS-signed list. Valid VC DI, not certifiable (OB3 cert guide 3.1.1).",
	});

	const c = await issueOne(issuer, {
		level: levels.Participant,
		list: issuer.lists.revocationRdfc,
		suites: RDFC_AND_JCS_PROOFS,
		holderReference: `${prefix}-c`,
	});
	save(`${prefix}.C-set`, issuer, c, {
		verdict: "accept",
		status: "valid",
		note: "proof set [rdfc, jcs]",
	});

	const cReversed = await issueOne(issuer, {
		level: levels.Participant,
		list: issuer.lists.revocationRdfc,
		suites: [eddsaJcs2022, eddsaRdfc2022],
		holderReference: `${prefix}-c2`,
	});
	save(`${prefix}.C-set-jcs-first`, issuer, cReversed, {
		verdict: "accept",
		status: "valid",
		note: "proof set [jcs, rdfc]: order must not matter (VC DI 2.1.1)",
	});

	const unsignedNoStatus = buildAchievementCredential({
		id: nextId(),
		issuer: issuerProfile({ id: issuer.did, name: URLU_ISSUER_NAME }),
		level: levels.Mediator,
		holder: { reference: { value: `${prefix}-nostatus`, salt: "s" } },
		now: NOW,
	});
	save(
		`${prefix}.A-rdfc-nostatus`,
		issuer,
		await addProof(unsignedNoStatus as unknown as Record<string, unknown>, {
			signer: issuer.signer,
			created,
			suite: eddsaRdfc2022,
		}),
		{
			verdict: "accept",
			status: "none",
			note: "rdfc, no credentialStatus at all (isolates status-list problems)",
		},
	);

	const escapes = await issueOne(issuer, {
		level: escapesLevel,
		list: issuer.lists.revocationRdfc,
		suites: CERTIFIABLE_PROOF_SUITES,
		holderReference: `${prefix}-escapes`,
	});
	save(`${prefix}.A-rdfc-escapes`, issuer, escapes, {
		verdict: "accept",
		status: "valid",
		note: "rdfc; description has tab, newline, quote, backslash, non-ASCII, astral and U+007F: probes canonical N-Quads escaping",
	});

	const expired = await issueOne(issuer, {
		level: levels.Coach,
		list: issuer.lists.revocationRdfc,
		suites: CERTIFIABLE_PROOF_SUITES,
		validFrom: Date.UTC(2025, 0, 1),
		validUntil: Date.UTC(2025, 11, 31),
		holderReference: `${prefix}-expired`,
	});
	save(`${prefix}.E-expired`, issuer, expired, {
		verdict: "reject",
		note: "rdfc, validUntil 2025-12-31 (past)",
	});

	const revoked = await issueOne(issuer, {
		level: levels.Mediator,
		list: issuer.lists.revocationRdfc,
		suites: CERTIFIABLE_PROOF_SUITES,
		holderReference: `${prefix}-revoked`,
	});
	await revoke({
		credential: revoked,
		now: NOW + DAY,
		signer: issuer.signer,
		statusLists: issuer.statusLists,
		actor: "spike",
		suites: RDFC_AND_JCS_SUITES,
	});
	save(`${prefix}.E-revoked`, issuer, revoked, {
		verdict: "reject",
		status: "revoked",
		note: "rdfc, revocation bit set on the rdfc list",
	});

	const standing = await issueOne(issuer, {
		level: levels.Coach,
		kind: "standing",
		list: issuer.lists.suspensionRdfc,
		suites: CERTIFIABLE_PROOF_SUITES,
		holderReference: `${prefix}-standing`,
	});
	save(`${prefix}.E-standing-ok`, issuer, standing, {
		verdict: "accept",
		status: "valid",
		note: "standing (annual) credential, suspension entry, bit clear",
	});

	const suspended = await issueOne(issuer, {
		level: levels.Coach,
		kind: "standing",
		list: issuer.lists.suspensionRdfc,
		suites: CERTIFIABLE_PROOF_SUITES,
		holderReference: `${prefix}-suspended`,
	});
	await suspend({
		credential: suspended,
		now: NOW + DAY,
		signer: issuer.signer,
		statusLists: issuer.statusLists,
		actor: "spike",
		suites: RDFC_AND_JCS_SUITES,
	});
	save(`${prefix}.E-suspended`, issuer, suspended, {
		verdict: "reject",
		status: "suspended",
		note: "standing credential, suspension bit set",
	});

	// G: tampered copies.
	const tamperField = clone(a);
	tamperField.credentialSubject.achievement.name =
		"URLU Certified Grand Mediator";
	save(`${prefix}.G-A-field`, issuer, tamperField, {
		verdict: "reject",
		note: "A with achievement.name changed after signing",
	});

	const tamperContext302 = clone(a);
	tamperContext302["@context"] = [
		"https://www.w3.org/ns/credentials/v2",
		"https://purl.imsglobal.org/spec/ob/v3p0/context-3.0.2.json",
	];
	save(`${prefix}.G-A-context-302`, issuer, tamperContext302, {
		verdict: "reject",
		note: "A with the OB context swapped to context-3.0.2.json. If 3.0.2 maps every used term to the same IRI, the RDF is unchanged and an rdfc signature still verifies; a verifier must then reject on context policy, not signature",
	});

	const tamperContextCopy = clone(a);
	tamperContextCopy["@context"] = [
		"https://www.w3.org/ns/credentials/v2",
		`${ORIGIN}/contexts/ob-3.0.3-copy.json`,
	];
	save(`${prefix}.G-A-context-copy`, issuer, tamperContextCopy, {
		verdict: "reject",
		note: "A with the OB context swapped to an attacker-hosted byte copy of 3.0.3 (same RDF). Only a context allow-list catches it",
	});

	const tamperUnmapped = clone(a) as unknown as Record<string, unknown>;
	tamperUnmapped.unmappedTerm = "added after signing";
	save(`${prefix}.G-A-unmapped-term`, issuer, tamperUnmapped, {
		verdict: "reject",
		note: "A plus a top-level term no context defines. rdfc drops it in non-safe JSON-LD, so only safe mode / a schema rejects it",
	});

	const tamperUnmappedSubject = clone(a) as unknown as {
		credentialSubject: Record<string, unknown>;
	};
	tamperUnmappedSubject.credentialSubject.favouriteColour = "blue";
	save(`${prefix}.G-A-unmapped-subject-term`, issuer, tamperUnmappedSubject, {
		verdict: "reject",
		note: "A plus credentialSubject.favouriteColour (undefined term) after signing",
	});

	save(`${prefix}.G-A-no-proof`, issuer, withoutProof(a), {
		verdict: "reject",
		note: "A with proof removed",
	});

	const rogueSigned = await addProof(withoutProof(a), {
		signer: issuer.rogue,
		created,
		suite: eddsaRdfc2022,
	});
	save(`${prefix}.G-A-rogue-key`, issuer, rogueSigned, {
		verdict: "reject",
		note:
			issuer.slug === "didkey"
				? "A re-signed (valid signature) by another did:key: controller is not the issuer"
				: "A re-signed (valid signature) by key-2, listed in verificationMethod but not in assertionMethod",
	});

	const fragmentForged = await addProof(withoutProof(a), {
		signer: issuer.fragmentForgery,
		created,
		suite: eddsaRdfc2022,
	});
	save(`${prefix}.G-A-fragment-key-forgery`, issuer, fragmentForged, {
		verdict: "reject",
		note: "A re-signed by the rogue key with verificationMethod `<issuer DID>#<rogue publicKeyMultibase>`: the issuer's DID document does not contain that key, so resolution must fail",
	});

	const urlIssuerForged = await addProof(
		{
			...withoutProof(a),
			issuer: issuerProfile({
				id: "https://urlu.example/issuers/1",
				name: URLU_ISSUER_NAME,
			}),
		},
		{
			signer: {
				keyId: `https://urlu.example/issuers/1#${createTestKey(`interop spike ${prefix} rogue`).publicKeyMultibase}`,
				sign: issuer.rogue.sign,
			},
			created,
			suite: eddsaRdfc2022,
		},
	);
	save(`${prefix}.G-A-url-issuer-forgery`, issuer, urlIssuerForged, {
		verdict: "reject",
		note: "issuer changed to an https URL the forger does not control, signed by the rogue key, verificationMethod `<issuer URL>#<rogue publicKeyMultibase>` (the OB3 spec examples' form). Nothing proves the URL's owner holds the key",
	});

	const swappedMethod = clone(a);
	const [aProof] = proofArray(swappedMethod);
	if (aProof !== undefined) aProof.verificationMethod = issuer.rogue.keyId;
	save(`${prefix}.G-A-vm-swap`, issuer, swappedMethod, {
		verdict: "reject",
		note: "A with proof.verificationMethod pointed at the rogue key, not re-signed",
	});

	const setField = clone(c);
	setField.credentialSubject.achievement.description =
		"Certified by the URLU Institute as a Grand Mediator.";
	save(`${prefix}.G-C-field`, issuer, setField, {
		verdict: "reject",
		note: "C (proof set) with achievement.description changed",
	});

	const stripRdfc = clone(c);
	stripRdfc.proof = proofArray(c).filter(
		(proof) => proof.cryptosuite !== "eddsa-rdfc-2022",
	);
	save(`${prefix}.G-C-strip-rdfc`, issuer, stripRdfc, {
		verdict: "accept",
		status: "valid",
		note: "C with the rdfc proof removed: a genuine JCS-only credential (proof as a 1-element array). Valid VC DI; not certifiable",
	});

	const stripJcs = clone(c);
	stripJcs.proof = proofArray(c).filter(
		(proof) => proof.cryptosuite !== "eddsa-jcs-2022",
	);
	save(`${prefix}.G-C-strip-jcs`, issuer, stripJcs, {
		verdict: "accept",
		status: "valid",
		note: "C with the jcs proof removed: a genuine rdfc-only credential (proof as a 1-element array)",
	});

	const badJcs = clone(c);
	badJcs.proof = proofArray(c).map((proof) =>
		proof.cryptosuite === "eddsa-jcs-2022"
			? { ...proof, proofValue: corrupt(proof.proofValue) }
			: proof,
	);
	save(`${prefix}.G-C-bad-jcs`, issuer, badJcs, {
		verdict: "reject",
		note: "C with the jcs proofValue corrupted, rdfc intact. VC DI 4.5 / 2.1.1: a proof set verifies only if every proof does",
	});

	const badRdfc = clone(c);
	badRdfc.proof = proofArray(c).map((proof) =>
		proof.cryptosuite === "eddsa-rdfc-2022"
			? { ...proof, proofValue: corrupt(proof.proofValue) }
			: proof,
	);
	save(`${prefix}.G-C-bad-rdfc`, issuer, badRdfc, {
		verdict: "reject",
		note: "C with the rdfc proofValue corrupted, jcs intact",
	});

	const setRogue = clone(c);
	const rogueRdfc = await addProof(withoutProof(c), {
		signer: issuer.rogue,
		created,
		suite: eddsaRdfc2022,
	});
	setRogue.proof = proofArray(c).map((proof) =>
		proof.cryptosuite === "eddsa-rdfc-2022" ? rogueRdfc.proof : proof,
	);
	save(`${prefix}.G-C-rogue-rdfc`, issuer, setRogue, {
		verdict: "reject",
		note: "C with its rdfc proof replaced by a valid rdfc proof from the rogue key; jcs proof intact",
	});
};

const publishLists = async (issuer: Issuer): Promise<void> => {
	for (const id of Object.values(issuer.lists)) {
		const record = await issuer.statusLists.get(id);
		if (record === null) throw new Error(`missing list ${id}`);
		writeJson(sitePath(id), record.value.credential);
	}
};

const issuers = [
	{ issuer: await makeIssuer("didkey", "key"), full: true },
	{ issuer: await makeIssuer("webpath", "web-path"), full: true },
	{ issuer: await makeIssuer("webroot", "web-root"), full: false },
];
for (const { issuer, full } of issuers) {
	await generateFor(issuer, full);
	await publishLists(issuer);
}

// The attacker-hosted context copy for G-A-context-copy: the bundled 3.0.3 bytes.
const { BUNDLED_CONTEXTS } = await import("../../src/rdfc.js");
writeJson(
	join(outDir, "site", "contexts", "ob-3.0.3-copy.json"),
	BUNDLED_CONTEXTS.get(
		"https://purl.imsglobal.org/spec/ob/v3p0/context-3.0.3.json",
	),
);
writeJson(join(outDir, "manifest.json"), {
	generatedWith:
		"tfd-credentials (this repo), spikes/validators/generate-fixtures.ts",
	now: created,
	origin: ORIGIN,
	issuers: Object.fromEntries(
		issuers.map(({ issuer }) => [issuer.slug, issuer.did]),
	),
	fixtures: manifest,
});
console.log(`wrote ${fixtures.size} fixtures to ${outDir}`);
