import { runCron } from "./cron";
import type { CloudEnv } from "./env";
import { withSecurityHeaders } from "./headers";
import { route } from "./router";

export { OrgDO } from "./org-do";

export default {
	async fetch(request: Request, env: CloudEnv): Promise<Response> {
		return withSecurityHeaders(await route(request, env));
	},

	/** Hourly: back up the books, then prune superseded copies (`cron.ts`). */
	async scheduled(_controller: unknown, env: CloudEnv): Promise<void> {
		await runCron(env, new Date());
	},
};
