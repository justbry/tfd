import { AdapterError, schemaMismatch } from "./errors.ts";
import type { ApiClient, Scheduler } from "./transport.ts";
import {
	arrayOf,
	booleanOf,
	numberOf,
	oneOf,
	recordOf,
	stringOf,
} from "./wire.ts";

/**
 * The ledger token (buzz-school `POST /school-admin/ledger-token`, `packages/family-service/src/routes/ledger.ts`):
 * an EdDSA JWT that lives `exp - iat` seconds (at most 300), with the schools the person may open. It is the bearer of
 * every ledger Worker read, and its `schools[]` is the switcher's list.
 *
 * Refresh without a clock read (protocol §3): when a token arrives, a timer is set for its lifetime less a margin,
 * and when it fires the next token is fetched. A caller that finds no fresh token waits for one. A 404 means the
 * person administers no school (the route's "not an administrator anywhere"): the answer is `null`, a real "no
 * schools"; a 503 is `unavailable`, never "no schools".
 */

export type LedgerSchoolClaim = {
	id: string;
	role: "owner" | "admin";
	finance: boolean;
};

export type LedgerToken = {
	token: string;
	/** Unix seconds (`exp`). */
	expiresAt: number;
	/** Unix seconds (`iat`), the family service's clock when it signed. */
	issuedAt: number;
	/** `sub`: the signed-in person's profile id. */
	subject: string;
	schools: LedgerSchoolClaim[];
};

export interface LedgerTokenSource {
	/** The token in hand while it is fresh, else a new one; `null` when the person administers no school. */
	current(): Promise<LedgerToken | null>;
	/** A new token now (after a Worker 401). */
	refresh(): Promise<LedgerToken | null>;
	/** Cancels the refresh timer. */
	stop(): void;
}

export const ledgerTokenPath = "/school-admin/ledger-token";
const route = `POST ${ledgerTokenPath}`;
/** Seconds before `exp` the next token is fetched. */
const defaultRefreshMarginSeconds = 60;

function payloadOf(token: string): Record<string, unknown> {
	const part = token.split(".")[1];
	if (!part) throw schemaMismatch(route, "token is not a JWT");
	try {
		const base64 = part.replace(/-/g, "+").replace(/_/g, "/");
		const text = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
		return recordOf(route, JSON.parse(text), "token payload");
	} catch (error) {
		if (error instanceof AdapterError) throw error;
		throw schemaMismatch(route, "token payload is not JSON");
	}
}

export function parseLedgerToken(answer: unknown): LedgerToken {
	const body = recordOf(route, answer, "answer");
	const token = stringOf(route, body.token, "token");
	const claims = payloadOf(token);
	const schools = arrayOf(route, body.schools, "schools").map(
		(value, index) => {
			const school = recordOf(route, value, `schools[${index}]`);
			return {
				id: stringOf(route, school.id, `schools[${index}].id`),
				role: oneOf(route, school.role, `schools[${index}].role`, [
					"owner",
					"admin",
				]),
				finance: booleanOf(route, school.finance, `schools[${index}].finance`),
			};
		},
	);
	return {
		token,
		expiresAt: numberOf(route, body.expiresAt, "expiresAt"),
		issuedAt: numberOf(route, claims.iat, "token iat"),
		subject: stringOf(route, claims.sub, "token sub"),
		schools,
	};
}

export function createLedgerTokenSource(options: {
	api: ApiClient;
	scheduler: Scheduler;
	refreshMarginSeconds?: number;
}): LedgerTokenSource {
	const margin = options.refreshMarginSeconds ?? defaultRefreshMarginSeconds;
	let held: LedgerToken | null | undefined;
	let fresh = false;
	let inFlight: Promise<LedgerToken | null> | null = null;
	let cancelTimer: (() => void) | null = null;

	const fetchToken = (): Promise<LedgerToken | null> => {
		if (inFlight) return inFlight;
		inFlight = (async () => {
			try {
				const token = parseLedgerToken(
					await options.api.post(ledgerTokenPath, {}),
				);
				held = token;
				fresh = true;
				cancelTimer?.();
				const lifetime = token.expiresAt - token.issuedAt;
				cancelTimer = options.scheduler.after(
					Math.max(lifetime - margin, 0),
					() => {
						fresh = false;
						cancelTimer = null;
						fetchToken().catch(() => {
							// The next `current()` asks again and rejects with the reason.
						});
					},
				);
				return token;
			} catch (error) {
				if (error instanceof AdapterError && error.kind === "not_found") {
					held = null;
					fresh = true;
					return null;
				}
				fresh = false;
				throw error;
			} finally {
				inFlight = null;
			}
		})();
		return inFlight;
	};

	return {
		current: async () => {
			if (fresh && held !== undefined) return held;
			return fetchToken();
		},
		refresh: () => {
			fresh = false;
			return fetchToken();
		},
		stop: () => {
			cancelTimer?.();
			cancelTimer = null;
		},
	};
}
