export type ApexEnv = {
	/** The canonical host, e.g. trifold.app. */
	APEX: string;
	/** The Pages production host the apex serves, e.g. tfd-ledger.pages.dev. */
	ORIGIN: string;
	/** The receipt verifier's host, e.g. verify.trifold.app. Until its own app ships it points at the site's /verify. */
	VERIFY: string;
};

type Fetcher = (request: Request) => Promise<Response>;

/** Hop-by-hop and edge headers that must not be forwarded to the origin as if the visitor sent them to it. */
const DROPPED_REQUEST_HEADERS = [
	"host",
	"cf-connecting-ip",
	"x-forwarded-host",
	"x-real-ip",
];

/**
 * verify.<apex>: 302 to the site's /verify, for now. www.<apex> and any other host: 301 to the same path on the apex.
 * The apex: the same request against the Pages origin, answered as is (status, headers and body), with redirects passed
 * back to the browser rather than followed, and any redirect to the origin's own host rewritten to https on the apex.
 */
export const handle = async (
	request: Request,
	env: ApexEnv,
	upstream: Fetcher = fetch,
): Promise<Response> => {
	const url = new URL(request.url);
	if (url.hostname === env.VERIFY) {
		// No production keys are published yet, so there is no keys file to serve.
		if (url.pathname.startsWith("/.well-known/")) {
			return new Response("Not found", {
				status: 404,
				headers: { "Cache-Control": "no-store" },
			});
		}
		// 302, not 301: browsers cache a 301 for good, and this host gets its own verifier app (PLAN.md section 8). The
		// query (`?r=<receipt>`) carries over, and a `#r=` fragment stays in the browser, which keeps it across the hop.
		return new Response(null, {
			status: 302,
			headers: {
				location: `https://${env.APEX}/verify${url.search}`,
				"Cache-Control": "no-store",
			},
		});
	}
	if (url.hostname !== env.APEX) {
		return Response.redirect(
			`https://${env.APEX}${url.pathname}${url.search}`,
			301,
		);
	}
	const target = new URL(url.pathname + url.search, `https://${env.ORIGIN}`);
	const headers = new Headers(request.headers);
	for (const name of DROPPED_REQUEST_HEADERS) headers.delete(name);
	const response = await upstream(
		new Request(target, {
			method: request.method,
			headers,
			body: request.body,
			redirect: "manual",
		}),
	);
	const location = response.headers.get("location");
	if (location === null) return response;
	const rewritten = new URL(location, target);
	if (rewritten.hostname !== env.ORIGIN) return response;
	rewritten.protocol = "https:";
	rewritten.hostname = env.APEX;
	const out = new Response(response.body, response);
	out.headers.set("location", rewritten.toString());
	return out;
};

export default {
	fetch: (request: Request, env: ApexEnv): Promise<Response> =>
		handle(request, env),
};
