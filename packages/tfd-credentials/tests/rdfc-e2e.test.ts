import { expect, test } from "bun:test";
import {
	ensureStatusList,
	JCS_SUITES,
	proofsOf,
	publicView,
	revoke,
	verifyCredential,
} from "../src/index.js";
import {
	CERTIFIABLE_PROOF_SUITES,
	issueCertifiable,
	RDFC_AND_JCS_SUITES,
} from "../src/rdfc.js";
import {
	CREDENTIAL_IDS,
	DAY,
	ISSUER_DID,
	LEVELS,
	NOW,
	setupIssuer,
} from "./fixtures.js";

const RDFC_LIST = "https://urlu.example/status/revocation/rdfc";

test("an rdfc credential and an rdfc status list: issue, verify, revoke, re-verify", async () => {
	const world = await setupIssuer("rdfc-e2e");
	await ensureStatusList({
		store: world.statusLists,
		id: RDFC_LIST,
		issuer: ISSUER_DID,
		statusPurpose: "revocation",
		signer: world.signer,
		now: NOW,
		proofSuites: CERTIFIABLE_PROOF_SUITES,
	});
	const { credential, event } = await issueCertifiable({
		kind: "achievement",
		credential: {
			id: CREDENTIAL_IDS.first,
			issuer: world.issuer,
			level: LEVELS.Mediator,
			holder: { reference: { value: "member-1", salt: "salt" } },
		},
		now: NOW,
		signer: world.signer,
		randomBytes: world.randomBytes,
		statusList: { store: world.statusLists, id: RDFC_LIST },
		credentials: world.credentials,
		actor: "staff-1",
	});
	expect(event.type).toBe("credential.issued");
	expect(proofsOf(credential)).toMatchObject([
		{ cryptosuite: "eddsa-rdfc-2022" },
	]);

	const options = {
		now: NOW + DAY,
		resolveDid: world.resolveDid,
		resolveStatusList: world.resolveStatusList,
		suites: RDFC_AND_JCS_SUITES,
	};
	const before = await verifyCredential(credential, options);
	expect([before.verified, before.status]).toEqual([true, "valid"]);

	// Re-signing the list needs its suite: the main entry's default (JCS only) is refused, not silently swapped.
	const change = {
		credential,
		now: NOW + DAY,
		signer: world.signer,
		statusLists: world.statusLists,
		actor: "staff-2",
	};
	await expect(revoke(change)).rejects.toMatchObject({
		code: "cryptosuite_unsupported",
	});
	expect(
		(await revoke({ ...change, suites: RDFC_AND_JCS_SUITES })).changed,
	).toBe(true);
	const list = (await world.statusLists.get(RDFC_LIST))?.value.credential;
	expect(proofsOf(list ?? {})).toMatchObject([
		{ cryptosuite: "eddsa-rdfc-2022" },
	]);

	const after = await verifyCredential(credential, {
		...options,
		now: NOW + 2 * DAY,
	});
	expect([after.verified, after.status]).toEqual([true, "revoked"]);
	expect(publicView(after)?.status).toBe("revoked");

	// A JCS-only verifier can verify neither the credential nor its rdfc-signed list.
	const jcsOnly = await verifyCredential(credential, {
		...options,
		suites: JCS_SUITES,
	});
	expect(jcsOnly.checks.signature).toMatchObject({
		reason: "cryptosuite_unsupported",
	});
});
