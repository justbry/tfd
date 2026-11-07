import { AdapterError, type AdapterErrorKind } from "./errors.ts";
import { isRecord } from "./wire.ts";

/**
 * The `api.b4uni.com` client (S8e; `plans/ledger-ui/S8-contract.md` section 2). The browser sends the `b4u_session`
 * cookie (`credentials: "include"`); buzz-school's CSRF check (`assertCsrf` in `packages/family-service/src/http.ts`)
 * wants every POST to carry `x-b4u: 1` from an allow-listed Origin, which the browser adds. Every write carries an
 * `Idempotency-Key` the caller chose for that user action, and a retry of the action sends the same key. A 503 is
 * tried again a few times, then rejected as `unavailable` ("try again"), never answered as empty.
 */

/** The part of `fetch` the adapters use; injected so tests replay recorded answers. */
export type Fetch = (url: string, init: RequestInit) => Promise<Response>;

/** Timers, injected: the UI never reads the system clock (protocol §3), so waits and refreshes are scheduled. */
export type Scheduler = {
	/** Resolves after `seconds`. */
	wait(seconds: number): Promise<void>;
	/** Runs `run` after `seconds`; the answer cancels it. */
	after(seconds: number, run: () => void): () => void;
};

export type PostOptions = { idempotencyKey?: string };

export type ApiClient = {
	get(
		path: string,
		query?: Record<string, string | undefined>,
	): Promise<unknown>;
	post(path: string, body: unknown, options?: PostOptions): Promise<unknown>;
};

/** The PIN unlock route: a 429 there is the PIN lock (`checkFamilyPin`, `PIN_TRIES` per 15 minutes). */
export const pinVerifyPath = "/family/pin/verify";

const defaultUnavailableRetries = 2;
const defaultUnavailableWaitSeconds = 2;

const kindOfStatus = (
	status: number,
	code: string,
	path: string,
): AdapterErrorKind => {
	if (status === 400) return "bad_request";
	if (status === 401) return "unauthenticated";
	if (status === 403) {
		if (code === "step_up_required") return "step_up";
		if (code === "pin_required") return "pin_required";
		if (code === "pin_wrong") return "pin_wrong";
		return "forbidden";
	}
	if (status === 404) return "not_found";
	if (status === 409) return "conflict";
	if (status === 429)
		return path === pinVerifyPath ? "pin_locked" : "rate_limited";
	if (status === 503) return "unavailable";
	return "server";
};

/** buzz-school answers a refusal as `{ error: code, ...extra }` (`app.ts`, `HttpError`). */
async function errorOf(
	response: Response,
	path: string,
): Promise<AdapterError> {
	let body: unknown = null;
	try {
		body = await response.json();
	} catch {
		body = null;
	}
	const code =
		isRecord(body) && typeof body.error === "string"
			? body.error
			: `http_${response.status}`;
	const fields =
		isRecord(body) && Array.isArray(body.fields)
			? body.fields.join(",")
			: undefined;
	const retryAfter = Number(response.headers.get("retry-after"));
	return new AdapterError(
		kindOfStatus(response.status, code, path),
		`${response.status} ${code} on ${path}`,
		{
			status: response.status,
			code,
			...(fields ? { field: fields } : {}),
			...(Number.isFinite(retryAfter) && retryAfter > 0
				? { retryAfterSeconds: retryAfter }
				: {}),
		},
	);
}

export function createApiClient(options: {
	fetch: Fetch;
	/** `https://api.b4uni.com`, no trailing slash. */
	base: string;
	scheduler: Scheduler;
	unavailableRetries?: number;
	unavailableWaitSeconds?: number;
}): ApiClient {
	const retries = options.unavailableRetries ?? defaultUnavailableRetries;
	const waitSeconds =
		options.unavailableWaitSeconds ?? defaultUnavailableWaitSeconds;

	const send = async (path: string, init: RequestInit): Promise<unknown> => {
		for (let attempt = 0; ; attempt += 1) {
			let response: Response;
			try {
				response = await options.fetch(`${options.base}${path}`, init);
			} catch (cause) {
				throw new AdapterError(
					"network",
					`no answer from ${path}: ${String(cause)}`,
				);
			}
			if (response.ok) {
				try {
					return await response.json();
				} catch {
					throw new AdapterError(
						"schema_mismatch",
						`${path} answered no JSON`,
						{
							status: response.status,
						},
					);
				}
			}
			const error = await errorOf(response, path);
			if (error.kind !== "unavailable" || attempt >= retries) throw error;
			await options.scheduler.wait(waitSeconds);
		}
	};

	return {
		get: (path, query = {}) => {
			const search = new URLSearchParams();
			for (const [name, value] of Object.entries(query))
				if (value !== undefined) search.set(name, value);
			const text = search.toString();
			return send(text ? `${path}?${text}` : path, {
				method: "GET",
				credentials: "include",
				headers: { accept: "application/json" },
			});
		},
		post: (path, body, postOptions = {}) =>
			send(path, {
				method: "POST",
				credentials: "include",
				headers: {
					accept: "application/json",
					"content-type": "application/json",
					"x-b4u": "1",
					...(postOptions.idempotencyKey
						? { "idempotency-key": postOptions.idempotencyKey }
						: {}),
				},
				body: JSON.stringify(body),
			}),
	};
}

/** Timers on `setTimeout`, for the browser build. */
export const timerScheduler: Scheduler = {
	wait: (seconds) =>
		new Promise((resolve) => {
			setTimeout(resolve, seconds * 1000);
		}),
	after: (seconds, run) => {
		const timer = setTimeout(run, seconds * 1000);
		return () => clearTimeout(timer);
	},
};
