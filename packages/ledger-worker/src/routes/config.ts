/**
 * The school's config objects (S9 plan sections 3 and 4): read with an ETag, verify (writes nothing) and put (a verified
 * value, a fresh step-up, a matching ETag). Order of checks: the gate (owner, finance, step-up), the body, the value
 * (422), the hash (422), the ETag (412), then the writes: object, audit line, manifest.
 */
import { readViewsFromStore } from "tfd/worker";
import type { SchoolGrant } from "../auth/claims.js";
import { bytesOf, canonicalJson, sha256Hex } from "../config/canonical.js";
import { definitions } from "../config/definitions.js";
import { diffOf } from "../config/diff.js";
import {
	appendAudit,
	configKey,
	expectationOf,
	putConditionally,
	readStored,
	type StoredConfig,
	updateManifest,
} from "../config/store.js";
import { CONFIG_NAMES, type ConfigName } from "../config/types.js";
import type { Store } from "../data/store-io.js";
import { ApiError, lagMinutesOf, okResponse } from "../http.js";

/** The step-up window: a write needs a PIN check no older than this (D22). */
export const STEP_UP_WINDOW_SECONDS = 600;
const MS_PER_SECOND = 1000;
const STEP_UP_LEEWAY_SECONDS = 5;
/** The largest config request body read. */
export const MAX_BODY_BYTES = 262_144;
const OPAQUE_WRITER_LENGTH = 16;
const SHA256_HEX = /^[0-9a-f]{64}$/;
const QUOTED_HASH = /^"?([0-9a-f]{64})"?$/;

export type ConfigAction = "read" | "verify" | "put";

export type ConfigContext = {
	store: Store;
	school: string;
	name: string;
	grant: SchoolGrant;
	subject: string | null;
	stepUpAt: number | null;
	now: number;
	request: Request;
};

export const isConfigName = (name: string): name is ConfigName =>
	(CONFIG_NAMES as readonly string[]).includes(name);

/** `manifest` is served but never written through the routes: the Worker keeps it. */
const readableName = (name: string): ConfigName | "manifest" => {
	if (name === "manifest" || isConfigName(name)) return name;
	throw new ApiError("not_found", "No such config object.");
};

const etagOf = (sha256: string): string => `"${sha256}"`;

const freshnessOf = async (
	store: Store,
	school: string,
	now: number,
): Promise<{ asOf: string | null; lagMinutes: number | null }> => {
	const reader = await readViewsFromStore(store, school);
	if (!reader.ok) return { asOf: null, lagMinutes: null };
	const { asOf } = reader.manifest;
	return { asOf, lagMinutes: lagMinutesOf(asOf, now) };
};

const requireFinance = (name: ConfigName, grant: SchoolGrant): void => {
	if (definitions[name].moneyBearing && !grant.finance)
		throw new ApiError(
			"finance_required",
			"This needs the finance grant on the school.",
		);
};

const requireOwner = (grant: SchoolGrant): void => {
	if (grant.role !== "owner")
		throw new ApiError(
			"owner_only",
			"Only the school's owner can change this.",
		);
};

const requireStepUp = (stepUpAt: number | null, now: number): void => {
	const seconds = Math.floor(now / MS_PER_SECOND);
	if (
		stepUpAt === null ||
		stepUpAt > seconds + STEP_UP_LEEWAY_SECONDS ||
		seconds - stepUpAt > STEP_UP_WINDOW_SECONDS
	)
		throw new ApiError(
			"step_up_required",
			"Confirm it is you with your PIN, then save again.",
		);
};

/** The writer as the audit and the manifest name it: a hash of the school and `sub`, never the profile id. */
const opaqueWriter = async (school: string, subject: string): Promise<string> =>
	`u_${(await sha256Hex(bytesOf(`${school}:${subject}`))).slice(0, OPAQUE_WRITER_LENGTH)}`;

const bodyOf = async (request: Request): Promise<Record<string, unknown>> => {
	const text = await request.text();
	if (text.length > MAX_BODY_BYTES)
		throw new ApiError("bad_request", "The body is too large.");
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		throw new ApiError("bad_request", "The body is not JSON.");
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
		throw new ApiError("bad_request", "The body must be a JSON object.");
	return parsed as Record<string, unknown>;
};

const submittedValue = (body: Record<string, unknown>): unknown => {
	if (!Object.hasOwn(body, "value"))
		throw new ApiError("bad_request", "The body needs a value.", {
			field: "value",
		});
	return body.value;
};

const parsedOf = (stored: StoredConfig | null): unknown => {
	if (stored === null) return null;
	try {
		return JSON.parse(stored.text);
	} catch {
		throw new ApiError(
			"views_unavailable",
			"The stored config cannot be read right now.",
		);
	}
};

export const readConfigRoute = async (
	context: ConfigContext,
): Promise<Response> => {
	const name = readableName(context.name);
	if (name !== "manifest") requireFinance(name, context.grant);
	const stored = await readStored(
		context.store,
		configKey(context.school, name),
	);
	if (stored === null)
		throw new ApiError("not_found", `This school has no ${name} config yet.`);
	return okResponse(
		parsedOf(stored),
		await freshnessOf(context.store, context.school, context.now),
		{ etag: etagOf(stored.sha256) },
	);
};

const writableName = (context: ConfigContext): ConfigName => {
	if (context.name === "manifest")
		throw new ApiError(
			"method_not_allowed",
			"The manifest is kept by the Worker.",
		);
	return readableName(context.name) as ConfigName;
};

export const verifyConfigRoute = async (
	context: ConfigContext,
): Promise<Response> => {
	const name = writableName(context);
	requireOwner(context.grant);
	requireFinance(name, context.grant);
	const value = submittedValue(await bodyOf(context.request));
	const problems = definitions[name].validate(value, context.school);
	const stored = await readStored(
		context.store,
		configKey(context.school, name),
	);
	const ok = problems.length === 0;
	return okResponse(
		{
			ok,
			problems,
			diff: ok ? diffOf(parsedOf(stored), value) : [],
			verifiedHash: ok ? await sha256Hex(bytesOf(canonicalJson(value))) : null,
			baseEtag: stored === null ? null : stored.sha256,
		},
		await freshnessOf(context.store, context.school, context.now),
	);
};

type Precondition = { kind: "absent" } | { kind: "match"; sha256: string };

const preconditionOf = (request: Request): Precondition => {
	const match = request.headers.get("if-match");
	const none = request.headers.get("if-none-match");
	if (match !== null) {
		const sha256 = QUOTED_HASH.exec(match.trim())?.[1];
		if (sha256 === undefined)
			throw new ApiError("bad_request", "If-Match must be the ETag you read.", {
				field: "if-match",
			});
		return { kind: "match", sha256 };
	}
	if (none?.trim() === "*") return { kind: "absent" };
	throw new ApiError(
		"bad_request",
		"Send If-Match with the ETag you read (If-None-Match: * for a new object).",
		{ field: "if-match" },
	);
};

const stale = (): ApiError =>
	new ApiError(
		"stale_etag",
		"Someone changed this since you read it. Review their change, then save again.",
	);

export const putConfigRoute = async (
	context: ConfigContext,
): Promise<Response> => {
	const name = writableName(context);
	requireOwner(context.grant);
	requireFinance(name, context.grant);
	requireStepUp(context.stepUpAt, context.now);
	if (context.subject === null)
		throw new ApiError("token_invalid", "The token has no subject.");
	const precondition = preconditionOf(context.request);
	const body = await bodyOf(context.request);
	const value = submittedValue(body);
	const problems = definitions[name].validate(value, context.school);
	if (problems.length > 0)
		throw new ApiError("invalid_config", "The value has problems.", {
			problems,
		});
	const text = canonicalJson(value);
	const sha256 = await sha256Hex(bytesOf(text));
	if (
		typeof body.verifiedHash !== "string" ||
		!SHA256_HEX.test(body.verifiedHash)
	)
		throw new ApiError("bad_request", "The body needs the verifiedHash.", {
			field: "verifiedHash",
		});
	if (body.verifiedHash !== sha256)
		throw new ApiError("invalid_config", "The value is not the one verified.", {
			problems: [
				{
					path: "verifiedHash",
					message: "is not the hash of this value",
					hint: "Verify the value again, then save what was verified.",
				},
			],
		});

	const key = configKey(context.school, name);
	const current = await readStored(context.store, key);
	if (
		precondition.kind === "absent"
			? current !== null
			: current?.sha256 !== precondition.sha256
	)
		throw stale();
	if (current?.sha256 === sha256)
		return okResponse(
			{ name, sha256, bytes: current.bytes, changed: false },
			await freshnessOf(context.store, context.school, context.now),
			{ etag: etagOf(sha256) },
		);
	if (
		!(await putConditionally(context.store, key, text, expectationOf(current)))
	)
		throw stale();

	const at = new Date(context.now).toISOString();
	const by = await opaqueWriter(context.school, context.subject);
	await appendAudit(context.store, context.school, {
		at,
		by,
		name,
		before: current?.sha256 ?? null,
		after: sha256,
	});
	await updateManifest(context.store, context.school, {
		now: at,
		by,
		changed: name,
	});
	return okResponse(
		{ name, sha256, bytes: bytesOf(text).length, changed: true },
		await freshnessOf(context.store, context.school, context.now),
		{ etag: etagOf(sha256) },
	);
};
