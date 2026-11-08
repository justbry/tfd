import type { CloudEnv } from "./env";
import { health } from "./health";

const notFound = (): Response =>
	Response.json(
		{ error: { code: "not_found", message: "Nothing here." } },
		{ status: 404, headers: { "Cache-Control": "no-store" } },
	);

/** Routes by Host: the ledger UI host and the API host share this Worker (PLAN.md section 2). */
export const route = async (
	request: Request,
	env: CloudEnv,
): Promise<Response> => {
	const url = new URL(request.url);
	const surface =
		url.hostname === env.LEDGER_HOST
			? "ledger"
			: url.hostname === env.API_HOST
				? "api"
				: null;
	if (surface === null) return notFound();
	if (url.pathname === "/healthz" && request.method === "GET")
		return health(env, surface);
	return notFound();
};
