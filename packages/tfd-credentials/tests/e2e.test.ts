import { describe, expect, test } from "bun:test";
import {
	issue,
	proofsOf,
	publicView,
	reinstate,
	revoke,
	suspend,
	verifyCredential,
} from "../src/index.js";
import {
	CREDENTIAL_IDS,
	DAY,
	ISSUER_DID,
	KEY_ID,
	LEVELS,
	NOW,
	REVOCATION_LIST,
	SUSPENSION_LIST,
	setupIssuer,
} from "./fixtures.js";

describe("issue, store, verify, revoke, re-verify", () => {
	test("the whole lifecycle of an achievement credential", async () => {
		const world = await setupIssuer();
		const { credential, event } = await world.issueMediator(
			CREDENTIAL_IDS.first,
		);

		// Stored, findable by holder and level, and the event carries no personal data.
		expect((await world.credentials.get(credential.id))?.credential).toEqual(
			credential,
		);
		expect(
			(await world.credentials.list({ holder: "member-1", level: "Mediator" }))
				.length,
		).toBe(1);
		expect(event).toEqual({
			type: "credential.issued",
			credentialId: CREDENTIAL_IDS.first,
			at: "2026-11-07T12:00:00Z",
			actor: "staff-1",
			onBehalfOf: "org-urlu",
			statusPurpose: "revocation",
			statusListCredential: REVOCATION_LIST,
			statusListIndex: credential.credentialStatus?.statusListIndex as string,
		});
		expect(JSON.stringify(event)).not.toContain("Ada");
		expect(proofsOf(credential)).toMatchObject([
			{ verificationMethod: KEY_ID },
		]);

		const online = {
			now: NOW + DAY,
			resolveDid: world.resolveDid,
			resolveStatusList: world.resolveStatusList,
		};
		const before = await verifyCredential(structuredClone(credential), online);
		expect(before.verified).toBe(true);
		expect(before.status).toBe("valid");
		expect(before.checks).toMatchObject({
			structure: { outcome: "passed" },
			signature: { outcome: "passed" },
			issuerKey: { outcome: "passed" },
			validity: { outcome: "passed" },
			status: { state: "valid", reason: null },
		});

		// Offline: valid when issued, status unchecked. Never "valid".
		const offline = await verifyCredential(credential, {
			now: NOW + DAY,
			resolveDid: world.resolveDid,
		});
		expect(offline.verified).toBe(true);
		expect(offline.status).toBe("unchecked");
		expect(offline.checks.status.reason).toBe("status_resolver_missing");

		// The status list is signed and served; revoke flips its bit through put-if-match.
		const listBefore = await world.statusLists.get(REVOCATION_LIST);
		const revoked = await revoke({
			credential,
			now: NOW + 2 * DAY,
			signer: world.signer,
			statusLists: world.statusLists,
			actor: "staff-2",
		});
		expect(revoked.changed).toBe(true);
		expect(revoked.event?.type).toBe("credential.revoked");
		expect(revoked.event?.onBehalfOf).toBeUndefined();
		const listAfter = await world.statusLists.get(REVOCATION_LIST);
		expect(listAfter?.etag).not.toBe(listBefore?.etag);

		const after = await verifyCredential(credential, {
			...online,
			now: NOW + 3 * DAY,
		});
		expect(after.verified).toBe(true);
		expect(after.status).toBe("revoked");

		// Revoking again is a no-op; a revocation cannot be undone.
		expect(
			(
				await revoke({
					credential,
					now: NOW + 4 * DAY,
					signer: world.signer,
					statusLists: world.statusLists,
					actor: "x",
				})
			).changed,
		).toBe(false);
		await expect(
			reinstate({
				credential,
				now: NOW,
				signer: world.signer,
				statusLists: world.statusLists,
				actor: "x",
			}),
		).rejects.toMatchObject({ code: "status_entry_missing" });

		// The public page sees only what it may.
		const view = publicView(after);
		expect(view).toEqual({
			level: "Mediator",
			achievementName: "URLU Certified Mediator",
			issuedOn: "2026-11-07T12:00:00Z",
			validUntil: null,
			status: "revoked",
			issuerName: "URLU Institute",
		});
		expect(publicView(after, { includeName: true })?.name).toBe("Ada Example");
	});

	test("a standing credential is suspended and reinstated; it expires after a year", async () => {
		const world = await setupIssuer("standing");
		const { credential } = await issue({
			kind: "standing",
			credential: {
				id: CREDENTIAL_IDS.second,
				issuer: world.issuer,
				level: LEVELS.Coach,
				holder: { id: "did:example:coach" },
			},
			now: NOW,
			signer: world.signer,
			randomBytes: world.randomBytes,
			statusList: { store: world.statusLists, id: SUSPENSION_LIST },
			credentials: world.credentials,
			actor: "staff-1",
		});
		expect(credential.credentialStatus?.statusPurpose).toBe("suspension");
		const options = {
			now: NOW + DAY,
			resolveDid: world.resolveDid,
			resolveStatusList: world.resolveStatusList,
		};
		const change = {
			credential,
			signer: world.signer,
			statusLists: world.statusLists,
			actor: "staff-1",
		};

		await suspend({ ...change, now: NOW + DAY });
		expect((await verifyCredential(credential, options)).status).toBe(
			"suspended",
		);
		const back = await reinstate({ ...change, now: NOW + DAY });
		expect(back.event?.type).toBe("credential.reinstated");
		expect((await verifyCredential(credential, options)).status).toBe("valid");

		const lapsed = await verifyCredential(credential, {
			...options,
			now: NOW + 366 * DAY,
		});
		expect(lapsed.verified).toBe(false);
		expect(lapsed.checks.validity).toMatchObject({
			outcome: "failed",
			reason: "expired",
		});
		expect(publicView(lapsed)?.validUntil).toBe("2027-11-07T12:00:00Z");
	});

	test("concurrent issues and revocations on one list all land, none clobbered", async () => {
		const world = await setupIssuer("concurrency");
		const issued = await Promise.all([
			world.issueMediator(CREDENTIAL_IDS.first, "member-1"),
			world.issueMediator(CREDENTIAL_IDS.second, "member-2"),
			world.issueMediator(CREDENTIAL_IDS.third, "member-3"),
		]);
		const indexes = new Set(
			issued.map(
				({ credential }) => credential.credentialStatus?.statusListIndex,
			),
		);
		expect(indexes.size).toBe(3);
		await Promise.all(
			issued.slice(0, 2).map(({ credential }) =>
				revoke({
					credential,
					now: NOW,
					signer: world.signer,
					statusLists: world.statusLists,
					actor: "staff",
				}),
			),
		);
		const options = {
			now: NOW,
			resolveDid: world.resolveDid,
			resolveStatusList: world.resolveStatusList,
		};
		const states = await Promise.all(
			issued.map(({ credential }) => verifyCredential(credential, options)),
		);
		expect(states.map((result) => result.status)).toEqual([
			"revoked",
			"revoked",
			"valid",
		]);
	});

	test("the issuer's signer must be a key of the issuer, and ids are not reused", async () => {
		const world = await setupIssuer("guards");
		await world.issueMediator(CREDENTIAL_IDS.first);
		const other = { ...world.signer, keyId: "did:web:other.example#key-1" };
		await expect(
			issue({
				kind: "achievement",
				credential: {
					id: CREDENTIAL_IDS.second,
					issuer: world.issuer,
					level: LEVELS.Coach,
					holder: { id: "did:example:x" },
				},
				now: NOW,
				signer: other,
				randomBytes: world.randomBytes,
				statusList: { store: world.statusLists, id: REVOCATION_LIST },
				credentials: world.credentials,
				actor: "staff",
			}),
		).rejects.toMatchObject({ code: "signer_invalid" });
		await expect(
			issue({
				kind: "achievement",
				credential: {
					id: CREDENTIAL_IDS.first,
					issuer: world.issuer,
					level: LEVELS.Coach,
					holder: { id: "did:example:x" },
				},
				now: NOW,
				signer: world.signer,
				randomBytes: world.randomBytes,
				statusList: { store: world.statusLists, id: REVOCATION_LIST },
				credentials: world.credentials,
				actor: "staff",
			}),
		).rejects.toMatchObject({ code: "credential_conflict" });
		expect(ISSUER_DID).toBe("did:web:urlu.example");
	});
});
