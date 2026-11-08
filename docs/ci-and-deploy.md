# CI and deploys

What runs where, and the one-time Cloudflare setup the deploy workflows need.

## Domains

Decided 2026-11-07. `trifold.app` is the only brand domain; each host has one job.

| Host | What | Status |
|---|---|---|
| `trifold.app` | Marketing site, docs at `/docs` | Live. Worker `trifold-apex` (custom domain) passes each request through to the Pages production deploy (`tfd-ledger.pages.dev`) |
| `www.trifold.app` | 301 to the same path on `trifold.app` | Live (`trifold-apex`) |
| `ledger.trifold.app` | The hosted product: sign-in, books, receipts, settings. Orgs by path (`/o/<slug>`), never a subdomain each | Planned |
| `api.trifold.app` | Public API under `/v1`, Stripe webhooks | Planned |
| `verify.trifold.app` | Receipt verifier and witness keys. Printed on receipts, so it never moves and carries no app code | For now a 302 to `https://trifold.app/verify`, keeping the query (`trifold-apex`), until the verifier app (`apps/trifold-verify`) is promoted there |
| `staging-ledger`, `staging-api`, `staging-verify` | Staging. Flat names: the free certificate covers one subdomain level only | Live: Workers `trifold-cloud` and `trifold-verify`, `--env staging`. `/healthz` on the first two |
| `send.trifold.app` | Transactional email sender (SPF, DKIM, DMARC) | Planned; needs its email DNS records |
| `hello@trifold.app`, `dmarc@trifold.app` | Contact address and DMARC reports, via Email Routing | Not routed yet |

Every live host above is a Worker custom domain, which creates and manages its own DNS record, so none needed a
credential that can edit DNS on the zone. `send.trifold.app` and Email Routing do need DNS records (SPF, DKIM, DMARC,
MX). `trifold-apex` (serving the apex, `www` and `verify`) comes from PR #75 (`apps/trifold-apex`), the staging Workers
from PR #68 (`apps/trifold-cloud`, `apps/trifold-verify`); both were deployed by hand from their branches.

`ledger.b4uni.com` and `ledger-staging.b4uni.com` stay B4 Uni's own install.

## What deploys what

| What | Workflow | When | Where it goes |
|---|---|---|---|
| Website (`apps/trifold-site`) | `trifold-site.yml` | pull request to `dev` | preview: `<branch>.tfd-ledger.pages.dev` |
| | | push to `dev`, or **Run workflow** | production: Pages project `tfd-ledger`, branch `main`, served at `trifold.app` through `trifold-apex` |
| Ledger Worker + UI (`packages/ledger-worker`, `packages/ledger-ui`) | `deploy-ledger-worker.yml` | **Run workflow** only, after approval | staging: `ledger-staging.b4uni.com` |
| `tfd` package | `release-atm.yml` (Release tfd) | a `tfd-v<version>` tag | a release on `justbry/atm` with `tfd-<version>.tgz` |

The other workflows only check:

| Workflow | Checks |
|---|---|
| `atm-tests.yml` | `packages/atm`: tests, golden end-to-end, typecheck, lint, build |
| `balance-unit-tests.yml` | `balance-engine`, which tfd builds on, and its neighbours: unit tests and typechecks |
| `server-typecheck.yml` | no edits to generated paths, the workspace list, the Autumn server's typecheck |
| `knip.yml` | unused files, exports and dependencies |

Every job runs on `vars.CI_RUNNER` if set (a JSON runner label list, for a self-hosted box), else `ubuntu-latest`.
Autumn's own deploy, product-test and publish workflows are removed: they needed its secrets or its paid runners, so
they only failed or sat queued. `UPSTREAM.md` lists them.

The site workflow always runs its checks. It deploys only when both Cloudflare secrets are set, and skips with a warning
otherwise, so a missing secret never fails a run. A pull request from a fork gets no secrets, so it is checked but not
previewed.

Each previewed pull request gets one comment from the workflow with two links, edited on every push: the branch alias
(`<branch>.tfd-ledger.pages.dev`, always the newest deploy of that branch) and the commit's own deploy
(`<id>.tfd-ledger.pages.dev`). Every run also writes the links to its job summary.

### Who can open a preview

A preview is public: anyone with the link can open it, and branch aliases are guessable. Fine for the marketing site;
not for a branch carrying anything confidential. To restrict previews, turn on Cloudflare Access for them: dashboard,
**Workers & Pages > tfd-ledger > Settings > General > Access policy > Enable**. That puts every preview
(`*.tfd-ledger.pages.dev`) behind a Cloudflare login; production (`trifold.app`, `tfd-ledger.pages.dev`) stays public. The policy it
creates allows only the account's own email; add others under **Zero Trust > Access > Applications**. Free up to 50
users.

## One-time Cloudflare setup

Two tokens, each with only what its workflow needs: a Pages token for the repository, and a Workers token that only the
`staging` environment can read. A secret set on an environment overrides the repository secret of the same name for
jobs in that environment.

### 1. Find the account ID

```sh
bunx wrangler whoami
```

It prints the account name and ID. Or: Cloudflare dashboard, **Workers & Pages**, right-hand column, **Account ID**.

### 2. Create the Pages token (website)

Dashboard, **My Profile > API Tokens > Create Token > Create Custom Token**:

- Name: `github-justbry-tfd-pages`
- Permissions: **Account > Cloudflare Pages > Edit**
- Account resources: **Include > (your account)**
- Client IP filtering: none (GitHub's runners have no fixed addresses)
- TTL: optional; if you set one, note the date, as deploys skip once it expires

### 3. Create the Workers token (ledger Worker, staging)

Skip this until you want the ledger Worker deployed from CI. **Create Token**, template **Edit Cloudflare Workers**:

- Name: `github-justbry-tfd-workers-staging`
- Account resources: your account
- Zone resources: **Specific zone > b4uni.com**

The template covers the script, its R2 binding, its cron and its routes. The Worker uses a custom domain
(`ledger-staging.b4uni.com`); if the deploy fails with an authorization error on it, add **Zone > DNS > Edit** for
b4uni.com. The token in `~/.config/b4uni/cloudflare.env` has no Workers access, so it can't be reused here.

### 4. Store them in GitHub

```sh
# Repository secrets: the website workflow.
gh secret set CLOUDFLARE_ACCOUNT_ID -R justbry/tfd --body '<account id>'   # set 2026-11-08
gh secret set CLOUDFLARE_API_TOKEN -R justbry/tfd          # paste the Pages token at the prompt

# The staging environment, with you as the required reviewer, and its own Workers token.
gh api -X PUT repos/justbry/tfd/environments/staging \
  -F 'reviewers[][type]=User' -F "reviewers[][id]=$(gh api users/justbry -q .id)"
gh secret set CLOUDFLARE_API_TOKEN -R justbry/tfd --env staging   # paste the Workers token
```

Or in the browser: **Settings > Secrets and variables > Actions** for the repository secrets, and
**Settings > Environments > New environment** (`staging`, **Required reviewers**: you) for the environment and its
secret.

Optional repository variable: `PUBLIC_FORM_ENDPOINT`, where the site's early-access form posts. Unset, the form falls
back to mailto.

### 5. Check the Pages production branch

The workflow deploys production as Pages branch `main`, as the hand deploy did. Dashboard, **Workers & Pages >
tfd-ledger > Settings > Builds & deployments > Production branch** should be `main`. If it is anything else, a push to
`dev` lands as a preview, not production.

### 6. The custom domain

`trifold.app` is a zone in the same Cloudflare account. The site still deploys to the Pages project, but the public
hosts are not Pages custom domains: those stayed pending because they need a CNAME, and neither Cloudflare credential
here can edit DNS on the zone. Instead the Worker `trifold-apex` (`apps/trifold-apex`, PR #75) holds `trifold.app`,
`www.trifold.app` and `verify.trifold.app` as Worker custom domains, which add their own DNS records and certificates.
It passes apex requests through to `tfd-ledger.pages.dev`, redirects `www` with a 301 and `verify` with a 302 to
`/verify`. Deploy it with Wrangler's own login (`bunx wrangler deploy` in `apps/trifold-apex`); it rarely changes.
`SITE_ORIGIN` in `apps/trifold-site/src/lib/config.ts` makes `https://trifold.app` the canonical for every host.

### 7. First run

```sh
gh workflow run trifold-site.yml -R justbry/tfd --ref dev
gh run watch -R justbry/tfd "$(gh run list -R justbry/tfd -w 'Trifold site' -L 1 --json databaseId -q '.[0].databaseId')"
```

The **Deploy** step prints the deployment URL. If it says **Skip deploy**, a secret is missing.

For the Worker: **Actions > Deploy ledger worker > Run workflow**, then approve it under the run's
**Review deployments**. Its last step is `staging-e2e --stage 1`, which needs no credential; a FAIL there means the
deployed bundle is wrong (most often the fixture build), so roll back.

## Rollback

- Website: dashboard, **tfd-ledger > Deployments**, pick the last good one, **Rollback to this deployment**. Or
  re-run an older **Trifold site** run on `dev`.
- Worker: `bunx wrangler rollback --env staging` from `packages/ledger-worker` (wrangler login), or the dashboard's
  **Deployments** tab for `ledger-staging`.

## Deploying by hand

Still works, and needs none of the above:

- Website: `apps/trifold-site/README.md`, "Deploy to Cloudflare Pages".
- Worker: build the UI with `VITE_LEDGER_SOURCE=http VITE_API_BASE=https://api-staging.b4uni.com bun run build` in
  `packages/ledger-ui`, then `bunx wrangler deploy --env staging` in `packages/ledger-worker`, then
  `bun run staging-e2e --stage 1`.
