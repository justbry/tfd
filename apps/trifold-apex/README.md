# trifold-apex

Serves `trifold.app`, `www.trifold.app` and `verify.trifold.app`. It is a Worker because a Worker custom domain manages its own DNS record,
and neither Cloudflare credential this project uses can edit DNS on the zone (a Pages custom domain needs a CNAME someone
adds by hand).

- `trifold.app`: every request goes to the Pages production deploy, `tfd-ledger.pages.dev`, and its answer comes back as
  is. Redirects to the Pages host are rewritten to the apex. The site itself still deploys to Pages
  (`.github/workflows/trifold-site.yml`); this Worker rarely changes.
- `verify.trifold.app`: 302 to `https://trifold.app/verify`, keeping the query (`?r=<receipt>`); a `#r=` fragment stays
  in the browser across the hop. Temporary: the host gets its own verifier app (`apps/trifold-verify`, PLAN.md
  section 8). Its `/.well-known/` answers 404 until production keys exist.
- `www.trifold.app` (and any other host): 301 to the same path on `trifold.app`.
- Plain `http:` on any host: 301 to `https:` first (`verify.trifold.app` keeps its host; its 302 then applies).
- `POST https://trifold.app/api/early-access` (`src/early-access.ts`): the site's early-access form. Only from the
  `https://trifold.app` origin (403 otherwise), form-encoded or multipart, at most 16 KiB, fields checked and capped; a
  filled `website` honeypot answers 200 and is dropped. Five posts a minute per IP (the `EARLY_ACCESS_LIMIT` Rate
  Limiting binding). It sends one plain-text email from `early-access@trifold.app` to the `EARLY_ACCESS_TO` secret (a
  verified Email Routing destination) through the `EARLY_ACCESS_EMAIL` send_email binding, Reply-To the submitter.
  Nothing is stored; logs say only "early-access sent" or "early-access failed" and the error class. A failed send
  (an unverified destination, say) answers 503 and the page offers hello@ instead.

```sh
bun test tests
bunx wrangler@4.90.0 deploy   # with wrangler's own login; unset CLOUDFLARE_API_TOKEN if a Pages-only token is exported
bunx wrangler@4.90.0 secret put EARLY_ACCESS_TO   # once: the verified destination address
```
