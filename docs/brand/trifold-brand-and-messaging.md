# Trifold: brand kit and messaging

Status: draft, 2026-11-05; names and licensing updated 2026-11-06; build status and licensing checked against the code on 2026-11-07. Names, domains and trademarks were checked on 2026-11-05 and must be checked again before anything is bought or filed. The website's own plan (hero, CTAs, pages) is in `../website/`, and where it differs from the outline below, `../website/decisions.md` wins.

## What Trifold is

This section is the positioning to aim for, not a description of what ships today. Today tfd builds the books from Stripe events and signs receipts and seals months (tfd 0.10.0); the hosted service, Rifo and tax-ready packages are not built.

**For customers:** Trifold runs your memberships, bookings and books, and an AI agent keeps them closed and tax-ready.

**For technical readers:** Trifold is an agentic financial data mart. Every payment, credit and booking lands in one ledger that can be replayed and checked, and an AI agent reads it, reconciles it and reports on it.

**What "three sides" means:** every dollar is recorded three ways. The business's books, the customer's signed receipt and the payment processor's record all agree, and anyone can check that they do. We explain this in plain words and never call it a blockchain. Today the books and the signed receipt can be checked; matching every event to Stripe's record each day is milestone 3 and not built, so don't present the third side as checked yet.

## Name architecture

| Layer | Name | Where it appears |
|---|---|---|
| Company, customer brand and managed service | **Trifold** | Website, app, emails, receipts, contracts; the legal name |
| Engine and command-line tool | **tfd** | The engine Trifold provides and runs as a managed service: "Trifold provides tfd, the engine behind it" on developer, accountant and trust pages; self-hosters run it directly. Docs, terminal. The package is named `tfd` and is not on npm yet; the npm name (`tfd` or `@trifold/cli`) is open (`../business/website-open-questions.md` 2.7). The code rename is phased: the CLI answers to `tfd` and to `atm` (the `atm` command until the rename lands); the package and directory rename comes once open PRs land |
| AI agent | **Rifo** (`@rifo`) | In the app, chat and `tfd ask`; it always cites the ledger behind each answer |

### The agent: Rifo

Rifo is the middle of tRIFOld, so the agent sounds like part of the brand. Say it "REE-foh", and print the pronunciation once on the agent's intro card so people don't say "RYE-foh". In Italian, *rifò* means "I redo", which fits an agent that redoes the books every day.

- Short and friendly, and works as a persona: "Ask Rifo."
- Speech-to-text may hear it as "Reefo" or "Rio". Add "Rifo" to the custom vocabulary of any voice feature, and also respond to "Trifold".
- In Spanish, *rifo* means "I raffle". This is harmless but worth knowing before a Spanish-language launch.

```text
@rifo why did Ava's visits drop to 1?
@rifo draft Q4 estimated taxes for Vibes of Light
$ tfd ask "which members renew next week?"
```

Why Trifold leads: it is warm, a real word, and speech-to-text hears it correctly. The engine's old name, atm, was too generic to register as a trademark, so the trademark protection sits on Trifold. (An earlier draft named the engine "Trivalance"; that name was dropped on 2026-11-06.)

### What `tfd` stands for

| Layer | Meaning | Use |
|---|---|---|
| Official | **TriFolD** | `tfd --help`, docs |
| Brand promise | **Trusted Financial Data** | Trust page, accountant pitch, the three-records story |
| Marketing line | **tfd: Taxes, Finally Done.** | Homepage, ads, the tax-season campaign |
| Easter egg | **Totally Freaking Done** | `tfd --why`, the month-close success message, stickers. Not on formal pages |

Illustration only: `tfd close` and `tfd --why` are not built.

```text
$ tfd close --month 2026-10
✓ 214 events · books balanced · 212/214 matched to Stripe
✓ October closed. Totally Freaking Done.
```

## Taglines

- Main: **Three sides of every dollar.**
- Tax season: **Taxes, Finally Done.** The first time it appears on a page, always pair it with a qualifier, such as "Tax-ready books, CPA-signed" (see Claim rules).
- Supporting lines:
  - Books that close themselves.
  - Every dollar, folded into one truth.
  - Your books closed all year. Your CPA signs in an afternoon.

## Brand kit

### Logo

Three panels folding into a triangle: a receipt folded in thirds, which also suggests the three records. Shown flat, it becomes a three-bar mark for small sizes and the favicon.

### Colour

| Role | Name | Hex |
|---|---|---|
| Primary (trust) | Ink navy | `#1E2A44` |
| Background (receipts, calm) | Paper cream | `#F6F1E7` |
| Positive (balanced, matched) | Ledger green | `#2F7D5B` |
| Accent (warmth, calls to action) | Saffron | `#E8A33D` |
| Warnings only | Clay red | `#B5533C` |

Check every text and background pair for WCAG AA contrast before shipping. Saffron is an accent colour; don't use it for body text on cream.

### Type

- Headings: **Fraunces**, a warm serif that suggests books.
- Body: **Inter**.
- Numbers and code: **JetBrains Mono**, with tabular figures so columns of money line up.

### Imagery

Folded paper, real studio and classroom scenes, ledger lines. Avoid stock photos of people in suits, glowing AI brains, coins and chains.

### Interface motifs

- A three-column fold layout.
- Every total opens to show the events behind it.
- Each transaction shows three checks: **Books ✓ Receipt ✓ Stripe ✓**.

## Voice

Calm, plain and exact. We sound like a trusted bookkeeper, not a hype-driven startup. We use short sentences and real numbers.

| Use | Avoid |
|---|---|
| books, receipts, close, balance, proof, members, sessions, credits | blockchain, crypto, web3, disrupt, revolutionary |
| "tax-ready", "CPA-signed" | "automated taxes", "we file your taxes" |
| "matched against Stripe" | "signed by Stripe" |
| "replayable", "audited" | "100% accurate", "unhackable" |

Rifo speaks in the same voice and always shows its source, for example: "From 14 payments in October · view ledger".

## Website outline

1. **Home**
   - Hero: *Memberships, bookings and books that close themselves.* Subhead: *Sell plans, packs and paid sessions. Trifold records every dollar three ways, and an AI agent keeps your books tax-ready.* Buttons: "Start free" and "See a live ledger". Superseded on 2026-11-06 (`../website/decisions.md`): the hero is "Books that show their work." and the CTA is "Get early access", because the hosted product isn't live.
   - Logo strip: B4 Uni schools, Vibes of Light. These are the owner's own or related businesses, so show them as design partners with the connection disclosed (`../business/website-open-questions.md` 4.4).
   - The three folds: **Sell** (plans, add-ons, packs, bookings) · **Record** (ledger, signed receipts) · **Close** (the agent reconciles, reports and builds the tax package).
   - Agent demo: "How did October go?", with an answer that cites the ledger.
   - One section per audience (below), a CPA partner block, a pricing preview and an FAQ.
2. **Product:** Billing and memberships · Bookings and credits · The Ledger · The Agent · Tax-ready
3. **Solutions:** Studios · Micro-schools and tutoring · Nonprofit schools · Platforms and developers
4. **Accountants:** partner programme, read-only seats, the year-end package
5. **Developers:** `tfd` CLI, API, MCP server, webhooks, docs
6. **Trust:** how the three records work, `tfd verify`, security, data ownership (export to Parquet or hledger at any time)
7. **Pricing**
8. **About, blog, changelog**

## Ideal customer profiles

### 1. Studio owner

Yoga, light therapy, sauna or Pilates; 50 to 500 members.

- **Message:** Sell packs and memberships your way. Know who has visits left. Never do the books again.
- **Cares about:** members running out of visits, failed payments, time at month-end, simple pricing changes (1, 2 or 4 sessions a month), looking professional.
- **Doesn't care about:** ledgers, APIs, how the data is stored.
- **Proof:** the Vibes of Light case study, "N visits left" alerts, no spreadsheets at year-end.
- **Objection and answer:** "I already use Mindbody." Keep booking where you like and let Trifold close the books, or switch fully for less.
- **Channels:** studio-owner communities, Instagram, referrals from bookkeepers.

### 2. Micro-school or tutoring director

B4 Uni schools; 10 to 150 families.

- **Message:** Tuition, sessions and receipts families can use at tax time, handled.
- **Cares about:** itemised receipts per child for tax credits and education savings accounts, families with several children, fair refunds, few admin hours.
- **Doesn't care about:** usage-pricing jargon, dashboards for their own sake.
- **Proof:** a sample signed receipt with the child's name, hours and the school's EIN; built into B4 Uni.
- **Objection and answer:** "Will it satisfy our state?" Receipts are designed against the state's requirements, and your CPA confirms them.
- **Channels:** inside B4 Uni, homeschool and micro-school networks, state education-choice groups.

### 3. Nonprofit school treasurer or board

- **Message:** Open books, at the right level of detail for each person.
- **Cares about:** transparency, separating restricted funds, donor privacy, board reports, the audit trail, Form 990.
- **Doesn't care about:** booking features, the agent's personality.
- **Proof:** detail levels by viewer (public, members, board, finance), a replayable ledger, an audit log of who read what.
- **Objection and answer:** "Is our donor data safe?" Names are visible only to the owner and the finance admin, and every read is logged.
- **Channels:** nonprofit finance communities, board-training groups, CPA partners.

### 4. Bookkeeper or CPA partner

Serves 10 to 100 small businesses.

- **Message:** Clients whose books arrive closed. You review and sign.
- **Cares about:** clean reconciliation to Stripe; exports to QuickBooks, Xero, hledger and CSV; an audit trail; fewer client emails; recurring revenue.
- **Doesn't care about:** the booking interface, member alerts.
- **Proof:** a year-end package, every number traced to an event, a read-only partner seat, `tfd verify`.
- **Objection and answer:** "Will AI replace me?" No. The agent prepares and you sign, so you can serve more clients per hour.
- **Channels:** accounting communities, the firm programme (free seats, client discounts and firm tiers; Trifold pays accountants no cash referral fees, `../business/go-to-market.md`), CPE webinars.

### 5. Developer building a membership or credits product

SaaS founders and platform teams.

- **Message:** Credits, plans and a provable ledger as an API, with an agent that answers finance questions.
- **Cares about:** a deterministic engine (same input, same result), idempotent webhooks, Stripe-native billing, a good CLI, MCP, self-hosting, no lock-in.
- **Doesn't care about:** studio-specific features, marketing polish.
- **Proof:** the source-available engine (free to self-host), the `tfd` CLI, replay tests, export to Parquet and DuckDB.
- **Objection and answer:** "Why not Stripe Billing, Orb or Metronome?" Trifold puts credits, rollovers and a provable ledger in one engine, not only invoices.
- **Channels:** GitHub, Hacker News, developer content, the Autumn community.

## The three records story

The idea comes from Ian Grigg's 2005 work on triple-entry bookkeeping: every transaction gets a third record, a receipt signed with public-key cryptography that both parties hold, so neither side can quietly change its own books. We use the idea but not the label. Never call Trifold "triple-entry".

| Record | Whose | In Trifold |
|---|---|---|
| 1. The books | The business's | Double-entry postings; months sealed and chained (a chain over every event is milestone 2) |
| 2. The receipt | The customer's | A signed receipt the customer keeps and can verify |
| 3. The processor's record | Stripe's | Stripe's record of the charge, matched every day (milestone 3, not built) |

"Witness" means only Trifold's countersignature ("Witnessed by Trifold", `../../TRADEMARKS.md`), never Stripe's record.

### How each side is kept honest

This is the finished design. Today the receipt and seal checks work; the per-event hash chain, daily Stripe matching and a published daily fingerprint are not built.

| Attempt | What catches it |
|---|---|
| The business edits an old charge | The customer's signed receipt no longer matches, and the hash chain breaks |
| The business deletes a charge | The chain has a gap, and the customer still holds the receipt |
| A customer forges or inflates a receipt | The signature fails against the business's published key |
| A refund or correction | A new signed receipt that names the one it replaces. Nothing is ever edited |
| Trifold rewrites history | The published daily fingerprint no longer matches, and customers still hold their copies |

### What exists and what is to build

What exists today, in `packages/atm`:
- Postings must balance to zero in each currency (`src/ledger/validate.ts`).
- The same event always gets the same canonical bytes and id (`src/ledger/postings.ts`, `src/ledger/ids.ts`).
- Duplicate events are recorded only once (`idem`).
- Balances can be replayed from events and checked (`src/ledger/replay.ts`).
- Each month's close has a hash of its inputs (`inputsHash` in `src/ledger/journal.ts`).
- Batches are written once, with their hash in the key (`src/ledger/ship.ts`).
- Stripe signatures are checked on ingest (`src/handler/stripe-signature.ts`).
- Journals can be read by hledger.
- Signed receipts and sealed months (milestone 1, released in tfd 0.10.0 on 2026-11-07): an Ed25519 receipt per payment and refund, a signed seal per closed month chained to the one before, `tfd keys new`, `tfd receipt`, `tfd verify receipt`, `tfd seal`, `tfd verify seals`. No school issues them yet.
- `tfd-verify` (`packages/verify`, Apache-2.0, not yet published): the same receipt and seal checks for browsers. The website preview's verifier uses it.

To build (status as of 2026-11-07):
1. Link every ledger event to its Stripe source (event id, charge, invoice, sha256 of the raw body).
2. Chain events by hash per business (`prev_hash`, `hash`), and record the latest event's hash in each batch and month close.
3. Sign batches and month closes with Ed25519 keys, and publish the public keys at `/.well-known/trifold-keys.json`. Month seals are signed (milestone 1) and `tfd keys new` writes `keys.json`; batches aren't signed, and no school serves the keys yet.
4. Signed customer receipts (`receiptOf`), with a verify page and `tfd verify receipt`. Built (milestone 1); the verify page is in the site preview only. The open receipt decisions in `packages/atm/ROADMAP.md` (erasure, key id, refunds, disputes, when to seal) still come before a school issues them.
5. Match every event daily against Stripe's balance transactions and payouts.
6. Optional: publish each day's summary hash to a public transparency log.
7. An open `tfd verify` (Apache-2.0) that checks the chain, signatures, balances, replay, the Stripe matches and receipts. Partly built: receipts and seals (`tfd verify`, `tfd-verify`); the chain and the Stripe matches need steps 2 and 5.

Where the code goes: tfd stays pure. `receiptOf`, the canonical receipt bytes and `verifyReceipt` live in tfd. Signing with a stored key and delivering receipts belong to the caller.

## Claim rules

What we may say depends on what has shipped. The license wording rules are in the table below the ladder.

| After | We may say |
|---|---|
| Today | "Double-entry, append-only, replayable books" |
| Steps 1 to 3 | "Tamper-evident books" |
| Steps 4 and 5 | "Three records that agree: your books, your customer's receipt and Stripe's record, signed and matched" |
| Steps 6 and 7 | "Independently verifiable: check our math yourself with `tfd verify`" |

**Open: this ladder and the business plan disagree** (`../business/website-open-questions.md` 4.1). Option A is the ladder above. Option B is the plan's rule (`../business/business-plan.md` section 3): "signed receipts and sealed books" until milestones 2 and 3 ship, and never "triple-entry" for Trifold. Until the owner picks one, copy follows the stricter reading of both. Both agree on "double-entry, append-only, replayable books" today, on "signed receipts and sealed books" for milestone 1, and on never saying "triple-entry".

### License wording

| Say | Never say |
|---|---|
| "Source-available", "Fair Source", "free to self-host" for the engine | "Open source" for tfd. FSL is not OSI-approved |
| "Open format", "open spec", "open standard", "open verifier" | "Open source" for the whole product |
| "The verifier and receipt format are Apache-2.0" | "Anyone can run a hosted service on tfd" |
| "Every tfd release becomes Apache-2.0 two years after it ships" | "Not even Trifold can quietly change your books" |
| "Even if Trifold disappears, the code becomes Apache-2.0" | "Triple-entry" for Trifold, or any speed numbers |

Open formats and an open verifier are fine to say because those parts are Apache-2.0 (the vectors are CC0). Keep the claim to the parts that carry that license.

We never claim that Trifold files taxes. Filing needs an authorised e-file provider and a human who signs, and who is liable when an AI makes a filing error is unsettled. "Taxes, Finally Done" always comes with "tax-ready" or "CPA-signed" on first use, because the FTC treats an implied claim like an explicit one.

Also not to claim yet: usage-based pricing (not built), itemised receipts (not built), and tax amounts on invoices (not built).

## Names, domains and trademarks

As checked on 2026-11-05:

| Item | Result |
|---|---|
| gettrifold.com | Free |
| trifold.com, .ai, .io | Registered by others |
| npm `trifold`, `tfd` | `trifold` is taken; `tfd` was unpublished in 2024 and may be claimable; `@trifold/cli` is the fallback. Open (`../business/website-open-questions.md` 2.7) |
| `tfd` command | No clash found on PATH or Homebrew |
| Samsung Galaxy Z TriFold | Dominates search for "trifold". An SEO problem; have a lawyer check Samsung's filings |
| Old TRIFOLD filings | A dead class 9 application (serial 77941454) and a "tri fold" class 42 filing of unknown status (77000614). Check in USPTO TSDR |

Next steps:
1. Register gettrifold.com (and usetrifold.com to redirect).
2. Claim the npm scope `@trifold`, the GitHub organisation and the main social handles.
3. Get a trademark clearance search for TRIFOLD in classes 9, 36 and 42.

## Licensing summary

Decided by the owner on 2026-11-06; the website and `tfd-verify` rows on 2026-11-07. On 2026-11-07 the owner also considered a three-year conversion and kept FSL's fixed two years. The authoritative table is in `../../AGENTS.md`.

| Part | License |
|---|---|
| tfd engine and CLI (`packages/atm`, except the parts below) | **FSL-1.1-ALv2**. Source-available: free to use, modify and self-host for your own books, for non-commercial education and research, and for professional services to a licensee (for example an accountant working on a client's own install). Not allowed: offering it to others as a commercial product or service that competes with Trifold. Each release becomes Apache-2.0 two years after it ships |
| Receipt and seal format, spec and verifier (schemas, `docs/receipts.md`, receipt, seal, sign and canonicalisation code, and `tfd-verify` in `packages/verify`) | **Apache-2.0** |
| Test vectors (golden receipt files) | **CC0-1.0** (public domain) |
| Autumn code this repo forks (`balance-engine`, `shared`, and so on) | **Apache-2.0** (upstream license, unchanged) |
| The website (`apps/trifold-site`), all of it; its verifier comes from `tfd-verify` | Proprietary |
| Hosted Trifold service, Rifo, the witness | Proprietary |

**Why.** "Anyone can check, forever" needs checking (verifier, format, vectors) to be unrestrictable. The engine is protected from a hosted clone, but each release becomes Apache-2.0 after two years, so even if Trifold disappears, the code becomes Apache-2.0.

**Open items:** the licensor's legal entity name (the LICENSE says "Trifold" until a company is formed); whether accounting firms hosting tfd for many clients need a grant beyond FSL's professional-services clause (decide before the accountant partner program); contributor terms are decided (a CLA, 2026-11-07, `CONTRIBUTING.md`); whether the event envelope schema should also be Apache-2.0 so other ledgers can adopt the full standard.
