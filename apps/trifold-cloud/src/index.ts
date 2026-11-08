import { runBackup } from "./backup";
import type { CloudEnv } from "./env";
import { withSecurityHeaders } from "./headers";
import { route } from "./router";

export { OrgDO } from "./org-do";

export default {
	async fetch(request: Request, env: CloudEnv): Promise<Response> {
		return withSecurityHeaders(await route(request, env));
	},

	/** Nightly: one run of the books backup (`backup.ts`). Awaited, so a failure fails the cron invocation. */
	async scheduled(_controller: unknown, env: CloudEnv): Promise<void> {
		const result = await runBackup(
			{ db: env.DB, source: env.BOOKS, backup: env.BACKUPS },
			new Date(),
		);
		if (result.failed > 0)
			throw new Error(`backup: ${result.failed} objects failed`);
	},
};
