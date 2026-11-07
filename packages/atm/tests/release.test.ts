import { beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { computeCheck } from "@autumn/balance-engine";
import {
	createCheckCommand,
	createState,
	createSubjectFor,
} from "../../balance-engine/tests/unit/engineFixtures.js";
import {
	assetName,
	assetUrl,
	digests,
	exportedNames,
	listTarball,
	PACKAGE_FILES,
	pack,
	publishManifest,
	publishReadme,
	publishStep,
	RELEASE_NAMES,
	REPO,
	releaseNotes,
	releaseTag,
	stage,
} from "../release.js";
import type { AtmCatalogRow, GrantCommand } from "../src/index.js";
import {
	DEFAULT_POLICY,
	EMPTY_GRANTS_STATE,
	invoiceToCommands,
	menuCatalogRows,
	runOnState,
	validateMenu,
} from "../src/index.js";

/** No network: the tarball is built, packed and installed from disk, as the family service would install it. */
const COMMIT = "0123456789abcdef0123456789abcdef01234567";
const root = join(import.meta.dir, "../../..");
const { version } = JSON.parse(
	readFileSync(join(import.meta.dir, "../package.json"), "utf8"),
) as { version: string };
const grantsDir = join(import.meta.dir, "../fixtures/billing/grants");
const fixture = (name: string) =>
	JSON.parse(readFileSync(join(grantsDir, `${name}.json`), "utf8"));

let work: string;
let distDir: string;
let tarball: string;
let atmTarball: string;

/** What a consumer script computes with the library: the same three calls, from the same input files. */
const consume = (lib: {
	runEngineCommand: (input: unknown) => unknown;
	validateMenu: (input: unknown) => { ok: boolean };
	invoiceToCommands: (input: never) => { commands: GrantCommand[] };
	runOnState: (input: never) => {
		state: { customerEntitlements: { id: string; balance: number }[] } | null;
	};
	menuCatalogRows: (input: never) => AtmCatalogRow[];
	DEFAULT_POLICY: unknown;
	EMPTY_GRANTS_STATE: unknown;
}) => {
	const command = createCheckCommand();
	const subject = createSubjectFor({
		state: createState(),
		entityId: command.identity.entityId,
	});
	const menu = fixture("menu");
	const invoice = fixture("inv-create-s2");
	const catalog = lib.menuCatalogRows({ menu, school: "sch_vol" } as never);
	const result = lib.invoiceToCommands({
		invoice,
		menu,
		policy: lib.DEFAULT_POLICY,
		state: lib.EMPTY_GRANTS_STATE,
		now: invoice.paidAt,
		menuVersion: 3,
		policyVersion: 1,
	} as never);
	let state: ReturnType<typeof lib.runOnState>["state"] = null;
	for (const c of result.commands)
		state = lib.runOnState({ state, catalog, command: c } as never).state;
	return {
		engine: JSON.parse(
			JSON.stringify(lib.runEngineCommand({ subject, command })),
		),
		menuOk: lib.validateMenu(menu).ok,
		commands: result.commands.map((c) => c.type),
		rows: state?.customerEntitlements.map(
			(r: { id: string; balance: number }) => [r.id, r.balance],
		),
	};
};

beforeAll(async () => {
	work = mkdtempSync(join(tmpdir(), "atm-release-test-"));
	distDir = join(work, "dist");
	const build = Bun.spawnSync([
		"bun",
		join(import.meta.dir, "../build.ts"),
		distDir,
	]);
	if (build.exitCode !== 0) throw new Error(build.stderr.toString());
	const stageDir = join(work, "stage");
	stage({ distDir, stageDir, version, commit: COMMIT, name: "tfd" });
	tarball = pack({ stageDir, outDir: join(work, "out"), version, name: "tfd" });
	const atmStageDir = join(work, "stage-atm");
	stage({
		distDir,
		stageDir: atmStageDir,
		version,
		commit: COMMIT,
		name: "atm",
	});
	atmTarball = pack({
		stageDir: atmStageDir,
		outDir: join(work, "out-atm"),
		version,
		name: "atm",
	});
}, 120_000);

describe("the publish package.json", () => {
	test("has exactly the fields B4 Uni's install needs, in this order", () => {
		const manifest = publishManifest("1.2.3", "tfd");
		expect(Object.keys(manifest)).toEqual([
			"name",
			"version",
			"license",
			"repository",
			"type",
			"main",
			"types",
			"exports",
			"files",
			"sideEffects",
		]);
		expect(manifest).toEqual({
			name: "tfd",
			version: "1.2.3",
			license: "Apache-2.0",
			repository: {
				type: "git",
				url: "git+https://github.com/justbry/tfd.git",
				directory: "packages/atm",
			},
			type: "module",
			main: "./dist/index.js",
			types: "./dist/index.d.ts",
			exports: {
				".": { types: "./dist/index.d.ts", default: "./dist/index.js" },
			},
			files: ["dist"],
			sideEffects: false,
		});
	});

	test("the workspace package stays private and its version is semver", () => {
		const own = JSON.parse(
			readFileSync(join(import.meta.dir, "../package.json"), "utf8"),
		);
		expect(own.private).toBe(true);
		expect(own.version).toMatch(/^\d+\.\d+\.\d+/);
		expect(own.scripts.release).toBe("bun ./release.ts");
	});

	test("the staged package.json is that manifest at the workspace version", () => {
		const out = Bun.spawnSync(
			["tar", "-xzOf", tarball, "package/package.json"],
			{
				stdout: "pipe",
			},
		);
		expect(JSON.parse(out.stdout.toString())).toEqual(
			publishManifest(version, "tfd"),
		);
	});

	test("the atm manifest is the tfd one with the old name", () => {
		expect(publishManifest("1.2.3", "atm")).toEqual({
			...publishManifest("1.2.3", "tfd"),
			name: "atm",
		});
	});
});

describe("the tarball", () => {
	test("holds exactly the six files, and the LICENSE is the repo's", () => {
		expect(listTarball(tarball)).toEqual([...PACKAGE_FILES]);
		const license = Bun.spawnSync(
			["tar", "-xzOf", tarball, "package/LICENSE"],
			{
				stdout: "pipe",
			},
		);
		expect(license.stdout.toString()).toBe(
			readFileSync(join(root, "LICENSE"), "utf8"),
		);
	});

	test("the README names the source commit and upstream", () => {
		const out = Bun.spawnSync(["tar", "-xzOf", tarball, "package/README.md"], {
			stdout: "pipe",
		});
		const text = out.stdout.toString();
		expect(text).toBe(publishReadme({ version, commit: COMMIT, name: "tfd" }));
		expect(text).toContain(COMMIT);
		expect(text).toContain("sidgaikwad/autumn");
	});

	test("two packs of the same build have the same sha256 and integrity", () => {
		const again = join(work, "stage-again");
		stage({ distDir, stageDir: again, version, commit: COMMIT, name: "tfd" });
		const second = pack({
			stageDir: again,
			outDir: join(work, "out-again"),
			version,
			name: "tfd",
		});
		expect(digests(second)).toEqual(digests(tarball));
		expect(digests(tarball).integrity).toMatch(/^sha512-[A-Za-z0-9+/]+=*$/);
		expect(digests(tarball).sha256).toMatch(/^[0-9a-f]{64}$/);
	});

	test("another commit is another tarball", () => {
		const other = join(work, "stage-other");
		stage({
			distDir,
			stageDir: other,
			version,
			commit: "f".repeat(40),
			name: "tfd",
		});
		const packed = pack({
			stageDir: other,
			outDir: join(work, "out-other"),
			version,
			name: "tfd",
		});
		expect(digests(packed).sha256).not.toBe(digests(tarball).sha256);
	});

	test("installed into an empty directory, as tfd and as atm, it runs the engine, validateMenu and invoice -> runOnState, under Bun and Node", async () => {
		const dir = mkdtempSync(join(tmpdir(), "atm-install-"));
		await writeFile(
			join(dir, "package.json"),
			JSON.stringify({ name: "consumer", private: true, type: "module" }),
		);
		const env = { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? dir };
		const add = Bun.spawnSync(["bun", "add", tarball, atmTarball], {
			cwd: dir,
			env,
		});
		if (add.exitCode !== 0) throw new Error(add.stderr.toString());
		const command = createCheckCommand();
		const subject = createSubjectFor({
			state: createState(),
			entityId: command.identity.entityId,
		});
		await writeFile(join(dir, "subject.json"), JSON.stringify(subject));
		await writeFile(join(dir, "command.json"), JSON.stringify(command));
		await writeFile(join(dir, "menu.json"), JSON.stringify(fixture("menu")));
		await writeFile(
			join(dir, "invoice.json"),
			JSON.stringify(fixture("inv-create-s2")),
		);
		await writeFile(
			join(dir, "consumer.mjs"),
			[
				'import { readFileSync } from "node:fs";',
				"const lib = await import(process.argv[2]);",
				'const read = (f) => JSON.parse(readFileSync(f, "utf8"));',
				'const subject = read("subject.json"), command = read("command.json"), menu = read("menu.json"), invoice = read("invoice.json");',
				'const catalog = lib.menuCatalogRows({ menu, school: "sch_vol" });',
				"const result = lib.invoiceToCommands({ invoice, menu, policy: lib.DEFAULT_POLICY, state: lib.EMPTY_GRANTS_STATE, now: invoice.paidAt, menuVersion: 3, policyVersion: 1 });",
				"let state = null;",
				"for (const c of result.commands) state = lib.runOnState({ state, catalog, command: c }).state;",
				"console.log(JSON.stringify({",
				"  engine: JSON.parse(JSON.stringify(lib.runEngineCommand({ subject, command }))),",
				"  menuOk: lib.validateMenu(menu).ok,",
				"  commands: result.commands.map((c) => c.type),",
				"  rows: state.customerEntitlements.map((r) => [r.id, r.balance]),",
				"}));",
			].join("\n"),
		);
		const expected = consume({
			runEngineCommand: (i) =>
				computeCheck({
					fullSubject: (i as { subject: never }).subject,
					command: (i as { command: never }).command,
				}),
			validateMenu,
			invoiceToCommands: invoiceToCommands as never,
			runOnState: runOnState as never,
			menuCatalogRows: menuCatalogRows as never,
			DEFAULT_POLICY,
			EMPTY_GRANTS_STATE,
		});
		expect(expected.menuOk).toBe(true);
		expect(expected.commands).toEqual(["applyBillingPlan"]);
		for (const runtime of ["bun", "node"])
			for (const name of RELEASE_NAMES) {
				const out = Bun.spawnSync([runtime, "consumer.mjs", name], {
					cwd: dir,
					env,
				});
				if (out.exitCode !== 0)
					throw new Error(`${runtime} ${name}: ${out.stderr.toString()}`);
				expect(JSON.parse(out.stdout.toString())).toEqual(expected);
			}
	}, 120_000);
});

describe("the exported names in the release notes", () => {
	test("are read from the built declarations", () => {
		const api = exportedNames({
			index: readFileSync(join(distDir, "index.d.ts"), "utf8"),
			types: readFileSync(join(distDir, "types.d.ts"), "utf8"),
		});
		for (const name of [
			"runEngineCommand",
			"handleStripeEvent",
			"invoiceToCommands",
			"validateMenu",
		])
			expect(api.values).toContain(name);
		expect(api.typeCount).toBeGreaterThan(40);
	});
});

describe("one release under two names (the rename window)", () => {
	test("publishes on justbry/tfd as tfd-v<v>/tfd-<v>.tgz and atm-v<v>/atm-<v>.tgz, tfd first", () => {
		expect(REPO).toBe("justbry/tfd");
		expect([...RELEASE_NAMES]).toEqual(["tfd", "atm"]);
		expect(releaseTag("tfd", "1.2.3")).toBe("tfd-v1.2.3");
		expect(releaseTag("atm", "1.2.3")).toBe("atm-v1.2.3");
		expect(assetName("tfd", "1.2.3")).toBe("tfd-1.2.3.tgz");
		expect(assetName("atm", "1.2.3")).toBe("atm-1.2.3.tgz");
		expect(assetUrl("tfd", "1.2.3")).toBe(
			"https://github.com/justbry/tfd/releases/download/tfd-v1.2.3/tfd-1.2.3.tgz",
		);
		expect(assetUrl("atm", "1.2.3")).toBe(
			"https://github.com/justbry/tfd/releases/download/atm-v1.2.3/atm-1.2.3.tgz",
		);
	});

	test("bun pm pack names each tarball after its package, and each holds its own name", () => {
		expect(tarball.endsWith(`/tfd-${version}.tgz`)).toBe(true);
		expect(atmTarball.endsWith(`/atm-${version}.tgz`)).toBe(true);
		for (const [file, name] of [
			[tarball, "tfd"],
			[atmTarball, "atm"],
		] as const) {
			expect(listTarball(file)).toEqual([...PACKAGE_FILES]);
			const manifest = Bun.spawnSync(
				["tar", "-xzOf", file, "package/package.json"],
				{ stdout: "pipe" },
			);
			expect(JSON.parse(manifest.stdout.toString()).name).toBe(name);
		}
	});

	test("the two tarballs hold the same build: only package.json and README.md differ", () => {
		const read = (file: string, entry: string) =>
			Bun.spawnSync(["tar", "-xzOf", file, entry], {
				stdout: "pipe",
			}).stdout.toString();
		for (const entry of PACKAGE_FILES) {
			const same = read(tarball, entry) === read(atmTarball, entry);
			expect([entry, same]).toEqual([
				entry,
				entry !== "package/package.json" && entry !== "package/README.md",
			]);
		}
		expect(digests(tarball).sha256).not.toBe(digests(atmTarball).sha256);
	});

	test("each README and each set of notes points at the other name, and the notes' install line is its own", () => {
		const tfdReadme = publishReadme({
			version: "1.2.3",
			commit: COMMIT,
			name: "tfd",
		});
		const atmReadme = publishReadme({
			version: "1.2.3",
			commit: COMMIT,
			name: "atm",
		});
		expect(tfdReadme.startsWith("# tfd\n")).toBe(true);
		expect(atmReadme.startsWith("# atm\n")).toBe(true);
		expect(tfdReadme).toContain(assetUrl("atm", "1.2.3"));
		expect(atmReadme).toContain(assetUrl("tfd", "1.2.3"));
		expect(atmReadme).toContain("Move to `tfd`");
		for (const readme of [tfdReadme, atmReadme])
			expect(readme).toContain("https://github.com/justbry/tfd (packages/atm)");
		const api = { values: ["runEngineCommand"], typeCount: 1 };
		const notes = (name: "tfd" | "atm") =>
			releaseNotes({
				name,
				version: "1.2.3",
				commit: COMMIT,
				sha256: "0".repeat(64),
				integrity: "sha512-x",
				api,
			});
		expect(notes("tfd")).toContain(`\`"tfd": "${assetUrl("tfd", "1.2.3")}"\``);
		expect(notes("tfd")).toContain("Asset: `tfd-1.2.3.tgz`");
		expect(notes("atm")).toContain(`\`"atm": "${assetUrl("atm", "1.2.3")}"\``);
		expect(notes("atm")).toContain("Asset: `atm-1.2.3.tgz`");
		expect(notes("atm")).toContain(assetUrl("tfd", "1.2.3"));
	});
});

describe("publishStep: what to do for one name, from what GitHub has", () => {
	const head = "a".repeat(40);
	const other = "b".repeat(40);
	const tag = "tfd-v1.2.3";

	test("no tag and no release: create the release with a new tag at HEAD", () => {
		expect(
			publishStep({ tag, releaseExists: false, tagCommit: null, head }),
		).toEqual({ kind: "create-at-head" });
	});

	test("the tag at HEAD and no release (a pushed tag): create the release on that tag", () => {
		expect(
			publishStep({ tag, releaseExists: false, tagCommit: head, head }),
		).toEqual({ kind: "create-on-tag" });
	});

	test("a release that exists: verify its asset is this build", () => {
		expect(
			publishStep({ tag, releaseExists: true, tagCommit: head, head }),
		).toEqual({ kind: "verify" });
	});

	test("a tag at another commit is refused, with or without a release", () => {
		for (const releaseExists of [true, false])
			expect(
				publishStep({ tag, releaseExists, tagCommit: other, head }),
			).toEqual({
				kind: "refuse",
				reason: "tag tfd-v1.2.3 points at bbbbbbbbb, not at HEAD aaaaaaaaa",
			});
	});
});
