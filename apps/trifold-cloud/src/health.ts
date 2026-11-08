import type { CloudEnv } from "./env";

const probe = async (
	name: string,
	check: () => Promise<unknown>,
): Promise<boolean> => {
	try {
		await check();
		return true;
	} catch (error) {
		// The reason goes to the logs, never to the public answer.
		console.error(
			`healthz: ${name} failed: ${error instanceof Error ? error.message : String(error)}`,
		);
		return false;
	}
};

/** `/healthz`: proves the D1 and both R2 bindings answer. 503 when one fails, so a deploy check can gate on it. */
export const health = async (
	env: CloudEnv,
	surface: "ledger" | "api",
): Promise<Response> => {
	const [d1, books, backups] = await Promise.all([
		probe("d1", () => env.DB.prepare("SELECT 1 AS one").first()),
		probe("books", () => env.BOOKS.list({ limit: 1 })),
		probe("backups", () => env.BACKUPS.list({ limit: 1 })),
	]);
	const ok = d1 && books && backups;
	return Response.json(
		{
			ok,
			service: "trifold-cloud",
			surface,
			environment: env.ENVIRONMENT,
			checks: { d1, books, backups },
		},
		{ status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } },
	);
};
