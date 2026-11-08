import { DEFAULT_SUBREQUEST_BUDGET, runBackup } from "./backup";
import type { CloudEnv } from "./env";
import { pruneSuperseded, readPruneState, writePruneState } from "./prune";

/**
 * The hourly cron: back up first; once a backup pass is complete, give what is left of the budget to pruning
 * superseded copies. Throws when anything failed, so the invocation shows as an error in Workers observability.
 */
export const runCron = async (
	env: CloudEnv,
	now: Date,
	log: Pick<Console, "log" | "error"> = console,
) => {
	const configured = Number(
		env.BACKUP_SUBREQUEST_BUDGET ?? DEFAULT_SUBREQUEST_BUDGET,
	);
	if (!Number.isFinite(configured))
		throw new Error("BACKUP_SUBREQUEST_BUDGET is not a number");
	const budget = configured;
	const backup = await runBackup(
		{ db: env.DB, source: env.BOOKS, backup: env.BACKUPS },
		now,
		log,
		budget,
	);
	let pruneFailed = 0;
	if (backup.complete) {
		const prune = await pruneSuperseded({
			db: env.DB,
			source: env.BOOKS,
			backup: env.BACKUPS,
			state: await readPruneState(env.DB),
			now,
			budget: budget - backup.used,
			log,
		});
		await writePruneState(env.DB, prune.state);
		pruneFailed = prune.failed;
		log.log(
			`prune: ${prune.deleted} superseded copies deleted, ${prune.kept} kept, ${prune.failed} failed`,
		);
	}
	if (backup.failed + pruneFailed > 0) {
		throw new Error(
			`cron: ${backup.failed} backup and ${pruneFailed} prune failures`,
		);
	}
};
