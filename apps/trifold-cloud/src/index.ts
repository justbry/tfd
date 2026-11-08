import { backupBucket } from "./backup";
import type { CloudEnv } from "./env";
import { withSecurityHeaders } from "./headers";
import { route } from "./router";

export { OrgDO } from "./org-do";

type ExecutionContext = { waitUntil(promise: Promise<unknown>): void };

export default {
	async fetch(request: Request, env: CloudEnv): Promise<Response> {
		return withSecurityHeaders(await route(request, env));
	},

	/** Nightly: copy the books bucket into the locked backup bucket. */
	async scheduled(
		_controller: unknown,
		env: CloudEnv,
		ctx: ExecutionContext,
	): Promise<void> {
		ctx.waitUntil(
			backupBucket(env.BOOKS, env.BACKUPS).then((result) => {
				console.log(
					`backup: ${result.copied} copied, ${result.unchanged} unchanged`,
				);
			}),
		);
	},
};
