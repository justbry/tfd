import type { CloudEnv } from "./env";

type Check = { ok: true } | { ok: false; error: string };

const errorMessage = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);

const check = async (probe: () => Promise<unknown>): Promise<Check> => {
	try {
		await probe();
		return { ok: true };
	} catch (error) {
		return { ok: false, error: errorMessage(error) };
	}
};

/** `/healthz`: proves the D1 and R2 bindings answer. 503 when either fails, so a deploy check can gate on it. */
export const health = async (
	env: CloudEnv,
	surface: "ledger" | "api",
): Promise<Response> => {
	const [d1, r2] = await Promise.all([
		check(() => env.DB.prepare("SELECT 1 AS one").first()),
		check(() => env.BOOKS.list({ limit: 1 })),
	]);
	const ok = d1.ok && r2.ok;
	return Response.json(
		{
			ok,
			service: "trifold-cloud",
			surface,
			environment: env.ENVIRONMENT,
			checks: { d1, r2 },
		},
		{ status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } },
	);
};
