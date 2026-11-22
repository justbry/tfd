import { checkoutRoute } from "./billing/checkout";
import { billingPage } from "./billing/pages";
import { portalRoute } from "./billing/portal";
import { billingWebhookRoute } from "./billing/webhook";
import type { CloudEnv } from "./env";
import { health } from "./health";
import { notesRoute } from "./notes/routes";
import { TRIFOLD_BOOKS } from "./org-do";

const notFound = (): Response =>
	Response.json(
		{ error: { code: "not_found", message: "Nothing here." } },
		{ status: 404, headers: { "Cache-Control": "no-store" } },
	);

/** Routes by Host: the ledger UI host and the API host share this Worker (PLAN.md section 2). */
const surfaceOf = (
	hostname: string,
	env: CloudEnv,
): "ledger" | "api" | null => {
	if (hostname === env.LEDGER_HOST) return "ledger";
	if (hostname === env.API_HOST) return "api";
	return null;
};

/** The part of the Workers execution context the router uses. */
export type WaitUntil = { waitUntil(promise: Promise<unknown>): void };

export const route = async (
	request: Request,
	env: CloudEnv,
	context?: WaitUntil,
): Promise<Response> => {
	const url = new URL(request.url);
	const surface = surfaceOf(url.hostname, env);
	if (surface === null) return notFound();
	if (
		url.pathname === "/healthz" &&
		(request.method === "GET" || request.method === "HEAD")
	) {
		const response = await health(env, surface);
		return request.method === "HEAD" ? new Response(null, response) : response;
	}
	// Billing is staging-only until the hosted product opens (AGENTS.md claim rules; PLAN.md section 10). The webhook too:
	// its catalog is the test-mode published-plans.json, so production must not book live events against it.
	if (env.ENVIRONMENT !== "staging") return notFound();
	// A link request's mail runs after the response is sent, so its time does not depend on whether an address matched.
	const notes = await notesRoute(
		request,
		env,
		context ? { defer: (work) => context.waitUntil(work) } : {},
	);
	if (notes) return notes;
	if (surface === "api" && url.pathname === "/webhooks/billing")
		return billingWebhookRoute(request, env);
	if (surface === "api" && url.pathname === "/v1/billing/checkout")
		return checkoutRoute(request, env);
	if (surface === "api" && url.pathname === "/v1/billing/portal")
		return portalRoute(request, env);
	if (
		surface === "api" &&
		url.pathname === "/v1/billing/books" &&
		request.method === "GET"
	)
		return env.ORG.get(env.ORG.idFromName(TRIFOLD_BOOKS)).fetch(
			new Request("https://org.internal/billing/status"),
		);
	if (
		surface === "ledger" &&
		(request.method === "GET" || request.method === "HEAD")
	) {
		const response = billingPage(url, env);
		if (response)
			return request.method === "HEAD"
				? new Response(null, response)
				: response;
	}
	return notFound();
};
