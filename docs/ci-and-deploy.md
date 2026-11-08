# CI and deploys

What runs where, and the one-time Cloudflare setup the deploy workflows need.

## What deploys what

| What | Workflow | When | Where it goes |
|---|---|---|---|
| Website (`apps/trifold-site`) | `trifold-site.yml` | pull request to `dev` | preview: `<branch>.tfd-ledger.pages.dev` |
| | | push to `dev`, or **Run workflow** | production: `tfd-ledger.pages.dev` (Pages branch `main`) |
| Ledger Worker + UI (`packages/ledger-worker`, `packages/ledger-ui`) | `deploy-ledger-worker.yml` | **Run workflow** only, after approval | staging: `ledger-staging.b4uni.com` |
| `tfd` package | `release-atm.yml` (Release tfd) | a `tfd-v<version>` tag | a release on `justbry/atm` with `tfd-<version>.tgz` |

The checks (`atm-tests.yml` and the rest) only test. Autumn's own deploy workflows (its ECR image, its deploy server, its
Slack) are removed; `UPSTREAM.md` lists them.

The site workflow always runs its checks. It deploys only when both Cloudflare secrets are set, and skips with a warning
otherwise, so a missing secret never fails a run. A pull request from a fork gets no secrets, so it is checked but not
previewed.

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
gh secret set CLOUDFLARE_ACCOUNT_ID -R justbry/tfd --body '<account id>'
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

### 6. First run

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
