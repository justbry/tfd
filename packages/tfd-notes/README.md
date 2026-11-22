<!-- SPDX-License-Identifier: Apache-2.0 -->
# tfd-notes

The promissory-note engine behind tfd's note records: from an append-only stream of events, it computes a payment
schedule, the interest, and a balance statement for each party. Pure functions, no clock, no store, no network, zero
dependencies, no `node:*` imports. The source is TypeScript and runs in Bun, Workers and browsers (through a bundler); Node needs a TypeScript loader. Not on npm yet (`private: true`).

It is a calculator and a record-keeper. It is not legal advice, and nothing it produces should be read as a promise that a
court would uphold a note. That depends on the note, the law where the parties are, and a lawyer's review.

## Entry points

Everything is exported from `src/index.ts`. Money, dates and instants are strings; the engine reads no clock.

| Group | Exports |
|---|---|
| Schedule and statement | `generateSchedule` (terms to rows); `replayBalance`, `daysOverdue`, `expectedDueToDate` (one view's balance and overdue); `statement` (both views, the itemised difference, expected vs paid, `state`); `statusLabel` (plain wording); `agreedView`. |
| Events and validation | `parseNoteEvent` (one untrusted event, against `schema/note-event.v1.json`), `parseNoteTerms`, `validateStream` (seq with no gaps, references that resolve, the stream rules below); `MAX_GRANT_DAYS`, `MAX_CARVE_OUT_DAYS`. |
| Chain | `buildChain`, `extendChain`, `chainHead`, `eventHash`, `linkHash`, `genesisHash`, `CHAIN_GENESIS_PREFIX`, `verifyChain`: a per-note hash chain over the events. |
| Documents | `paymentReceiptBody`, `payoffStatementBody`, `releaseBody`, `chainSealBody`, `documentBody`, `signDocument`, `documentSigningBytes`, `documentSha256`, `NOTE_DOCUMENT_SCHEMA`, `PAYOFF_WORDING`, `RELEASE_WORDING`: the bodies a caller signs. |
| Approvals | `approvalStatus`, `checkAppend`, `pendingApprovals`, `APPROVAL_MAX_AGE_DAYS`: two-person approval for an organization. |
| Portfolio | `portfolio` (one row per note, totals per currency), `agingBucket`, `boardReport`, `boardReportCsv`, `BOARD_CSV_HEADER`. |
| Grants | `grantsOf`, `activeGrants`, `disclosureLog`, `REVOKE_NOTICE`: who may see a note beyond its two parties. |
| Visibility | `sharedView`, `viewFor`, `agreedBalance`, `AGREED_PAYMENTS_LABEL`: what a grant shows, which never includes a negative event. |
| Canonical helpers | `canonicalJson`, `sha256Hex`, `utf8Bytes`, `toHex`, `toBase64Url`, `fromBase64Url`, plus `formatMinor`, `parseMinor`, `parseRate`, `roundHalfUp`, `addDays`, `compareDates`, `daysBetween`, `isValidCivilDate`. |

## Rules the library checks

1. **Carve-out disclosure.** A `visibility.changed` grant with `carve_out: true` may name only the purposes `accountant`,
   `lawyer`, `court` or `assignee`, a `person` audience, a level of `summary` or `statement`, and an `expires_at` at most
   `MAX_CARVE_OUT_DAYS` (90) days after `entered_at`. Any other grant keeps the `MAX_GRANT_DAYS` (365) cap.
2. **A default notice uses its own approval.** `approval.requested` for `notice.default` carries `cure_days` (0 to 365; it
   is refused on other actions). A `notice.sent` may carry `approval`, the id of that request, with the same `cure_days`
   (never on a reminder). When the policy needs two people for `notice.default`, `checkAppend` requires `approval`: a
   satisfied request that no other notice uses, with equal `cure_days`, entered at most `APPROVAL_MAX_AGE_DAYS` (30) days
   before the notice's `entered_at`.
3. **Active approvers.** If the policy carries `activeAgents`, an approval (and the request's own agent) counts only when
   its `agent_ref` is in that set, in `approvalStatus`, `checkAppend` and `pendingApprovals`. Without it every agent counts.
4. **Declined terms.** While the latest of `terms.accepted` and `terms.declined` is a decline, `validateStream` refuses a
   new `payoff.issued`, any `notice.sent`, and an `approval.requested` for `notice.default`. Payments, confirmations,
   disputes, annotations and releases still go through. In the portfolio a declined note is left out of the outstanding
   payoff, overdue and the aging buckets, shown as `current` with 0 days, flagged `declined`, and counted in the totals'
   `declined` (the board report and its CSV carry it too).
5. **Free text.** `annotation.added.text`, `payment.disputed.reason`, `payment.recorded.method` and `reference`, and
   `agent_ref` refuse control characters (U+0000 to U+001F, U+007F to U+009F), bidirectional controls (U+061C, U+200E,
   U+200F, U+202A to U+202E, U+2066 to U+2069) and U+FEFF. Text and reason may keep a newline and a tab.
6. **A chain alone shows consistency, not authorship.** `verifyChain` says the links follow from the events. Whether a
   signer stood behind that chain needs a verified `note.chain-seal` at its head, which `tfd-verify-notes` checks.

## Money, rates and dates

- Money crosses the JSON boundary as an **integer count of minor units in a digit string** (`"1000000"` for 10,000.00
  at exponent 2). The currency code and its exponent (0 to 4) are in the note's terms.
- A rate is a **decimal string of at most 6 places** (`"0.0525"`; `"0"` is allowed), parsed exactly.
- Inside the engine both are `bigint` and exact rationals. No float touches a money or rate path.
- Dates are civil `YYYY-MM-DD`. The engine does no time-zone work.

## Interest

Simple interest, daily, **actual days over 365**, on the principal outstanding. Interest never accrues on interest.
The interest due at an installment date or in a report is the exact accrued amount **rounded half up** to a minor unit; a payment
covers it first, and the exact remainder carries forward. A schedule is what a statement shows if every row's payment is
made on its due date. A payment goes to accrued unpaid interest first, then principal.

## Two views

A statement shows what the lender's records say and what the borrower's say, and lists the difference.

- A fact **against the recorder's interest** counts in both views at once (a lender recording a payment received
  from the borrower, a borrower recording a reversal of their own payment).
- A fact that **helps the recorder** counts in the recorder's view only until the other party confirms it.
- A dispute names a counter-amount and a reason, and moves only the disputing party's view. A resolution counts only when both
  parties file it with the same agreed amount.
- A reversal (a bounced check) undoes one whole payment; the statement then reads as if it was never made.
- No timer confirms anything. An unanswered event shows as unanswered, with its age.

Statements say "confirmed", "claimed by lender", "claimed by borrower" or "disputed".

## License

Apache-2.0 (`LICENSE`), so anyone can recompute a statement with it. The golden test vectors in `tests/golden/` are
CC0-1.0 and are the cross-language contract: a second implementation must reproduce each expected value exactly. The
machine-readable map is `REUSE.toml`. This package imports nothing from tfd (`packages/atm`, FSL-1.1-ALv2).
