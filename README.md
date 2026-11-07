# Trifold

Trifold keeps a school's books (credits, flat subscriptions and the money behind them) as signed receipts and sealed books. This repository is its code base, `tfd`.

- **The Trifold engine** (`packages/atm`): the `tfd` CLI and TypeScript library. It grants credits from paid invoices, spends them on `track`, journals every event and builds the KPI documents. Start with [`packages/atm/README.md`](packages/atm/README.md).
- **The ledger model** (`packages/atm/model/ledger.v1.json`): the entities, joins, dimensions and measures of the books, with the KPI spec and the disclosure rules that decide who sees which figure.
- **The ledger admin UI** (`packages/ledger-ui`): the Preact app for ledger.b4uni.com.
- **The balance rules** (`packages/balance-engine`): the pure functions the engine runs.
- **Plans and designs** (`plans/`): for example `plans/tfd-rename.md` and `plans/atm-ontology/`.

The rest of the workspace (`server/`, `vite/`, `apps/`, `shared/` and the other `packages/`) is inherited code. The engine reaches some of it through `packages/balance-engine`; the rest is not developed here.

## Getting started

You need [Bun](https://bun.sh) (the version is in `.bun-version`).

```bash
bun install
bun run --cwd packages/atm tfd --help
bun run --cwd packages/atm tfd run --subject subject.json --command check.json
```

`atm` is the old name for the same command and keeps working while the rename runs (`plans/tfd-rename.md`).

## Tests

```bash
bun test --cwd packages/atm
bunx tsc --noEmit -p packages/atm
bun run --cwd packages/ledger-ui gates/run.ts --slice S7 --changed <file> --head <sha>
```

Format only the files you touched: `node_modules/.bin/biome check --write --no-errors-on-unmatched <files>`. Never run it over the whole repository.

## Contributing

Work goes on a feature branch with a pull request against `dev`. Nothing is pushed to `main`.

## License

More than one license; [`LICENSING.md`](LICENSING.md) maps each path to its license. The Trifold engine (`packages/atm`) is FSL-1.1-ALv2, and each release becomes Apache-2.0 two years after it ships; its receipt and seal format, verifier and test vectors are Apache-2.0 and CC0-1.0. Everything else is Apache-2.0 (`LICENSE`). Where the inherited code comes from, and every upstream file this repository changes, is recorded in [`UPSTREAM.md`](UPSTREAM.md).
