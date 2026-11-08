import { Effect } from "effect";
import type { LedgerTokenSource } from "$contract/http/ledger-token.ts";
import type { Fetch } from "$contract/http/transport.ts";
import type { Problem } from "$worker-config/types.ts";
import {
	type ConfigApi,
	type ConfigName,
	type ConfigPut,
	type ConfigRead,
	type ConfigVerify,
} from "./config-client.ts";
import { liftConfig } from "./config-lift.ts";
import { UiError, type UiErrorKind } from "./ui-error.ts";

/** The ledger Worker's config routes (packages/ledger-worker/src/routes/config.ts) over `fetch`: the ledger token as
 * the bearer (a 401 takes a new token and tries once more), `ETag` and `If-Match` for the base copy, the Worker's
 * error envelope `{ error: { code, message, field?, retryAfterSeconds?, problems? } }` mapped to a `UiError` whose kind
 * and code the message table knows. The Worker's validators check what a read brings back (a lazy import), so a wire
 * shape the screen cannot take is `schema_mismatch`, never a value shown. */

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const retryableKinds: ReadonlySet<UiErrorKind> = new Set([
	"unavailable",
	"network",
	"rate_limited",
	"server",
]);

/** The status and code of a Worker refusal as the kind the UI contract knows (the same table as the Worker source's,
 * with the config codes: 412 `stale_etag` is a conflict, 422 `invalid_config` a bad request that carries
 * `problems[]`, 403 `step_up_required` the step-up). */
export const kindOfConfigError = (status: number, code: string): UiErrorKind => {
	if (status === 400 || status === 422) return "bad_request";
	if (status === 401) return "unauthenticated";
	if (status === 403) return code === "step_up_required" ? "step_up" : "forbidden";
	if (status === 404) return code === "no_data" ? "no_data" : "not_found";
	if (status === 405) return "bad_request";
	if (status === 409 || status === 412) return "conflict";
	if (status === 429) return "rate_limited";
	if (status === 501) return "not_available";
	if (status === 503) return "unavailable";
	return "server";
};

const problemsOf = (value: unknown): Problem[] | undefined => {
	if (!Array.isArray(value)) return undefined;
	const problems: Problem[] = [];
	for (const item of value)
		if (
			isRecord(item) &&
			typeof item.path === "string" &&
			typeof item.message === "string"
		)
			problems.push({
				path: item.path,
				message: item.message,
				hint: typeof item.hint === "string" ? item.hint : "",
			});
	return problems;
};

async function refusalOf(response: Response, path: string): Promise<UiError> {
	let body: unknown = null;
	try {
		body = await response.json();
	} catch {
		body = null;
	}
	const error = isRecord(body) && isRecord(body.error) ? body.error : {};
	const code =
		typeof error.code === "string" ? error.code : `http_${response.status}`;
	const message = typeof error.message === "string" ? error.message : code;
	const problems = problemsOf(error.problems);
	const kind = kindOfConfigError(response.status, code);
	return new UiError({
		kind,
		detail: {
			status: response.status,
			code,
			...(typeof error.field === "string" ? { field: error.field } : {}),
			...(typeof error.retryAfterSeconds === "number"
				? { retryAfterSeconds: error.retryAfterSeconds }
				: {}),
			...(problems ? { problems } : {}),
		},
		reason: `${response.status} ${code} on ${path}: ${message}`,
		retryable: retryableKinds.has(kind),
	});
}

const mismatch = (path: string, problem: string): UiError =>
	new UiError({
		kind: "schema_mismatch",
		detail: { code: "schema_mismatch" },
		reason: `${path}: ${problem}`,
		retryable: false,
	});

const quoted = (etag: string): string => `"${etag}"`;
const unquoted = (header: string): string => header.replace(/^W\//, "").replace(/^"|"$/g, "");

export function createHttpConfig(options: {
	fetch: Fetch;
	/** `/v1` on the UI's own origin, or a full URL in tests. */
	base: string;
	tokens: LedgerTokenSource;
}): ConfigApi {
	const urlOf = (school: string, name: ConfigName, suffix = ""): string =>
		`${options.base}/schools/${encodeURIComponent(school)}/config/${name}${suffix}`;

	/** One request with the bearer; a 401 takes a new token and tries once more. */
	const send = async (
		method: "GET" | "POST" | "PUT",
		url: string,
		path: string,
		extra: { body?: unknown; headers?: Record<string, string> } = {},
	): Promise<{ body: unknown; headers: Headers }> => {
		let refreshed = false;
		for (;;) {
			const token = refreshed
				? await options.tokens.refresh()
				: await options.tokens.current();
			if (!token)
				throw new UiError({
					kind: "not_found",
					detail: { code: "not_found" },
					reason: "no ledger token: the person administers no school",
					retryable: false,
				});
			let response: Response;
			try {
				response = await options.fetch(url, {
					method,
					headers: {
						accept: "application/json",
						authorization: `Bearer ${token.token}`,
						...(extra.body === undefined
							? {}
							: { "content-type": "application/json" }),
						...extra.headers,
					},
					...(extra.body === undefined
						? {}
						: { body: JSON.stringify(extra.body) }),
				});
			} catch (cause) {
				throw new UiError({
					kind: "network",
					detail: {},
					reason: `no answer from ${path}: ${String(cause)}`,
					retryable: true,
				});
			}
			if (response.ok) {
				let body: unknown;
				try {
					body = await response.json();
				} catch {
					throw mismatch(path, "answered no JSON");
				}
				return { body, headers: response.headers };
			}
			const error = await refusalOf(response, path);
			if (error.kind === "unauthenticated" && !refreshed) {
				refreshed = true;
				continue;
			}
			throw error;
		}
	};
	const dataOf = (path: string, body: unknown): Record<string, unknown> => {
		if (!isRecord(body) || !isRecord(body.data))
			throw mismatch(path, "answer has no data");
		return body.data;
	};

	const get: ConfigApi["get"] = (school, name) =>
		liftConfig(async () => {
			const path = `GET .../config/${name}`;
			const { body, headers } = await send("GET", urlOf(school, name), path);
			if (!isRecord(body) || !("data" in body))
				throw mismatch(path, "answer has no data");
			const etag = headers.get("etag");
			if (etag === null) throw mismatch(path, "answer has no ETag");
			const { definitions } = await import("$worker-config/definitions.ts");
			const problems = definitions[name].validate(body.data, school);
			if (problems.length > 0)
				throw mismatch(
					path,
					`the stored value has problems (${problems.map((problem) => problem.path).join(", ")})`,
				);
			return {
				value: body.data,
				etag: unquoted(etag),
				asOf: typeof body.asOf === "string" ? body.asOf : null,
				lagMinutes: typeof body.lagMinutes === "number" ? body.lagMinutes : null,
			} as ConfigRead<typeof name>;
		});

	const verify: ConfigApi["verify"] = (school, name, value) =>
		liftConfig(async (): Promise<ConfigVerify> => {
			const path = `POST .../config/${name}/verify`;
			const { body } = await send("POST", urlOf(school, name, "/verify"), path, {
				body: { value },
			});
			const data = dataOf(path, body);
			const problems = problemsOf(data.problems);
			if (typeof data.ok !== "boolean" || !problems || !Array.isArray(data.diff))
				throw mismatch(path, "the verdict is not {ok, problems, diff}");
			return {
				ok: data.ok,
				problems,
				diff: data.diff as ConfigVerify["diff"],
				verifiedHash:
					typeof data.verifiedHash === "string" ? data.verifiedHash : null,
				baseEtag: typeof data.baseEtag === "string" ? data.baseEtag : null,
			};
		});

	const put: ConfigApi["put"] = (school, name, value, verifiedHash, baseEtag) =>
		liftConfig(async (): Promise<ConfigPut> => {
			const path = `PUT .../config/${name}`;
			const { body } = await send("PUT", urlOf(school, name), path, {
				body: { value, verifiedHash },
				headers:
					baseEtag === null
						? { "if-none-match": "*" }
						: { "if-match": quoted(baseEtag) },
			});
			const data = dataOf(path, body);
			if (
				typeof data.sha256 !== "string" ||
				typeof data.bytes !== "number" ||
				typeof data.changed !== "boolean"
			)
				throw mismatch(path, "the answer is not {name, sha256, bytes, changed}");
			return {
				name,
				sha256: data.sha256,
				bytes: data.bytes,
				changed: data.changed,
			};
		});

	return {
		get,
		verify,
		put,
		refreshSession: () =>
			liftConfig(async () => {
				await options.tokens.refresh();
			}),
	};
}
