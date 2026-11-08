import { DEFAULT_SUBREQUEST_BUDGET, runBackup } from "./backup";
import type { CloudEnv } from "./env";
import { withSecurityHeaders } from "./headers";
import { route } from "./router";

export { OrgDO } from "./org-do";

export default {
	async fetch(request: Request, env: CloudEnv): Promise<Response> {
		return withSecurityHeaders(await route(request, env));
	},

	/** Hourly: one run of the books backup (`backup.ts`). Awaited, so a failure fails the cron invocation. */
	async scheduled(_controller: unknown, env: CloudEnv): Promise<void> {
		const result = await runBackup(
			{ db: env.DB, source: env.BOOKS, backup: env.BACKUPS },
			new Date(),
			console,
			Number(env.BACKUP_SUBREQUEST_BUDGET ?? DEFAULT_SUBREQUEST_BUDGET),
		);
		if (result.failed > 0)
			throw new Error(`backup: ${result.failed} objects failed`);
	},
};
