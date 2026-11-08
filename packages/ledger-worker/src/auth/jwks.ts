/**
 * The JWKS the tokens are checked against, cached in the isolate: for the response's `max-age` (default 300 s), and
 * refetched when a token names a `kid` the cache lacks. Either refetch happens at most once every 30 s, so a flood of
 * tokens with made-up `kid`s costs one fetch per 30 s. The cache holds finished values only, never a fetch in progress.
 */
import type { Jwk, Jwks } from "./jwt.js";

export const DEFAULT_MAX_AGE_SECONDS = 300;
export const MIN_REFETCH_SECONDS = 30;
const MS_PER_SECOND = 1000;
const MAX_AGE = /(?:^|[\s,])max-age=(\d+)/i;

export type JwksFetch = (url: string) => Promise<Response>;

export class JwksUnavailable extends Error {}

const isJwk = (value: unknown): value is Jwk => {
	if (typeof value !== "object" || value === null) return false;
	const key = value as Record<string, unknown>;
	return (
		key.kty === "OKP" &&
		key.crv === "Ed25519" &&
		typeof key.x === "string" &&
		typeof key.kid === "string"
	);
};

const maxAgeOf = (response: Response): number => {
	const match = MAX_AGE.exec(response.headers.get("cache-control") ?? "");
	return match?.[1] === undefined ? DEFAULT_MAX_AGE_SECONDS : Number(match[1]);
};

export class JwksCache {
	private keys: Jwks | null = null;
	private fetchedAt = Number.NEGATIVE_INFINITY;
	private expiresAt = Number.NEGATIVE_INFINITY;

	constructor(
		private readonly url: string,
		private readonly fetchJwks: JwksFetch,
	) {}

	private refetchAllowed(now: number): boolean {
		return now - this.fetchedAt >= MIN_REFETCH_SECONDS * MS_PER_SECOND;
	}

	private async loadKeys(now: number): Promise<Jwks> {
		try {
			const response = await this.fetchJwks(this.url);
			if (!response.ok) throw new JwksUnavailable("the JWKS did not answer");
			const body: unknown = await response.json();
			const list =
				typeof body === "object" && body !== null
					? (body as { keys?: unknown }).keys
					: undefined;
			if (!Array.isArray(list))
				throw new JwksUnavailable("the JWKS has no keys");
			this.keys = { keys: list.filter(isJwk) };
			this.expiresAt = now + maxAgeOf(response) * MS_PER_SECOND;
			return this.keys;
		} catch (error) {
			if (error instanceof JwksUnavailable) throw error;
			throw new JwksUnavailable("the JWKS could not be fetched");
		}
	}

	/**
	 * Each caller fetches for itself: a fetch belongs to the request that started it and workerd cancels it when that
	 * request ends, so a shared fetch could leave a later request waiting for an answer that never comes. Requests of one
	 * isolate may fetch twice at once; the cache keeps only what a fetch finished.
	 */
	private fetchFresh(now: number): Promise<Jwks> {
		this.fetchedAt = now;
		return this.loadKeys(now);
	}

	/** The keys: the cached set while it is fresh, else a refetch (a stale set stands in if the refetch is too soon or fails). */
	async current(now: number): Promise<Jwks> {
		if (this.keys !== null && now < this.expiresAt) return this.keys;
		if (this.keys !== null && !this.refetchAllowed(now)) return this.keys;
		try {
			return await this.fetchFresh(now);
		} catch (error) {
			if (this.keys !== null) return this.keys;
			throw error;
		}
	}

	/** A token named a `kid` `current` lacks: refetch if the last fetch was 30 s ago or more; null when it was sooner. */
	async refetchForUnknownKid(now: number): Promise<Jwks | null> {
		if (!this.refetchAllowed(now)) return null;
		try {
			return await this.fetchFresh(now);
		} catch {
			return null;
		}
	}
}
