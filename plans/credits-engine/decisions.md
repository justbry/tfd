# D12 owner decisions

For [`plan.md`](plan.md). Each question has a recommended default and the reason for it. Answer inline (`**Answer:**`) or in the PR review. Decisions 1-7 set what tfd's rules do for buzz-school, and so which shadow differences are excused (plan §5) and which become a tfd policy (T8).

## Rule differences

### 1. Rollover cap

bs stores `rollover.max` on a menu grant but never applies it; tfd applies it at each renewal, and leftover above the cap is lost.
- **Default: enforce, with one grandfathered cycle.** Imported rows are uncapped, so the first renewal after cutover takes nothing; the cap applies from the second. Schools set the max themselves, believing it worked. Tell admins before their cutover so they can raise or remove it.
- Alternative: never enforce for bs schools (a T8 policy flag). Members keep everything, and the setting stays meaningless.

**Answer:**

### 2. Mid-cycle upgrade

bs grants a new tier's credits at the next renewal; tfd grants them when the upgrade invoice is paid.
- **Default: tfd's rule (at once).** Members gain, and it matches what they paid for.

**Answer:**

### 3. Expiry zone

bs computes rollover expiry in the school's zone (`addMonthsInZone`); tfd in UTC (`rolloverExpiry` → `addUtcMonths`). The difference is up to an hour across a DST change.
- **Default: the menu's zone in tfd (T8)**, behind a policy version so existing tfd logs replay as before. Small, invisible to members, and it removes an excused diff class.

**Answer:**

### 4. Lapse

When a cycle ends unpaid, bs's readers skip expired lots (the member sees 0) and nothing is booked. tfd's refilling row keeps its balance until the next invoice or a cancel.
- **Default: keep bs's behavior.** bs runs a job that calls tfd's `recordLapse` for memberships past their cycle end (B17). Spending isn't built, so nobody can use the stale balance today, but the portal would show it.

**Answer:**

### 5. One-time add-on and gift expiry

A bs one-time lot expires after the grant's rollover months, or never if the grant has none. tfd's gift rows expire after `policy.giftSessionMonths` (default 6).
- **Default: keep bs's rule as a policy.** Changing it would expire credits members bought expecting them to last. Needs T8 to carry it, or a policy value per school that reproduces it (check whether "never" is expressible).

**Answer:**

### 6. Per-member menu version

bs members keep the menu version they bought (bs `docs/features/school-billing.md`). tfd's handler takes one menu per school per event.
- **Default: keep per-member versions (T5).** Anything else silently reprices existing members.

**Answer:**

### 7. Never-expiring admin adjustments

A positive bs adjustment is a lot with no expiry. On tfd's refilling row it would expire with the cycle.
- **Default: keep them never-expiring** (`adjustCredits`, T4). Admins grant goodwill expecting it to stay.

**Answer:**

## Production and safeguarding

### 8. Production state

The sources disagree on whether `school_billing` is on in production, and no doc gives school or member counts.
- **Default: the owner approves and runs a read-only query (plan stage 0, O2)** and keeps the result in their ops notes, not in a repo doc (switch states are never written in docs). The counts size stages 3 and 4. If no school bills in production, stage 3 and 4 become staging-only until one does, and the announcement plan shrinks to the release note.

**Answer:**

### 9. E2/D-3 for credit events

tfd's handler writes family-keyed rows to `ledger_outbox` itself, while bs's `ledger_export` switch decides today whether such rows are written at all.
- **Default: write them always; ship them only where the export is on.** In production, ship credit events only once D-3 allows family-keyed credit events. Unshipped rows are covered by erasure (plan §10).

**Answer:**

## Stripe

### 10. Acacia vs clover

tfd reads only `2025-10-29.clover`; bs endpoints are at `2025-02-24.acacia`.
- **Default: bs moves its endpoints to clover**, per school, with the two-endpoint method (plan §4). bs's readers already read both shapes. Supporting acacia in tfd is M-L and doubles the mapping tests.
- Separately: pin `Stripe-Version` on checkout now (B7), at acacia, so the account default can't decide the billing mode.

**Answer:**

## Communication

### 11. Announcement timing

- **Default:** each school's admins hear at least 14 days before its cutover (date, rollover cap, a Stripe warning email they may see, faster upgrade grants). A release note when the first school moves. Members of schools with a rollover cap hear before their first non-grandfathered renewal.

**Answer:**

### 12. Stage 3 length

- **Default:** 14 nights with only excused diffs, and at least one renewal of every member, so up to 31 nights for monthly members.

**Answer:**
