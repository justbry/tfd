/** The Worker the harness runs: the deployed one, with a clock the harness controls (`TEST_CLOCK_URL` answers an ISO instant). */
import { createLedgerWorker } from "../worker.js";

export default createLedgerWorker({
	clock: async (env) => {
		if (env.TEST_CLOCK_URL === undefined) return Date.now();
		return Date.parse(await (await fetch(env.TEST_CLOCK_URL)).text());
	},
});
