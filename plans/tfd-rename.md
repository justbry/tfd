# Renaming atm to tfd

Status: steps 1 and 2 merged; step 3, the tfd side, in its PR, 2026-11-07. Owner decisions of 2026-11-06 and 2026-11-07.

## Names

| Layer | Name |
| --- | --- |
| Product, company, managed service | Trifold |
| The engine, in prose | the Trifold engine (no separate engine brand) |
| CLI, code base, npm package, Worker export | `tfd`, `tfd/worker` (today `atm`, `atm/worker`) |
| Autumn's balance rules (upstream) | `@autumn/balance-engine`, unchanged; `UPSTREAM.md` and the Apache-2.0 §4 notices keep naming the fork `justbry/atm` |
| The ledger model | a neutral prefix (`ledger:`) and a stable namespace with no product name and no version in it |

Some names that contain "atm" never change, because they are stored, hashed or someone else's contract. `packages/atm/docs/frozen-identifiers.md` lists them, with the reasons. Every step below leaves them alone.

## Step 1: brand text and the `tfd` command (PR #144)

- [x] A `tfd` bin beside `atm`, the same command. Each bin has its own entry file (`src/bin.ts`, `src/atm.ts`), because Bun reports a symlinked bin by the real path of its target.
- [x] Help text and run-this-next hints name the command that was run (`src/command-name.ts`).
- [x] `packages/atm` docs say Trifold or the Trifold engine, and their command examples say `tfd`. Past CHANGELOG and UPGRADING entries and dated records keep `atm`.
- [x] `docs/frozen-identifiers.md`.
- [ ] The hints in `src/scenario/params.ts` and `src/scenario/bundle-check.ts` still say `atm`. They are library code: the CLI passes the command name in, so the modules don't read argv (which would pull `node:path` toward the Worker's import graph).

## Step 2: the ledger model's namespace and prefix (before anything reads the model)

- [x] The namespace moves from `https://b4uni.com/_model/ledger.v1#` to `https://b4uni.com/_model/ledger#`. The model's version stays in `version` and `id`, not in each IRI. The domain stays b4uni.com until Trifold registers one; a later move changes one constant. Done: `model/ledger.v1.json` carries the new namespace, so every generated IRI (the OpenAPI `x-jsonld-type`s, the JSON-LD context's terms) drops the `.v1`; `version` and `id` still say `ledger.v1`.
- [x] The CURIE prefix `atm:` becomes `ledger:`, and the schema stops requiring a prefix by name. Done: `schema/model.v1.json` no longer requires `prefixes.atm`; instead the loader (`src/model/resolve.ts`) refuses a model unless exactly one prefix maps to the namespace, whatever its name, and the generator writes the model's CURIEs (`ledger:school`, `"@id": "ledger:"`) under that prefix. The OpenAPI title is "Trifold KPI document". The KPI documents are byte-identical.

## Step 3: a compatibility window for callers (with buzz-school)

- [x] Publish the tarball under both names for one release (`atm-v<v>/atm-<v>.tgz` and `tfd-v<v>/tfd-<v>.tgz`). Done in code: `release.ts` publishes on `justbry/tfd`, stages and packs the build once per name (the `tfd` tarball is a package named `tfd`, the `atm` one `atm`; only `package.json` and the README differ), and creates both releases at one commit, `tfd` first; `--ci` creates or checks each name, and `release-atm.yml` runs for `tfd-v*` and `atm-v*` tags in one concurrency group. Tests in `tests/release.test.ts` (both tarballs installed and imported under Bun and Node, `publishStep`). Left: cut the release (bump the version, `just release`); then buzz-school changes its pin to the `tfd` URL and `import … from "atm"` to `"tfd"` (the exact change is in the step 3 PR's description). The `atm` name is dropped from `RELEASE_NAMES` in the release after.
- [x] The Worker accepts both JWT audiences, `atm-ledger` and `tfd-ledger`, until buzz-school mints the new one. Done as `isLedgerTokenAudience` (and `LEDGER_TOKEN_AUDIENCE`, `LEGACY_LEDGER_TOKEN_AUDIENCE`, `LEDGER_TOKEN_AUDIENCES`) in `atm/worker`, `src/ledger/ledger-token.ts`: no code in this repository verified `aud` yet (the ledger Worker of S8 is not built), so this is the check that Worker calls. Left: the Worker calls it; buzz-school mints `tfd-ledger`; then `atm-ledger` goes. `plans/atm-ontology/dashboards.md` plans an `atm-embed` audience with `tfd-embed` beside it; nothing built.
- [x] Read `TFD_*` environment variables first and fall back to `ATM_*`, for one minor release. Done: `readEnvironmentVariable` in `src/environment.ts` (an empty value counts as unset), used for the six `R2_*` variables of `tfd inputs ship` and for every variable the tests and scripts read (`DIST`, `WEED`, `GOLDEN_E2E*`, `KILL_*`, `R2_ACCOUNT_ID`, `R2_API_TOKEN`). Left: remove the fallback in the minor release after next; `.github/workflows/atm-tests.yml` still sets `ATM_GOLDEN_E2E_SHARD`, which works through the fallback.
- [x] Export the new type names with deprecated `Atm*` aliases (types only, so free). Done: the 42 types of `src/types.ts` are defined as `Tfd*`, and each `Atm*` is a `/** @deprecated */` alias (`tests/dist.test.ts` checks the pairs in the built `types.d.ts`). Left: the code and the declared signatures still use `Atm*` (step 4's codemod moves them); the aliases go after the window.
- [ ] Caller-facing log and stderr prefixes (`atm: …`, `atm <command> failed:`, `atm reconcile:`): announce them in `UPGRADING.md` one release ahead, then print `tfd`. A caller's alert that greps them has to change in the same window. Announced in `UPGRADING.md` ("On `dev` since 0.9.0", item 5 of the rename window). Left: print `tfd` in the release after the one that carries the announcement, with `tests/ship-inputs-cli.test.ts` and the other tests that pin them.

## Step 4: identifiers and the directory (last)

- [ ] A codemod over an explicit list of identifiers (`AtmEvent`, `atmChannel`, …), with word boundaries, inside `packages/atm` only. It excludes `atmn` (Autumn's own CLI packages), `packages/balance-engine`, `CHANGELOG.md`, goldens and snapshots. A blind `s/atm/tfd/` would hit `flatMap`, `formatMs` and thousands of `atmn` lines.
- [ ] The `"atm"` channel key in `fixtures/scenarios/*/hashes.json`, with its goldens.
- [ ] `git mv packages/atm packages/tfd` in its own PR, with nothing else in it, once no open branch touches `packages/atm`. Then update the paths: `package.json` workspaces, `justfile`, `knip.json`, `biome.json`, `.gitattributes`, `.gitignore`, both workflows, `build.ts:95`, `release.ts`, and ledger-ui's `import-mart.ts` and `consistency.test.ts`.
- [ ] Optional: rename the GitHub repo `justbry/atm`. GitHub redirects the old URL, but buzz-school's pinned tarball URLs should move in step 3 first.

## Decided against

- One big rename PR: it would collide with every open branch on `packages/atm` and cannot hold a compatibility window.
- Keeping `atm` in doc commands until step 2: `tfd` exists from step 1, so the docs say it.
- Renaming stored names "with a migration that keeps reading the old one" as a default: the mapping labels, the Stripe idempotency prefixes, `.atm-tmp-` and shipped `atm_version` lines stay as they are. Only the handler's SQL names may change, and only before the handler is deployed anywhere.
