# S8f: the staging end-to-end (script and runbook)

S8f proves, on **staging only**, that the pieces S8a to S8e built work as one: the family service on `https://api-staging.b4uni.com` (Fly `b4uni-stg-family`) mints a ledger token for a signed-in school admin, the Worker on `https://ledger-staging.b4uni.com` accepts exactly that token, the views the cron job builds from the events the family service ships to `b4uni-stg-ledger` are what the Worker answers with, and a refund made in the family service shows up in the ledger with an `asOf` after it. It also proves the negative side: forged, expired, wrong-audience and `alg: none` tokens are refused, the CORS preflight allows the staging ledger origin and not the production one, the deployed bundle calls the staging API and carries no fixture school.

Nothing here touches production. The script's two base URLs are a hard allow-list (`resolveTargets` in `packages/ledger-worker/scripts/staging-e2e.ts`): any host other than `ledger-staging.b4uni.com` (Worker) and `api-staging.b4uni.com` (family service) is refused before a request is sent, and no environment variable widens it (only the test suite passes an extra origin in code). A live Stripe key is never used: the refund test needs a charge made with a Stripe **TEST-mode** key.

Contract: `plans/ledger-ui/S8-contract.md` sections 2 and 11. The buzz-school side: `docs/features/ledger-export.md` ("Staging bring-up"), `docs/features/qa-links.md`, `docs/features/ledger-access.md`, `docs/features/school-billing.md` (all in `justbry/buzz-school`, read them there; they are not copied here).

## What the script does

```bash
bun run --cwd packages/ledger-worker staging-e2e [--stage N[,N]] [--json] [--strict]
```

| Stage | Needs | Proves |
| --- | --- | --- |
| 1 | nothing | `/healthz`; no token, forged, forged-expired, `alg: none` and wrong-`aud` tokens are 401; CORS preflight; the UI assets and bundle; SPA fallback; JWKS |
| 2 | a QA account that owns or administers a staging school and has a PIN | the sign-in chain (QA link, verify, PIN, ledger token), the Worker's envelope, tampered and expired-looking tokens refused, finance gating for an admin without the grant |
| 3 | stage 2, plus the R2 key, `ledger_export` on and one ship and views run | `asOf` is set and not stale; the KPI document and a month of ledger rows answer with `asOf` and `lagMinutes` |
| 4 | stage 2, plus a Stripe TEST key connected to the school, a paid member's TEST charge, a booking | step-up, a refund with an `Idempotency-Key` and its replay, the refund reaching the Worker's ledger with `asOf` after it, a booking cancel |

The default is stages `1,2,3`. **Stage 4 moves (test) money and mails the booking's people, so it runs only when you ask for it** (`--stage 4`), and it never refunds without `S8F_PAYMENT_ID` and `S8F_REFUND_CENTS` and `S8F_SCHOOL_ID` all set explicitly.

Every check prints `PASS|FAIL|BLOCKED  <stage>.<check>  <why>` and the run ends with a table of the three counts per stage. Exit `0` when nothing FAILed, `1` on any FAIL (`--strict` also fails on BLOCKED), `2` on a usage error (a bad flag, a malformed input, a refused host). `--json` prints one JSON document (`results`, `summary`) on stdout and the lines on stderr.

Inputs are environment variables, never argv:

| Variable | Meaning |
| --- | --- |
| `S8F_WORKER`, `S8F_API` | default to the two staging origins; anything else is refused |
| `S8F_QA_EMAIL`, `S8F_PIN` | the QA account (an address in `QA_EMAILS` on `b4uni-stg-family`) and its PIN |
| `S8F_QA_EMAIL_ADMIN` | optional: an admin of the same school **without** the finance grant (its PIN is `S8F_PIN_ADMIN`, default `S8F_PIN`) |
| `S8F_SCHOOL_ID` | the staging school (a uuid); stage 2 and 3 default to the first school in the token, stage 4 requires it |
| `S8F_PAYMENT_ID` | stage 4: a `pi_`, `ch_` or `py_` id of a Stripe TEST-mode charge for a paid member of that school |
| `S8F_REFUND_CENTS` | stage 4: the amount to refund, a positive integer, at most the charge |
| `S8F_BOOKING_ID` | stage 4: a booking of the school to cancel (it mails that booking's people; use a test booking) |

Tokens, links, PINs and cookies are never printed beyond their first four characters, and the cookie jar lives in memory only. The QA link is minted over `fly ssh console -a b4uni-stg-family -C "bun src/ops/cli.ts qa-link --email <addr> --by s8f --apply"` (the `fly` CLI must be logged in), is good for 5 minutes and single use, and is redeemed with `POST /family/verify`; the step-up for the refund is a second link with `--purpose step_up`, good for 10 minutes.

## Owner steps (nobody else can do these)

1. **The bucket's S3 key.** Create an R2 API token scoped to `b4uni-stg-ledger` only (Object Read & Write) and write `~/.config/b4uni/r2-stg-ledger-s3.env` with `R2_LEDGER_ENDPOINT`, `R2_LEDGER_BUCKET`, `R2_LEDGER_ACCESS_KEY_ID`, `R2_LEDGER_SECRET_ACCESS_KEY` (`chmod 600`). The steps are in buzz-school `docs/features/ledger-export.md`, "Pending: the bucket's S3 key (owner)". Do not paste the values anywhere.
2. **A Stripe TEST-mode restricted key**, entered by the school owner in the school's billing settings (`docs/features/school-billing.md`, "Connect, publish, webhook"). Then publish a menu: the publish writes `catalog.published`, which is what makes the school appear in the bucket.
3. **A staging school.** Name or create the school that will carry the test (no staging school has Stripe connected today). Its id is `S8F_SCHOOL_ID`.
4. **A second QA admin account without the finance grant**, added to the same school as an admin and to `QA_EMAILS`, with a PIN set. Without it the stage 2 finance-gating checks stay BLOCKED.
5. **The QA owner account** in `QA_EMAILS` with a PIN set and the school in its roster, and `S8F_PIN` handed to whoever runs the script (not through chat logs). Today `QA_EMAILS` is a Fly secret and no documented command lists it.
6. For stage 4: a paid member (a TEST-mode card payment through the school's checkout) and a booking.

`qa_links` must be on (it is on staging) and `school_api`, `school_billing` and `bookings` too. `ledger_export` is turned on by the sequence below.

## Command sequence once the keys exist

From buzz-school (`/Users/jmac/repos/buzz-school`, a clean `origin/main`), as in `ledger-export.md`:

```bash
# 1. Secrets, on stdin from the file (restarts the app, ~20 s). Names only on the command line.
set -a; . ~/.config/b4uni/r2-stg-ledger-s3.env; set +a
printf 'R2_LEDGER_ENDPOINT=%s\nR2_LEDGER_BUCKET=%s\nR2_LEDGER_ACCESS_KEY_ID=%s\nR2_LEDGER_SECRET_ACCESS_KEY=%s\n' \
  "$R2_LEDGER_ENDPOINT" "$R2_LEDGER_BUCKET" "$R2_LEDGER_ACCESS_KEY_ID" "$R2_LEDGER_SECRET_ACCESS_KEY" | fly secrets import -a b4uni-stg-family
curl -fsS https://api-staging.b4uni.com/health
# 2. The switch, staging only.
bun run flag staging ledger_export on --who <name> --why "S8f: ledger events to b4uni-stg-ledger" --apply
# 3. Catalog backfill: dry run, read the counts, then apply.
fly ssh console -a b4uni-stg-family -C "bun src/ops/cli.ts ledger-backfill-catalog"
fly ssh console -a b4uni-stg-family -C "bun src/ops/cli.ts ledger-backfill-catalog --apply --by <name>"
# 4. Status, after the next ship (R2_LEDGER_EVERY_MIN, default 10 minutes).
fly ssh console -a b4uni-stg-family -C "bun src/ops/cli.ts ledger-status"
fly logs -a b4uni-stg-family --no-tail | grep -E 'ledger\.(ship_|watermark_)'   # expect no line
```

Then, from this repo, with the inputs in the environment (`set -a; . <your env file>; set +a`, never typed on the command line):

```bash
bun run --cwd packages/ledger-worker staging-e2e --stage 1,2,3          # about a minute
bun run --cwd packages/ledger-worker staging-e2e --stage 4              # the refund: up to ~15 minutes of polling
bun run --cwd packages/ledger-worker staging-e2e --stage 1,2,3,4 --strict   # the gate: nothing BLOCKED, nothing FAILed
```

The Worker's cron runs every 5 minutes and the shipper every 10 (`R2_LEDGER_EVERY_MIN`), so after a first event allow up to about 15 minutes before stage 3 has `asOf`. Stage 4 polls the Worker every 30 s for up to 15 minutes and prints each poll.

## Expected output

- **Stage 1** (14 lines, all PASS, no credential, safe to run any time): `healthz`, `no-token`, `forged-signature`, `forged-expired`, `alg-none`, `wrong-aud` (each `401 token_invalid` with the real `kid`), `cors-preflight` (204, allow-origin the staging ledger origin, allow-credentials true), `cors-prod-origin` (no allow-origin), `index-html`, `assets`, `bundle-api-host`, `bundle-no-fixtures`, `spa-fallback`, `jwks` (one Ed25519 key; two during a rotation window).
- **Stage 2**: `qa-link-login`, `pin-verify`, `ledger-token` (token prefix, `expiresAt`, `schools[]` size), `school`, `schools-envelope` (200, `{asOf,lagMinutes,data}`; `asOf` is `null` before data), `tampered-token` and `expired-looking-token` (401), and with the second account `finance-ledger`, `finance-income-statement` (403 `finance_required`) and `audience-finance` (403 `audience_not_allowed`).
- **Stage 3**: `views-present` (`asOf` set, `stale false`), `kpi-owner`, `ledger-month`.
- **Stage 4**: `stripe-connected`, `step-up`, `refund` (Stripe's `status`), `refund-replay` (the same refund id), `ledger-refund` (a `payment.refunded` entry with `asOf` after the refund), `booking-cancel` (state `cancelled`).

## Reading BLOCKED and FAIL

- **PASS**: the check ran and the answer was right.
- **BLOCKED**: the check could not run because something outside the code is missing. The line says what and who supplies it (the owner's four steps above, a PIN, a second account). A BLOCKED line is not a defect; a run that is meant to be complete (`--strict`) must have none. The usual ones: `account abc… administers no school on the staging relay` (the QA address has no school: step 5), `qa-link refused qa_links_off|not_qa_email` (the switch or `QA_EMAILS`), `no PIN set`, `no views yet` (the R2 key, the switch, or no event shipped yet).
- **FAIL**: the system answered, and not as the contract says. The line gives the status and error code that came back. Do not rerun until it passes: read it. `bundle-no-fixtures` FAIL names the fixture school that shipped in the deployed UI bundle (a UI build with mock data in it). `forged-*` or `alg-none` not refused is a security defect: stop and report. `ledger-refund` FAIL after 15 minutes: check `ledger_export`, `ledger-status`, the Stripe webhook and `fly logs ... ledger.`.
- A `503 school_api_unavailable` from the token mint is a FAIL that means "try again"; it never means "no schools".

## Cleaning up after the refund test

- **Stripe (test mode)**: the refund stays on the test charge (a test refund cannot be undone, and costs nothing). Use a charge you can spend: a second run needs a different `S8F_PAYMENT_ID` or a remaining amount, because refunds add up to the charge. The test customer, subscription, restricted key and webhook endpoint stay until the owner removes them in the Stripe test dashboard.
- **Bucket `b4uni-stg-ledger`**: `schools/<id>/events/date=*/batch-*.jsonl` and `_shipped-through.json` (the events, including the refund and its `family:<id>` customer key; staging only, D-3), and `schools/<id>/views/**` (rebuilt every 5 minutes). Nothing is deleted by the script. To empty a school's prefix, the owner deletes `schools/<id>/` with an S3 client and the key file from step 1; the shipper does not re-ship rows it has marked shipped, so a school emptied this way stays empty until a new event arrives (ask the buzz-school side before relying on a re-ship). Turn the shipper off with `bun run flag staging ledger_export off ... --apply` (the outbox keeps its rows).
- **Family service**: the audit rows (`qa.link_minted`, `ledger.token_minted`, `school_billing.refund_issued`) stay; the booking stays `cancelled` and its people were mailed; the QA sessions expire on their own.
- **Local**: nothing is written to disk. Unset the `S8F_*` variables.
