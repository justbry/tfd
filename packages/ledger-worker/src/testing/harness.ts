/**
 * The ledger Worker on Miniflare over a seeded bucket, for another package's tests: `startLedgerWorker({ presets,
 * schools })` seeds each preset's events as a school, runs the views over them, starts the real Worker (the same code
 * Wrangler deploys, with a clock this harness controls) beside a test Ed25519 key pair and a JWKS endpoint, and hands
 * back the Worker's URL, a token minter and `stop()`. README.md, "Test harness".
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { AtmEvent } from "atm";
import type { R2BucketBinding } from "atm/worker";
import { Miniflare } from "miniflare";
import { LEDGER_AUDIENCE } from "../auth/jwt.js";
import { bundleTestWorker } from "./bundle.js";
import { type SeededSchool, seedEvents, seedSchool } from "./seed.js";
import {
	signToken,
	type TestJwk,
	type TestSigner,
	testSigner,
} from "./signer.js";

const COMPATIBILITY_DATE = "2026-07-01";
const BUCKET_BINDING = "LEDGER_BUCKET";
const HOST = "127.0.0.1";
const TEST_ISSUER = "https://api.ledger-test.example";
const DEFAULT_LIFETIME_SECONDS = 300;
const MS_PER_MINUTE = 60_000;
const MS_PER_SECOND = 1000;
const DEFAULT_KEY_FILL = 1;

export type SchoolGrantInput = {
	id: string;
	role: "owner" | "admin" | string;
	finance: boolean;
};

export type MintOptions = {
	/** The profile id the family service puts in `sub`. The Worker never keeps it. */
	sub: string;
	schools: SchoolGrantInput[];
	/** Seconds the token lives from the harness clock; default 300 (the most the Worker accepts). Negative: already expired. */
	expiresInSeconds?: number;
};

export type StartOptions = {
	/** Scenario presets to seed (`free-only`, `monthly-members`, `non-usd`, ...: the mart presets). */
	presets: readonly string[];
	/** The school id of each preset, in order; default: the preset's own name. */
	schools?: readonly string[];
	/** The Worker's clock to start with (ISO instant); default one minute after the latest seeded `asOf`. */
	now?: string;
};

export type LedgerHarness = {
	/** The Worker's origin, no trailing slash: `${url}/v1/schools`. */
	url: string;
	/** A ledger token as the family service mints it: `iss`, `aud` `atm-ledger`, `iat`, `exp`, `schools`. */
	mintToken(options: MintOptions): Promise<string>;
	stop(): Promise<void>;
	/** The seeded schools by id. */
	seeded: Record<string, SeededSchool>;
	/** The token issuer the Worker is configured with. */
	issuer: string;
	/** A token with exactly these claims (and header fields), signed by the harness key: for the failure cases. */
	signRaw(
		claims: Record<string, unknown>,
		header?: Record<string, unknown>,
	): Promise<string>;
	/** The Worker's clock. */
	clock: {
		now(): string;
		set(iso: string): void;
		advance(milliseconds: number): void;
	};
	/** The JWKS endpoint: how many times the Worker fetched it, and the keys it serves (replace to rotate). */
	jwks: {
		fetches(): number;
		setKeys(keys: readonly TestJwk[]): void;
		keys(): readonly TestJwk[];
	};
	/** A second signer (another key) to mint tokens the JWKS does not list until `jwks.setKeys` adds it. */
	extraSigner(fill: number): Promise<TestSigner>;
	/** The signer behind `mintToken`. */
	signer: TestSigner;
	/** The Worker's bucket binding, to change what it reads. */
	bucket: R2BucketBinding;
	/**
	 * Adds a school with these events (`views: false` leaves the views to the cron job; a log that cannot be replayed
	 * throws unless it is false).
	 */
	seedEvents(
		schoolId: string,
		events: readonly AtmEvent[],
		options?: { views?: boolean },
	): Promise<SeededSchool>;
	/** Runs the Worker's cron handler once, as the trigger does; resolves when it is done. */
	runCron(): Promise<void>;
};

const listen = (server: Server): Promise<number> =>
	new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, HOST, () =>
			resolve((server.address() as AddressInfo).port),
		);
	});

export const startLedgerWorker = async (
	options: StartOptions,
): Promise<LedgerHarness> => {
	const ids = options.schools ?? options.presets;
	if (ids.length !== options.presets.length)
		throw new Error("schools must name one id for each preset");
	if (new Set(ids).size !== ids.length)
		throw new Error("two presets would be seeded as one school id");

	const signer = await testSigner(DEFAULT_KEY_FILL);
	let keys: readonly TestJwk[] = [signer.jwk];
	let jwksFetches = 0;
	let now = Date.now();

	const server = createServer((request, response) => {
		if (request.url === "/jwks.json") {
			jwksFetches += 1;
			response.writeHead(200, {
				"content-type": "application/json",
				"cache-control": "max-age=300",
			});
			response.end(JSON.stringify({ keys }));
			return;
		}
		if (request.url === "/clock") {
			response.writeHead(200, { "content-type": "text/plain" });
			response.end(new Date(now).toISOString());
			return;
		}
		response.writeHead(404).end();
	});
	const port = await listen(server);
	const origin = `http://${HOST}:${port}`;

	const miniflare = new Miniflare({
		modules: [
			{
				type: "ESModule",
				path: "worker.js",
				contents: await bundleTestWorker(),
			},
		],
		compatibilityDate: COMPATIBILITY_DATE,
		compatibilityFlags: ["nodejs_compat"],
		// IPv4 explicitly: "localhost" has intermittently failed to connect while Miniflare started
		host: HOST,
		r2Buckets: [BUCKET_BINDING],
		bindings: {
			LEDGER_ISS: TEST_ISSUER,
			LEDGER_JWKS_URL: `${origin}/jwks.json`,
			TEST_CLOCK_URL: `${origin}/clock`,
		},
	});
	try {
		const bucket = (await miniflare.getR2Bucket(
			BUCKET_BINDING,
		)) as unknown as R2BucketBinding;
		const seeded: Record<string, SeededSchool> = {};
		for (const [index, preset] of options.presets.entries()) {
			const id = ids[index] as string;
			seeded[id] = await seedSchool(bucket, preset, id);
		}
		const latest = Object.values(seeded)
			.map((school) => Date.parse(school.asOf))
			.reduce((a, b) => Math.max(a, b), Number.NEGATIVE_INFINITY);
		now =
			options.now !== undefined
				? Date.parse(options.now)
				: Number.isFinite(latest)
					? latest + MS_PER_MINUTE
					: Date.now();
		const base = (await miniflare.ready).toString().replace(/\/$/, "");

		return {
			url: base,
			issuer: TEST_ISSUER,
			seeded,
			signer,
			bucket,
			async mintToken({ sub, schools, expiresInSeconds }) {
				const issuedAt = Math.floor(now / MS_PER_SECOND);
				return signToken(signer, {
					iss: TEST_ISSUER,
					aud: LEDGER_AUDIENCE,
					sub,
					iat: issuedAt,
					nbf: issuedAt,
					exp: issuedAt + (expiresInSeconds ?? DEFAULT_LIFETIME_SECONDS),
					schools,
				});
			},
			signRaw: (claims, header) => signToken(signer, claims, header),
			extraSigner: testSigner,
			clock: {
				now: () => new Date(now).toISOString(),
				set: (iso) => {
					now = Date.parse(iso);
				},
				advance: (milliseconds) => {
					now += milliseconds;
				},
			},
			jwks: {
				fetches: () => jwksFetches,
				setKeys: (next) => {
					keys = next;
				},
				keys: () => keys,
			},
			async seedEvents(schoolId, events, seedOptions) {
				const school = await seedEvents(bucket, schoolId, events, seedOptions);
				seeded[schoolId] = school;
				return school;
			},
			async runCron() {
				const worker = (await miniflare.getWorker()) as unknown as {
					scheduled(options: { scheduledTime: Date }): Promise<unknown>;
				};
				await worker.scheduled({ scheduledTime: new Date(now) });
			},
			async stop() {
				await miniflare.dispose();
				await new Promise<void>((resolve) => server.close(() => resolve()));
			},
		};
	} catch (error) {
		await miniflare.dispose().catch(() => undefined);
		server.close();
		throw error;
	}
};
