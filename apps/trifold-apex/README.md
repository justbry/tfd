# trifold-apex

Serves `trifold.app` and `www.trifold.app`. It is a Worker because a Worker custom domain manages its own DNS record,
and neither Cloudflare credential this project uses can edit DNS on the zone (a Pages custom domain needs a CNAME someone
adds by hand).

- `trifold.app`: every request goes to the Pages production deploy, `tfd-ledger.pages.dev`, and its answer comes back as
  is. Redirects to the Pages host are rewritten to the apex. The site itself still deploys to Pages
  (`.github/workflows/trifold-site.yml`); this Worker rarely changes.
- `verify.trifold.app`: 302 to `https://trifold.app/verify`, keeping the query (`?r=<receipt>`); a `#r=` fragment stays
  in the browser across the hop. Temporary: the host gets its own verifier app (`apps/trifold-verify`, PLAN.md
  section 8). Its `/.well-known/` answers 404 until production keys exist.
- `www.trifold.app` (and any other host): 301 to the same path on `trifold.app`.

```sh
bun test tests
bunx wrangler@4.90.0 deploy   # with wrangler's own login; unset CLOUDFLARE_API_TOKEN if a Pages-only token is exported
```
