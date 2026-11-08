import type { CloudEnv } from "./env";
import { loadSigningKeys } from "./signing";

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

/** `/healthz`: proves D1, both R2 buckets and the three signing keys answer. 503 when one fails, so a deploy check can gate on it. */
/** Healthz is public: one probe round per 15 seconds per isolate, so hammering it costs nothing extra. */
const CACHE_MS = 15_000;
let cached: { at: number; checks: Record<string, boolean> } | undefined;

/** Tests reset the cache between cases. */
export const resetHealthCache = (): void => {
	cached = undefined;
};

export const health = async (
	env: CloudEnv,
	surface: "ledger" | "api",
): Promise<Response> => {
	const now = Date.now();
	if (!cached || now - cached.at > CACHE_MS) {
		const [d1, books, backups, signing] = await Promise.all([
			probe("d1", () => env.DB.prepare("SELECT 1 AS one").first()),
			probe("books", () => env.BOOKS.list({ limit: 1 })),
			probe("backups", () => env.BACKUPS.list({ limit: 1 })),
			probe("signing", () => loadSigningKeys(env)),
		]);
		cached = { at: now, checks: { d1, books, backups, signing } };
	}
	const { checks } = cached;
	const ok = Object.values(checks).every(Boolean);
	return Response.json(
		{
			ok,
			service: "trifold-cloud",
			surface,
			environment: env.ENVIRONMENT,
			checks,
		},
		{ status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } },
	);
};
