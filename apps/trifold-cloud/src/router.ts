import type { CloudEnv } from "./env";
import { health } from "./health";

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

export const route = async (
	request: Request,
	env: CloudEnv,
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
	return notFound();
};
