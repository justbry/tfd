import { runCron } from "./cron";
import type { CloudEnv } from "./env";
import { withSecurityHeaders } from "./headers";
import { route, type WaitUntil } from "./router";

export { NoteDO } from "./notes/note-do";
export { OrgDO } from "./org-do";

export default {
	async fetch(
		request: Request,
		env: CloudEnv,
		context?: WaitUntil,
	): Promise<Response> {
		return withSecurityHeaders(await route(request, env, context));
	},

	/** Hourly: back up the books, then prune superseded copies (`cron.ts`). */
	async scheduled(_controller: unknown, env: CloudEnv): Promise<void> {
		await runCron(env, new Date());
	},
};
