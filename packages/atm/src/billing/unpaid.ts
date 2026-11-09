/**
 * The lapse of a cycle that ended unpaid (D12 decision 4), as the family service's lapse job calls it: the rows and the
 * events of `unpaidCycleToCommands` as one write for the member, like `adjustCredits`. The job calls this for each member
 * past its cycle end, then `recordLapse` for each feature, in the transaction that reads the member's rows.
 *
 * A renewal paid afterwards is the handler's (`invoiceToCommands`): before the lapse date it takes the dating back; after
 * it, the lapsed credits stay lapsed and the renewal grants the cycle's allowance.
 */

import { runOnState, toCatalog } from "../ledger/run.js";
import type {
	AtmEvent,
	AtmIdentity,
	LapseUnpaidCycleInput,
	LapseUnpaidCycleResult,
} from "../types.js";
import { resolveEnv } from "./env.js";
import { unpaidCycleToCommands } from "./grants.js";
import { eventsOf, planChangedOf } from "./handle.js";
import {
	diffRows,
	GRANTS_TABLE,
	grantsFromRows,
	rowsFromState,
	stateFromRows,
	subjectFromRows,
	subjectKey,
} from "./rows.js";

const NOTHING_DATED = (
	skipped: LapseUnpaidCycleResult["skipped"],
): LapseUnpaidCycleResult => ({
	rowChanges: null,
	events: [],
	dated: [],
	skipped,
	replayed: skipped === "already_dated",
});

/**
 * Dates the expiry of the credit rows the unpaid cycle refilled (`unpaidCycleToCommands`) and returns one write for the
 * member (the engine's rows only: the grants row does not change, the dated rows are the record) plus one `credit.expiration_changed` per dated row. Nothing to write (`rowChanges` null) and `skipped` saying why
 * when the policy's `rulesVersion` is below 3, the member has no running paid cycle ending at `cycleEnd`, the cycle has not
 * ended at `now`, no refilling row holds credits, or the cycle was dated already (`replayed`). The command is
 * `unpaid:<customer id>:<cycleEnd>:1`, so the same cycle is one event in the outbox however often the job runs.
 */
export const lapseUnpaidCycle = (
	input: LapseUnpaidCycleInput,
): LapseUnpaidCycleResult => {
	const env = resolveEnv(input.env);
	const grants = grantsFromRows(input.rows);
	const who = grants.identity ?? grants.holder ?? input.holder;
	const identity: AtmIdentity = {
		orgId: who.orgId,
		env,
		customerId: who.customerId,
		entityId: null,
	};
	const engineRows = input.rows.filter((row) => row.table !== GRANTS_TABLE);
	if (engineRows.length === 0) return NOTHING_DATED("no_subscription");
	const subject = subjectFromRows({
		identity,
		revision: input.revision,
		rows: input.rows,
		catalog: input.catalog,
	});
	const result = unpaidCycleToCommands({
		cycleEnd: input.cycleEnd,
		menu: input.menu,
		policy: input.policy,
		state: grants,
		subject,
		now: input.now,
		menuVersion: input.menuVersion,
		policyVersion: input.policyVersion,
		env,
	});
	if (result.skipped !== null) return NOTHING_DATED(result.skipped);

	const catalog = toCatalog(input.catalog);
	let state = stateFromRows({
		identity,
		revision: input.revision,
		rows: input.rows,
	});
	if (state === null) return NOTHING_DATED("no_subscription");
	const events: AtmEvent[] = [];
	let nextRevision = input.revision;
	for (const command of result.commands) {
		const run = runOnState({ state, catalog, command });
		const status = (run.mutation?.result as { status?: string } | undefined)
			?.status;
		if (!run.mutation || status === "rejected")
			throw new Error(
				`the engine rejected ${command.type} ${command.commandId}`,
			);
		const credits = eventsOf({
			mutation: run.mutation,
			before: state,
			catalog,
			input: { menu: input.menu, menuVersion: input.menuVersion },
			grants: result.state,
			labels: result.labels,
			reason: "unpaid cycle",
		});
		events.push(
			...(credits.length > 0
				? credits
				: [
						planChangedOf({
							mutation: run.mutation,
							input: { menu: input.menu, menuVersion: input.menuVersion },
							labels: result.labels,
						}),
					]),
		);
		state = run.state;
		nextRevision = run.mutation.revision.after;
	}
	if (state === null)
		throw new Error("the engine left the member without rows");
	const { upserts, deletes } = diffRows(engineRows, rowsFromState(state));
	return {
		rowChanges: {
			subjectKey: subjectKey(identity),
			expectedRevision: input.revision,
			nextRevision,
			upserts,
			deletes,
		},
		events,
		dated: result.dated,
		skipped: null,
		replayed: false,
	};
};
