# Releasing the Trifold engine

How a release of `packages/atm` is made and checked. Written from the header of `release.ts`, the recipes in `justfile`, the workflow `.github/workflows/release-atm.yml` and what the release records in `CHANGELOG.md` say. The records of each release (tag, commit, tarball URL, sha256 and sha512) are in `CHANGELOG.md`; what a caller must change per release is in `UPGRADING.md`. Related: `docs/README.md`, `docs/financial-reports.md`.

For the rename window (`plans/tfd-rename.md`, step 3) one release is published under two names on `justbry/tfd`: `tfd-v<version>` with `tfd-<version>.tgz` (a package named `tfd`), and `atm-v<version>` with `atm-<version>.tgz` (named `atm`), both at the same commit. The two tarballs hold the same build and differ only in `package.json` `name` and the README, so each has its own sha256 and sha512. The `atm` name is published for one release, while buzz-school moves to `tfd`; the releases up to `atm-v0.9.0` stay on `justbry/atm`. The workflow file is still `release-atm.yml` and the workspace is still `packages/atm` until step 4 (`docs/frozen-identifiers.md`).

## What a release is

A tarball on a GitHub release of `justbry/tfd`, once per name: `tfd-<version>.tgz` on the tag `tfd-v<version>` and `atm-<version>.tgz` on `atm-v<version>`. B4 Uni's family service pins one by URL (`https://github.com/justbry/tfd/releases/download/tfd-v<version>/tfd-<version>.tgz`) with the tarball's sha512 in its `bun.lock`. The version is read from `packages/atm/package.json`. The same commit always gives the same tarball bytes (fixed file times, no random content).

## The bun version

The bundler and the packer are part of the bytes, so a release is only reproducible on the bun the repo pins (`packageManager` in the root `package.json`, now `bun@1.4.4`). `release.ts` refuses to run on another bun version. The tag-push workflow installs bun 1.4.4. The release records in `CHANGELOG.md` name the bun each tarball was built with (0.3.0 was built with bun 1.4.2; 0.4.0 and 0.5.0 with bun 1.4.4; the changelog's table lists #19 and #20 as "bun 1.4.4 pinned on the release path").

## Steps

1. Bump `version` in `packages/atm/package.json` and merge it with the upgrade notes (`UPGRADING.md`, "Moving to <version> from <previous>").
2. Dry run, which creates nothing: `just release-dry` from `packages/atm` (it runs `bun ./release.ts --dry-run`; from the repo root, `bun run --cwd packages/atm release --dry-run`). It builds into a temp directory, runs the dist checks and `tests/dist.test.ts` against that output, stages the publish package once per name (no dependencies, no bin, no scripts: the engine is inlined; the files are `LICENSE`, `README.md`, `dist/index.d.ts`, `dist/index.js`, `dist/types.d.ts` and `package.json`), packs it, and prints each tarball's sha256 and the sha512 integrity that `bun.lock` will record, then the release notes of both. A check a real run would refuse on is printed, not fatal.
3. A real release: `just release` (asks to confirm) or `bun run --cwd packages/atm release`. It refuses unless the working tree is clean, HEAD is on a branch of `origin`, and for neither name (`tfd-v<version>`, `atm-v<version>`) a tag or a GitHub release exists. Then it does what the dry run does and creates both releases at HEAD, `tfd` first. If the second one fails, the first stays; the tag-push workflow that the first release's tag starts creates the missing one.
4. The tag-push workflow `Release tfd (and atm)` (`.github/workflows/release-atm.yml`) runs when a tag `tfd-v*` or `atm-v*` is pushed: it checks out the tag, sets up bun 1.4.4, installs with the frozen lockfile and runs `release --ci`. In `--ci` mode a tag of this version (either name) on origin must point at HEAD and no tag of it may point elsewhere; then, for each name, an existing release is accepted when its asset is byte-for-byte what this build makes (it fails if not), and a missing one is created (on its tag when the tag exists, else with a new tag at HEAD). The two runs a release starts share one concurrency group, so they take turns; the second only checks.
5. Verify the published tarballs: download both release assets and compare its sha256 and sha512 with what the release script printed. The records of 0.4.0 and 0.5.0 say "checked by downloading the published asset".
6. Record the release in `CHANGELOG.md`: tag, commit, date, tarball URL, sha256 and sha512, the bun version, and what the release holds (the PR table with merge commits).
7. Pin it in `buzz-school`: the family service's `bun.lock` records the tarball's sha512 (see the open `buzz-school` lines in `ROADMAP.md`).

## Recipes

From `packages/atm`: `just release-dry` (build, check and pack; prints the sha256 and sha512; creates nothing) and `just release` (creates the GitHub releases `tfd-v<version>` and `atm-v<version>` at HEAD with their tarballs; needs a clean, pushed HEAD and the pinned bun). `just check` is the whole local gate before a commit: lint, typecheck, tests, build, knip.
