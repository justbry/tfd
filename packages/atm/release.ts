#!/usr/bin/env bun
/**
 * One-command release of the library: a tarball on a GitHub release, which B4 Uni's family service pins by URL
 * (`"tfd": "https://github.com/justbry/tfd/releases/download/tfd-v<version>/tfd-<version>.tgz"`, with the tarball's
 * sha512 in its bun.lock).
 *
 *   bun run --cwd packages/atm release [--dry-run]
 *
 * For the rename window (`plans/tfd-rename.md`, step 3) one release is published under both names, on `justbry/tfd`:
 * the tag `tfd-v<version>` with `tfd-<version>.tgz`, and the tag `atm-v<version>` with `atm-<version>.tgz`, both at the
 * same commit. The two tarballs hold the same build; they differ only in the package name (`package.json` `name` and
 * the README's title), so that `"tfd": <url>` installs a package named `tfd` and `"atm": <url>` one named `atm`.
 *
 * Reads the version from package.json. A real run refuses unless the working tree is clean, HEAD is on origin, and
 * for neither name a tag or a GitHub release exists. Then it builds into a temp dir, runs the dist checks and
 * tests/dist.test.ts against that output, stages and packs the publish package once per name, prints each tarball's
 * sha256 and the sha512 integrity bun.lock will record, and creates both releases at HEAD. The same commit always
 * gives the same tarball bytes (fixed file times, no random content).
 *
 * `--dry-run` does everything but create the releases; a check that a real run would refuse on is printed, not fatal.
 * `--ci` is for the tag-push workflow: a tag of this version (either name) on origin is HEAD; for each name, an
 * existing release is accepted when its asset is byte-for-byte what this build makes, and a missing one is created.
 */
import { createHash } from "node:crypto";
import {
	cpSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	statSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const here = import.meta.dir;
const repoRoot = resolve(here, "../..");

export const REPO = "justbry/tfd";
/**
 * The names one build is published under, the current one first. `atm` is the old name, published beside `tfd` for
 * the rename window only; the tags `atm-v0.1.0` to `atm-v0.9.0` stay on `justbry/atm` as they are.
 */
export const RELEASE_NAMES = ["tfd", "atm"] as const;
export type ReleaseName = (typeof RELEASE_NAMES)[number];

export const releaseTag = (name: ReleaseName, version: string): string =>
	`${name}-v${version}`;
export const assetName = (name: ReleaseName, version: string): string =>
	`${name}-${version}.tgz`;
export const assetUrl = (name: ReleaseName, version: string): string =>
	`https://github.com/${REPO}/releases/download/${releaseTag(name, version)}/${assetName(name, version)}`;

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
/** npm's fixed file time, so a pack does not depend on when the files were written. */
const FIXED_TIME = new Date("1985-10-26T08:15:00Z");

/** What the tarball holds, and nothing else. */
export const PACKAGE_FILES = [
	"package/LICENSE",
	"package/README.md",
	"package/dist/index.d.ts",
	"package/dist/index.js",
	"package/dist/types.d.ts",
	"package/package.json",
] as const;

/** The package.json inside the tarball: no dependencies (the engine is inlined), no bin, no scripts. */
export const publishManifest = (version: string, name: ReleaseName) => ({
	name,
	version,
	license: "Apache-2.0",
	repository: {
		type: "git",
		url: `git+https://github.com/${REPO}.git`,
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

/** What the README and the notes say about the other name of the same build. */
const twinNote = (name: ReleaseName, version: string): string =>
	name === "atm"
		? `\`atm\` is the old name of this package, published for the rename window beside \`tfd\` (${assetUrl("tfd", version)}); the two hold the same build and differ only in the package name. Move to \`tfd\`.`
		: `The same build is also published under the old name \`atm\` (${assetUrl("atm", version)}) for the rename window.`;

export const publishReadme = ({
	version,
	commit,
	name,
}: {
	version: string;
	commit: string;
	name: ReleaseName;
}) =>
	[
		`# ${name}`,
		"",
		"The Trifold engine as a typed library: Autumn's balance engine, engine commands, the school ledger and the billing rules (menu, Stripe facts, credit grants, storage rows), bundled into one ESM file with no dependencies. `dist/index.d.ts` and `dist/types.d.ts` stand alone.",
		"",
		`Version ${version}, built from commit ${commit} of https://github.com/${REPO} (packages/atm), a fork of https://github.com/sidgaikwad/autumn. Apache-2.0.`,
		"",
		twinNote(name, version),
		"",
	].join("\n");

/** Writes the publish package into `stageDir`: the built library, LICENSE, README, package.json, all at one fixed time. */
export const stage = ({
	distDir,
	stageDir,
	version,
	commit,
	name,
}: {
	distDir: string;
	stageDir: string;
	version: string;
	commit: string;
	name: ReleaseName;
}): void => {
	mkdirSync(join(stageDir, "dist"), { recursive: true });
	for (const file of ["index.js", "index.d.ts", "types.d.ts"])
		cpSync(join(distDir, file), join(stageDir, "dist", file));
	cpSync(join(repoRoot, "LICENSE"), join(stageDir, "LICENSE"));
	writeFileSync(
		join(stageDir, "package.json"),
		`${JSON.stringify(publishManifest(version, name), null, 2)}\n`,
	);
	writeFileSync(
		join(stageDir, "README.md"),
		publishReadme({ version, commit, name }),
	);
	const touch = (path: string) => {
		utimesSync(path, FIXED_TIME, FIXED_TIME);
		if (statSync(path).isDirectory())
			for (const entry of readdirSync(path)) touch(join(path, entry));
	};
	touch(stageDir);
};

/** `bun pm pack` of a staged package; returns the tarball's path (`<name>-<version>.tgz`, from the staged manifest). */
export const pack = ({
	stageDir,
	outDir,
	version,
	name,
}: {
	stageDir: string;
	outDir: string;
	version: string;
	name: ReleaseName;
}): string => {
	mkdirSync(outDir, { recursive: true });
	const run = Bun.spawnSync(
		[
			"bun",
			"pm",
			"pack",
			"--quiet",
			"--ignore-scripts",
			"--destination",
			outDir,
		],
		{ cwd: stageDir, stdout: "pipe", stderr: "pipe" },
	);
	if (run.exitCode !== 0)
		throw new Error(`bun pm pack failed: ${run.stderr.toString()}`);
	return join(outDir, assetName(name, version));
};

/** sha256 (hex) and the sha512 integrity string (`sha512-<base64>`) that a bun.lock records for the tarball. */
export const digests = (
	file: string,
): { sha256: string; integrity: string } => {
	const bytes = readFileSync(file);
	return {
		sha256: createHash("sha256").update(bytes).digest("hex"),
		integrity: `sha512-${createHash("sha512").update(bytes).digest("base64")}`,
	};
};

/** The files in a tarball, sorted, directories left out. */
export const listTarball = (file: string): string[] => {
	const run = Bun.spawnSync(["tar", "-tzf", file], { stdout: "pipe" });
	if (run.exitCode !== 0) throw new Error(`tar could not read ${file}`);
	return run.stdout
		.toString()
		.split("\n")
		.filter((line) => line !== "" && !line.endsWith("/"))
		.sort();
};

/** The runtime names `index.d.ts` exports (types are re-exported from `types.d.ts`; they are counted, not listed). */
export const exportedNames = ({
	index,
	types,
}: {
	index: string;
	types: string;
}): { values: string[]; typeCount: number } => ({
	values: [
		...index.matchAll(/^export declare (?:const|function|class) (\w+)/gm),
	]
		.map((m) => m[1] as string)
		.sort(),
	typeCount: [...types.matchAll(/^export (?:type|interface) (\w+)/gm)].length,
});

export const releaseNotes = ({
	name,
	version,
	commit,
	sha256,
	integrity,
	api,
}: {
	name: ReleaseName;
	version: string;
	commit: string;
	sha256: string;
	integrity: string;
	api: ReturnType<typeof exportedNames>;
}) =>
	[
		`Library build of packages/atm at ${commit}: the Trifold engine (Autumn's balance engine, the school ledger and the billing rules), bundled into one ESM file. Used by B4 Uni's family service as a pinned dependency.`,
		"",
		`Asset: \`${assetName(name, version)}\`, sha256 \`${sha256}\`, integrity \`${integrity}\` (what bun.lock records).`,
		"",
		twinNote(name, version),
		"",
		`Exports (${api.values.length} values, ${api.typeCount} types in \`dist/types.d.ts\`): ${api.values.map((n) => `\`${n}\``).join(", ")}.`,
		"",
		`Built with bun ${Bun.version}; the same commit on that bun gives the same tarball.`,
		"",
		"Install: set the dependency to the asset URL, then `bun install`:",
		"",
		`\`"${name}": "${assetUrl(name, version)}"\``,
	].join("\n");

/**
 * What to do for one name, from what GitHub has: a release that exists must hold exactly this build (`verify`); a
 * missing release is created on the tag when the tag is already at HEAD (`create-on-tag`), or with a new tag at HEAD
 * when there is no tag (`create-at-head`). A tag at another commit is a refusal.
 */
export type PublishStep =
	| { kind: "verify" }
	| { kind: "create-on-tag" }
	| { kind: "create-at-head" }
	| { kind: "refuse"; reason: string };

export const publishStep = ({
	tag,
	releaseExists,
	tagCommit,
	head,
}: {
	tag: string;
	releaseExists: boolean;
	/** The commit the tag points at on origin, null when there is no such tag. */
	tagCommit: string | null;
	head: string;
}): PublishStep => {
	if (tagCommit !== null && tagCommit !== head)
		return {
			kind: "refuse",
			reason: `tag ${tag} points at ${tagCommit.slice(0, 9)}, not at HEAD ${head.slice(0, 9)}`,
		};
	if (releaseExists) return { kind: "verify" };
	return tagCommit === null
		? { kind: "create-at-head" }
		: { kind: "create-on-tag" };
};

// ---- the command ------------------------------------------------------------------------------------------------

const run = (
	cmd: string[],
	cwd = repoRoot,
): { ok: boolean; out: string; err: string } => {
	const r = Bun.spawnSync(cmd, { cwd, stdout: "pipe", stderr: "pipe" });
	return {
		ok: r.exitCode === 0,
		out: r.stdout.toString().trim(),
		err: r.stderr.toString().trim(),
	};
};

/** The commit a tag points at on origin (an annotated tag is peeled), null when origin has no such tag. */
const remoteTagCommit = (tag: string): string | null => {
	const listed = run([
		"git",
		"ls-remote",
		"--tags",
		"origin",
		`refs/tags/${tag}`,
		`refs/tags/${tag}^{}`,
	]);
	if (!listed.ok)
		throw new Error(`could not ask origin whether tag ${tag} exists`);
	const lines = listed.out
		.split("\n")
		.filter(Boolean)
		.map((line) => line.split("\t") as [string, string]);
	const peeled = lines.find(([, ref]) => ref.endsWith("^{}"));
	return (peeled ?? lines[0])?.[0] ?? null;
};

/** Whether GitHub has a release for the tag; throws when it cannot tell. */
const releaseExists = (tag: string): boolean => {
	const release = run(["gh", "release", "view", tag, "--repo", REPO]);
	if (release.ok) return true;
	if (/release not found/i.test(release.err)) return false;
	throw new Error(
		`could not ask GitHub whether release ${tag} exists: ${release.err}`,
	);
};

/** What stops a real run: dirty tree, HEAD not on origin, a tag or release that exists (or, in CI, none at HEAD). */
const preflight = ({
	version,
	ci,
}: {
	version: string;
	ci: boolean;
}): string[] => {
	const problems: string[] = [];
	// The bundler and the packer are part of the bytes: a release is only reproducible on the bun the repo pins.
	const pinned = /^bun@(.+)$/.exec(
		(
			JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as {
				packageManager?: string;
			}
		).packageManager ?? "",
	)?.[1];
	if (pinned && pinned !== Bun.version)
		problems.push(
			`bun ${Bun.version} is running this, but the repo pins bun ${pinned} (packageManager): the tarball would not be reproducible`,
		);
	if (!SEMVER.test(version))
		problems.push(
			`package.json version ${JSON.stringify(version)} is not semver`,
		);
	if (run(["git", "status", "--porcelain"]).out !== "")
		problems.push("the working tree has uncommitted changes");
	const head = run(["git", "rev-parse", "HEAD"]).out;
	const tags = RELEASE_NAMES.map((name) => releaseTag(name, version));
	const remote = new Map<string, string | null>();
	for (const tag of tags) {
		try {
			remote.set(tag, remoteTagCommit(tag));
		} catch (error) {
			problems.push(error instanceof Error ? error.message : String(error));
		}
	}
	if (ci) {
		if (!tags.some((tag) => remote.get(tag) === head))
			problems.push(
				`HEAD is not the commit tag ${tags.join(" or ")} points at`,
			);
		for (const tag of tags) {
			const commit = remote.get(tag);
			if (commit !== undefined && commit !== null && commit !== head)
				problems.push(
					`tag ${tag} points at ${commit.slice(0, 9)}, not at HEAD`,
				);
		}
		return problems;
	}
	run(["git", "fetch", "--quiet", "origin"]);
	const onRemote = run(["git", "branch", "-r", "--contains", head]);
	if (!onRemote.ok || onRemote.out === "")
		problems.push(
			`HEAD ${head.slice(0, 9)} is not on any branch of origin: push it first`,
		);
	for (const tag of tags) {
		if (run(["git", "tag", "-l", tag]).out !== "")
			problems.push(`tag ${tag} already exists locally`);
		if (remote.get(tag)) problems.push(`tag ${tag} already exists on origin`);
		try {
			if (releaseExists(tag))
				problems.push(`a GitHub release for ${tag} already exists`);
		} catch (error) {
			problems.push(error instanceof Error ? error.message : String(error));
		}
	}
	return problems;
};

type Built = {
	name: ReleaseName;
	tag: string;
	tarball: string;
	files: string[];
	sha256: string;
	integrity: string;
};

/** Stages and packs one name twice and refuses unless both packs are the same bytes and hold exactly the files. */
const buildTarball = ({
	name,
	work,
	distDir,
	version,
	commit,
}: {
	name: ReleaseName;
	work: string;
	distDir: string;
	version: string;
	commit: string;
}): Built => {
	const packOnce = (attempt: string) => {
		const stageDir = join(work, `stage-${name}-${attempt}`);
		stage({ distDir, stageDir, version, commit, name });
		return pack({
			stageDir,
			outDir: join(work, `out-${name}-${attempt}`),
			version,
			name,
		});
	};
	const first = packOnce("a");
	const one = digests(first);
	if (one.sha256 !== digests(packOnce("b")).sha256)
		throw new Error(
			`two packs of the same build differ for ${name}: the tarball is not reproducible`,
		);
	const files = listTarball(first);
	if (JSON.stringify(files) !== JSON.stringify([...PACKAGE_FILES]))
		throw new Error(
			`the ${name} tarball holds ${files.join(", ")}, not exactly the expected files`,
		);
	return {
		name,
		tag: releaseTag(name, version),
		tarball: first,
		files,
		...one,
	};
};

/** Creates the release of one name, or checks that the existing one's asset is this build. */
const publish = ({
	built,
	version,
	commit,
	notes,
	work,
}: {
	built: Built;
	version: string;
	commit: string;
	notes: string;
	work: string;
}): void => {
	const step = publishStep({
		tag: built.tag,
		releaseExists: releaseExists(built.tag),
		tagCommit: remoteTagCommit(built.tag),
		head: commit,
	});
	if (step.kind === "refuse") throw new Error(step.reason);
	if (step.kind === "verify") {
		const dir = join(work, `published-${built.name}`);
		const asset = assetName(built.name, version);
		const got = run([
			"gh",
			"release",
			"download",
			built.tag,
			"--repo",
			REPO,
			"--pattern",
			asset,
			"--dir",
			dir,
		]);
		if (!got.ok)
			throw new Error(
				`could not download the published ${built.tag} asset: ${got.err}`,
			);
		const published = digests(join(dir, asset));
		if (published.sha256 !== built.sha256)
			throw new Error(
				`the published ${built.tag} asset (${published.sha256}) is not what this commit builds (${built.sha256})`,
			);
		console.log(
			`release ${built.tag} already exists and its asset is exactly this build`,
		);
		return;
	}
	const created = run([
		"gh",
		"release",
		"create",
		built.tag,
		built.tarball,
		"--repo",
		REPO,
		...(step.kind === "create-on-tag"
			? ["--verify-tag"]
			: ["--target", commit]),
		"--title",
		`${built.name} ${version}`,
		"--notes",
		notes,
	]);
	if (!created.ok)
		throw new Error(
			`could not create release ${built.tag}: ${created.err}. A release made before it stays; the tag-push workflow (or a rerun with --ci at this commit) creates the missing one`,
		);
	console.log(created.out);
};

const main = async () => {
	const args = new Set(process.argv.slice(2));
	const dryRun = args.has("--dry-run");
	const ci = args.has("--ci");
	const unknown = [...args].filter((a) => a !== "--dry-run" && a !== "--ci");
	if (unknown.length > 0)
		throw new Error(`unknown argument ${unknown.join(" ")}`);

	const { version } = JSON.parse(
		readFileSync(join(here, "package.json"), "utf8"),
	) as { version: string };
	const commit = run(["git", "rev-parse", "HEAD"]).out;

	const problems = preflight({ version, ci });
	if (problems.length > 0) {
		const label = dryRun ? "a real run would refuse" : "refusing";
		for (const p of problems) console.error(`${label}: ${p}`);
		if (!dryRun) process.exit(1);
	}

	const work = mkdtempSync(join(tmpdir(), "tfd-release-"));
	const distDir = join(work, "dist");
	const build = Bun.spawnSync(["bun", join(here, "build.ts"), distDir], {
		stdout: "inherit",
		stderr: "inherit",
	});
	if (build.exitCode !== 0) throw new Error("the build failed");
	const checks = Bun.spawnSync(["bun", "test", "tests/dist.test.ts"], {
		cwd: here,
		env: { ...process.env, TFD_DIST: distDir },
		stdout: "inherit",
		stderr: "inherit",
	});
	if (checks.exitCode !== 0)
		throw new Error("tests/dist.test.ts failed on the built output");

	const api = exportedNames({
		index: readFileSync(join(distDir, "index.d.ts"), "utf8"),
		types: readFileSync(join(distDir, "types.d.ts"), "utf8"),
	});
	const releases = RELEASE_NAMES.map((name) => {
		const built = buildTarball({ name, work, distDir, version, commit });
		return {
			built,
			notes: releaseNotes({
				name,
				version,
				commit,
				sha256: built.sha256,
				integrity: built.integrity,
				api,
			}),
		};
	});

	for (const { built } of releases) {
		console.log(`\ntag       ${built.tag}  (commit ${commit})`);
		console.log(`tarball   ${built.tarball}`);
		for (const f of built.files) console.log(`  ${f}`);
		console.log(`sha256    ${built.sha256}`);
		console.log(`sha512    ${built.integrity}`);
		console.log("a second pack gave the same bytes");
	}

	if (dryRun) {
		for (const { built, notes } of releases) {
			console.log(
				`\ndry run: nothing was created. Release notes of ${built.tag} would be:\n`,
			);
			console.log(notes);
		}
		return;
	}

	for (const { built, notes } of releases)
		publish({ built, version, commit, notes, work });
	if (ci) return;

	const current = releases[0]?.built;
	if (current === undefined) return;
	console.log("\nIn buzz-school, set packages/family-service/package.json to:");
	console.log(`  "${current.name}": "${assetUrl(current.name, version)}"`);
	console.log(
		`in place of the "atm" entry, change \`from "atm"\` to \`from "${current.name}"\` in its imports, then run \`bun install\` (bun.lock records the sha512 above, ${current.integrity}).`,
	);
};

if (import.meta.main) {
	main().catch((error) => {
		console.error(error instanceof Error ? error.message : error);
		process.exit(1);
	});
}
