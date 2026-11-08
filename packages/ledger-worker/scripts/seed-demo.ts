/**
 * Seeds the demo schools in the staging bucket (`src/demo.ts`, owner decision 2026-11-08): each of atm's fifteen school
 * presets as `schools/demo-<preset>/`, its events in the shipper's batch files and its display facts, then its views as
 * of now. A rerun replaces the demo prefixes and touches nothing else; no other school's prefix is listed, read or
 * written. Usage, from the repo root:
 *
 *   set -a; . ~/.config/b4uni/r2-stg-ledger-s3.env; set +a
 *   bun run --cwd packages/ledger-worker seed:demo [--preset <name>]... [--no-views]
 *
 * The credentials are the four `R2_LEDGER_*` variables, read from the environment and never printed. Staging only: a
 * bucket whose name holds `prod` is refused, and so is any bucket but `b4uni-stg-ledger` (`connectionOf`).
 */
import { R2Store, type Store } from "tfd";
import {
	DEMO_PRESETS,
	type DemoSeedReport,
	seedDemoSchool,
} from "../src/testing/demo-seed.js";
import { type BucketConnection, connectionOf, UsageError } from "./seed-r2.js";

const EXIT_FAILED = 1;
const EXIT_USAGE = 2;
const PRODUCTION = /prod/i;

export const DEMO_USAGE = "usage: seed:demo [--preset <name>]... [--no-views]";

export type DemoSeedArgs = { presets: string[]; views: boolean };

export const parseDemoSeedArgs = (argv: readonly string[]): DemoSeedArgs => {
	const presets: string[] = [];
	let views = true;
	for (let index = 0; index < argv.length; index += 1) {
		const flag = argv[index];
		if (flag === "--no-views") views = false;
		else if (flag === "--preset") {
			index += 1;
			const preset = argv[index];
			if (preset === undefined || preset.startsWith("--"))
				throw new UsageError("--preset needs a preset name");
			if (!(DEMO_PRESETS as readonly string[]).includes(preset))
				throw new UsageError(
					`--preset ${preset}: the demo schools are ${DEMO_PRESETS.join(", ")}`,
				);
			presets.push(preset);
		} else throw new UsageError(`unknown argument ${flag ?? ""}`);
	}
	return { presets: presets.length === 0 ? [...DEMO_PRESETS] : presets, views };
};

export type DemoSeedCommand = {
	argv: readonly string[];
	env: Readonly<Record<string, string | undefined>>;
	now: () => Date;
	write: (text: string) => void;
	storeFor: (connection: BucketConnection) => Store;
};

export const demoReportLine = (report: DemoSeedReport): string =>
	`${report.school.padEnd(28)} written:${report.written} unchanged:${report.unchanged} removed:${report.removed} views:${report.viewsAsOf ?? "not built"}`;

/** Runs the command and answers its exit code. Nothing it prints holds a credential. */
export const runDemoSeed = async (
	command: DemoSeedCommand,
): Promise<number> => {
	try {
		const args = parseDemoSeedArgs(command.argv);
		if (PRODUCTION.test(command.env.R2_LEDGER_BUCKET ?? ""))
			throw new UsageError(
				"R2_LEDGER_BUCKET is refused: demo schools are staging only",
			);
		const connection = connectionOf(command.env);
		const store = command.storeFor(connection);
		command.write(`seed:demo ${connection.bucket}\n`);
		for (const preset of args.presets)
			command.write(
				`${demoReportLine(
					await seedDemoSchool(store, preset, {
						now: command.now(),
						views: args.views,
					}),
				)}\n`,
			);
		return 0;
	} catch (error) {
		if (error instanceof UsageError) {
			command.write(`${error.message}\n${DEMO_USAGE}\n`);
			return EXIT_USAGE;
		}
		// the error's name only, but for this script's own errors (a preset that cannot be replayed): nothing about the
		// connection is worth the risk of a credential in a log
		const own = error instanceof Error && error.constructor === Error;
		command.write(
			`seed:demo failed: ${own ? error.message : error instanceof Error ? error.name : "unknown"}\n`,
		);
		return EXIT_FAILED;
	}
};

if (import.meta.main)
	process.exit(
		await runDemoSeed({
			argv: process.argv.slice(2),
			env: process.env,
			now: () => new Date(),
			write: (text) => process.stdout.write(text),
			storeFor: (connection) => new R2Store(connection),
		}),
	);
