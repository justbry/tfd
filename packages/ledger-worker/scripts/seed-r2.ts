/**
 * Lands the ledger UI's fixtures in the staging bucket as each school's config objects, idempotently (a second run reports
 * `written:0` and changes no byte). Usage, from the repo root:
 *
 *   set -a; . ~/.config/b4uni/r2-stg-ledger-s3.env; set +a
 *   bun run --cwd packages/ledger-worker seed:r2 [--env staging] [--school <id>] [--dry-run]
 *
 * The credentials are the four `R2_LEDGER_*` variables of that file, read from the environment; they are never printed,
 * logged or kept. Only the staging bucket, by its name, is allowed: any other bucket, and any environment but `staging`,
 * is refused here, in code. The first real run is the owner's go.
 */
import { R2Store, type Store } from "tfd";
import {
	fixtureSchoolIds,
	type SeedReport,
	seedSchoolFixtures,
} from "../src/testing/seed-config.js";

/** The only bucket this script writes to. */
export const STAGING_BUCKET = "b4uni-stg-ledger";
const ENDPOINT_SUFFIX = ".r2.cloudflarestorage.com";
const EXIT_FAILED = 1;
const EXIT_USAGE = 2;

export class UsageError extends Error {}

export type SeedArgs = {
	schools: string[];
	dryRun: boolean;
	overwrite: boolean;
};

export const USAGE =
	"usage: seed:r2 [--env staging] [--school <id>]... [--dry-run] [--overwrite]";

export const parseSeedArgs = (argv: readonly string[]): SeedArgs => {
	const schools: string[] = [];
	let dryRun = false;
	let overwrite = false;
	for (let index = 0; index < argv.length; index += 1) {
		const flag = argv[index];
		if (flag === "--dry-run") dryRun = true;
		else if (flag === "--overwrite") overwrite = true;
		else if (flag === "--env") {
			index += 1;
			const environment = argv[index];
			if (environment !== "staging")
				throw new UsageError(
					`--env ${environment ?? "(missing)"} is refused: this script seeds staging only`,
				);
		} else if (flag === "--school") {
			index += 1;
			const school = argv[index];
			if (school === undefined || school.startsWith("--"))
				throw new UsageError("--school needs a school id");
			if (!fixtureSchoolIds().includes(school))
				throw new UsageError(
					`--school ${school}: the fixtures describe ${fixtureSchoolIds().join(", ")}`,
				);
			schools.push(school);
		} else throw new UsageError(`unknown argument ${flag ?? ""}`);
	}
	return {
		schools: schools.length === 0 ? fixtureSchoolIds() : schools,
		dryRun,
		overwrite,
	};
};

export type BucketConnection = {
	endpoint: string;
	bucket: string;
	accessKeyId: string;
	secretAccessKey: string;
};

/** The staging bucket's connection from the environment; refuses any other bucket and any host that is not R2. */
export const connectionOf = (
	env: Readonly<Record<string, string | undefined>>,
): BucketConnection => {
	const names = [
		"R2_LEDGER_ENDPOINT",
		"R2_LEDGER_BUCKET",
		"R2_LEDGER_ACCESS_KEY_ID",
		"R2_LEDGER_SECRET_ACCESS_KEY",
	] as const;
	const missing = names.filter((name) => !env[name]);
	if (missing.length > 0)
		throw new UsageError(
			`not set: ${missing.join(", ")} (source ~/.config/b4uni/r2-stg-ledger-s3.env)`,
		);
	const [endpoint, bucket, accessKeyId, secretAccessKey] = names.map(
		(name) => env[name] as string,
	) as [string, string, string, string];
	if (bucket !== STAGING_BUCKET)
		throw new UsageError(
			`R2_LEDGER_BUCKET is refused: only ${STAGING_BUCKET} may be seeded`,
		);
	let host: string;
	try {
		const url = new URL(endpoint);
		if (url.protocol !== "https:") throw new Error("not https");
		host = url.hostname;
	} catch {
		throw new UsageError("R2_LEDGER_ENDPOINT must be an https URL");
	}
	if (!host.endsWith(ENDPOINT_SUFFIX))
		throw new UsageError(
			`R2_LEDGER_ENDPOINT must be a host under ${ENDPOINT_SUFFIX}`,
		);
	return { endpoint, bucket, accessKeyId, secretAccessKey };
};

export type SeedCommand = {
	argv: readonly string[];
	env: Readonly<Record<string, string | undefined>>;
	now: () => Date;
	write: (text: string) => void;
	/** The store for a checked connection; a test hands back a Miniflare bucket. */
	storeFor: (connection: BucketConnection) => Store;
};

export const reportLines = (report: SeedReport, dryRun: boolean): string[] => [
	...report.objects.map(
		(entry) => `${entry.action.padEnd(11)} ${entry.school}/${entry.name}`,
	),
	dryRun
		? `dry run: would-write:${report.wouldWrite} unchanged:${report.unchanged} kept:${report.kept}`
		: `written:${report.written} unchanged:${report.unchanged} kept:${report.kept}`,
];

/** Runs the command and answers its exit code. Nothing it prints holds a credential. */
export const runSeed = async (command: SeedCommand): Promise<number> => {
	try {
		const args = parseSeedArgs(command.argv);
		const connection = connectionOf(command.env);
		command.write(
			`seed:r2 ${connection.bucket}${args.dryRun ? " (dry run)" : ""}\n`,
		);
		const report = await seedSchoolFixtures(command.storeFor(connection), {
			schools: args.schools,
			now: command.now(),
			dryRun: args.dryRun,
			overwrite: args.overwrite,
		});
		for (const line of reportLines(report, args.dryRun))
			command.write(`${line}\n`);
		return 0;
	} catch (error) {
		if (error instanceof UsageError) {
			command.write(`${error.message}\n${USAGE}\n`);
			return EXIT_USAGE;
		}
		// the error's name only: nothing about the connection is worth the risk of a credential in a log
		command.write(
			`seed:r2 failed: ${error instanceof Error ? error.name : "unknown"}\n`,
		);
		return EXIT_FAILED;
	}
};

if (import.meta.main)
	process.exit(
		await runSeed({
			argv: process.argv.slice(2),
			env: process.env,
			now: () => new Date(),
			write: (text) => process.stdout.write(text),
			storeFor: (connection) => new R2Store(connection),
		}),
	);
