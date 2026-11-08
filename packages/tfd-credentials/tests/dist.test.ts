import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Builds dist/ into an empty directory and runs it under Node the way an outside consumer would: through the
 * `default` export condition, with @noble/* resolved as external dependencies.
 */
let dir: string;
const here = import.meta.dir;

beforeAll(async () => {
	dir = await mkdtemp(join(tmpdir(), "tfd-credentials-dist-"));
	const build = Bun.spawnSync([
		"bun",
		join(here, "../build.ts"),
		join(dir, "dist"),
	]);
	if (build.exitCode !== 0) throw new Error(build.stderr.toString());
	await symlink(join(here, "../node_modules"), join(dir, "node_modules"));
	await writeFile(
		join(dir, "package.json"),
		JSON.stringify({ type: "module" }),
	);
});

afterAll(async () => {
	await rm(dir, { recursive: true, force: true });
});

const SCRIPT = `
import * as library from "./dist/index.js";
import * as rdfc from "./dist/rdfc.js";
import { createTestKey, seededRandomBytes } from "./dist/testing.js";
const now = Date.UTC(2026, 10, 7);
const did = library.didWebFor("urlu.example");
const key = createTestKey("dist");
const signer = key.signer(did + "#key-1");
const document = library.buildDidWebDocument({ did, keys: [{ fragment: "key-1", publicKey: key.publicKey }] });
const resolveDid = library.composeDidResolver({ fetchJson: async () => document });
const statusLists = library.memoryStatusListStore();
const list = "https://urlu.example/status/1";
await library.ensureStatusList({ store: statusLists, id: list, issuer: did, statusPurpose: "revocation", signer, now });
const { credential } = await library.issue({
	kind: "achievement",
	credential: {
		id: library.credentialIdFromRandom(seededRandomBytes("id")),
		issuer: library.issuerProfile({ id: did, name: "URLU Institute" }),
		level: library.urluLevels("https://urlu.example/a").Coach,
		holder: { id: "did:example:x" },
	},
	now, signer, randomBytes: seededRandomBytes("index"),
	statusList: { store: statusLists, id: list },
	credentials: library.memoryCredentialStore(),
	actor: "dist",
});
const resolveStatusList = async (url) => (await statusLists.get(url)).value.credential;
const before = await library.verifyCredential(credential, { now, resolveDid, resolveStatusList });
await library.revoke({ credential, now, signer, statusLists, actor: "dist" });
const after = await library.verifyCredential(credential, { now, resolveDid, resolveStatusList });
let instance = false;
try { library.canonicalize(Number.NaN); } catch (error) { instance = error instanceof library.CredentialsError; }
const both = await library.addProofSet(
	library.buildAchievementCredential({
		id: library.credentialIdFromRandom(seededRandomBytes("id2")),
		issuer: library.issuerProfile({ id: did, name: "URLU Institute" }),
		level: library.urluLevels("https://urlu.example/a").Mediator,
		holder: { id: "did:example:y" },
		now,
	}),
	{ signer, created: library.formatDateTimeStamp(now), suites: rdfc.RDFC_AND_JCS_PROOFS },
);
const rdfcResult = await library.verifyCredential(both, { now, resolveDid, suites: rdfc.RDFC_AND_JCS_SUITES });
console.log(JSON.stringify({
	before: before.status,
	after: after.status,
	verified: after.verified,
	instance,
	rdfc: rdfcResult.proofs.map((proof) => proof.outcome).join(","),
}));
`;

test("the main entry's dist files never contain JSON-LD", async () => {
	for (const file of ["index.js", "testing.js"]) {
		const text = await Bun.file(join(dir, "dist", file)).text();
		const chunks = [...text.matchAll(/from "\.\/([^"]+)"/g)].map(
			(match) => match[1] as string,
		);
		for (const name of [file, ...chunks]) {
			const body = await Bun.file(join(dir, "dist", name)).text();
			expect({ name, jsonld: /RDFC-1\.0|jsonld/.test(body) }).toEqual({
				name,
				jsonld: false,
			});
		}
	}
});

test("dist works under Node from the default export condition", async () => {
	await writeFile(join(dir, "smoke.mjs"), SCRIPT);
	const run = Bun.spawnSync(["node", join(dir, "smoke.mjs")], { cwd: dir });
	expect(run.stderr.toString()).toBe("");
	expect(JSON.parse(run.stdout.toString())).toEqual({
		before: "valid",
		after: "revoked",
		verified: true,
		instance: true,
		rdfc: "verified,verified",
	});
});
