# Trifold's plan catalog

Trifold's own plans, written as a tfd catalog, so the pricing page (`apps/trifold-site`) and, later, the hosted
product's checkout read one source. Prices are the proposals in `docs/business/pricing-strategy.md`: planned, not
offers.

| File | What it is |
| --- | --- |
| `menu.json` | A tfd menu (`packages/atm/schema/catalog/menu.v1.json`) with the standard prices: Starter, Pro, Audited, each with a month and a year price (in cents) and its monthly grants of `events` (ledger events) and `credits` |
| `menu-nonprofit.json` | The same menu at the non-profit and co-op prices. Only the amounts may differ (the site's tests check it) |
| `free.json` | The Free plan's monthly grants. Not a menu tier: tfd sells a tier through Stripe, at $0.50 or more, and Free is never sold |
| `policy.json` | Overrides of tfd's `DEFAULT_POLICY`: no member code (tfd's default would publish a `MEMBER15` coupon) |
| `index.ts` | Reads the JSON, browser-safe: `TRIFOLD_PLANS` (Free first, then the menu's tiers), `trifoldPlan(id)`, `TRIFOLD_ANNUAL_MONTHS`, `TRIFOLD_MENUS`, `TRIFOLD_POLICY`, `TRIFOLD_FREE`, `TRIFOLD_SCHOOL_IDS` |
| `check.ts` | Node or Bun only (imports tfd): `checkTrifoldCatalog()` runs tfd's `validateMenu`, `publishProblems` and `resolvePolicy` and returns the validated menus and policy; `trifoldLookupKey(org, tierId, interval)` is the Stripe lookup key `menuToStripe` publishes. `bun catalog/trifold/check.ts` exits 1 on a catalog tfd refuses; the site's build runs it first |

## Rules

- A tier's `public` flag is whether checkout sells it. Pro is a draft (`public: false`) until its features ship; the
  pricing page still shows it.
- Each menu is published under its own school id (`TRIFOLD_SCHOOL_IDS`: `tf-std`, `tf-np`), so both live in one Stripe
  account without archiving each other. Lookup keys look like `b4u_tf-std_t_starter_month_2900_usd`; a changed amount
  is a new price and key, as tfd's prices are immutable.
- The yearly price is the monthly price times `TRIFOLD_ANNUAL_MONTHS` (10) for every tier; `index.ts` throws otherwise.
- Event allowances are soft limits on the page ("books keep running"). Whatever meters them must not block on them.
- Marketing copy (taglines, features, CTAs, family counts) stays in `apps/trifold-site/src/lib/pricing/data.ts`.
