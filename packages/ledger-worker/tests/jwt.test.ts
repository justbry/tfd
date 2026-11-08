/** The token's crypto and the JWKS cache: every way a ledger token can fail to verify (the case list of buzz-school's `ledger-jwt.test.ts`), and when the keys are fetched. */
import { describe, expect, test } from "bun:test";
import { JwksCache, MIN_REFETCH_SECONDS } from "../src/auth/jwks.js";
import { base64urlEncode, kidOf, verifyJwt } from "../src/auth/jwt.js";
import { signToken, testSigner } from "../src/testing/signer.js";

const IAT = 1_000_000;
const OPTIONS = { iss: "https://api.test", aud: "atm-ledger", now: IAT + 10 };
const claims = (over: Record<string, unknown> = {}) => ({
	iss: "https://api.test",
	aud: "atm-ledger",
	sub: "p1",
	iat: IAT,
	nbf: IAT,
	exp: IAT + 300,
	schools: [{ id: "s1", role: "owner", finance: true }],
	...over,
});
const encoder = new TextEncoder();
const part = (value: unknown) =>
	base64urlEncode(encoder.encode(JSON.stringify(value)));
const split = (token: string) => token.split(".") as [string, string, string];

describe("verifyJwt", () => {
	test("a token verifies against the JWKS and carries its claims", async () => {
		const signer = await testSigner(1);
		const token = await signToken(signer, claims());
		const verified = await verifyJwt(token, { keys: [signer.jwk] }, OPTIONS);
		expect(verified.ok && verified.claims.schools).toEqual([
			{ id: "s1", role: "owner", finance: true },
		]);
		expect(kidOf(token)).toBe(signer.kid);
	});

	test("expired (at and after exp), not yet valid, wrong aud, wrong iss", async () => {
		const signer = await testSigner(1);
		const jwks = { keys: [signer.jwk] };
		const token = await signToken(signer, claims());
		expect(
			await verifyJwt(token, jwks, { ...OPTIONS, now: IAT + 299 }),
		).toMatchObject({ ok: true });
		expect(
			await verifyJwt(token, jwks, { ...OPTIONS, now: IAT + 300 }),
		).toEqual({ ok: false, reason: "expired" });
		expect(await verifyJwt(token, jwks, { ...OPTIONS, now: IAT - 1 })).toEqual({
			ok: false,
			reason: "not_yet",
		});
		expect(
			await verifyJwt(
				await signToken(signer, claims({ aud: "other" })),
				jwks,
				OPTIONS,
			),
		).toEqual({ ok: false, reason: "aud" });
		expect(
			await verifyJwt(
				await signToken(signer, claims({ iss: "https://api-staging.test" })),
				jwks,
				OPTIONS,
			),
		).toEqual({ ok: false, reason: "iss" });
		expect(
			await verifyJwt(
				await signToken(signer, claims({ exp: undefined })),
				jwks,
				OPTIONS,
			),
		).toEqual({ ok: false, reason: "expired" });
	});

	test("tampered: a changed claim, a changed signature, a swapped body", async () => {
		const signer = await testSigner(1);
		const jwks = { keys: [signer.jwk] };
		const token = await signToken(
			signer,
			claims({ schools: [{ id: "s1", role: "admin", finance: false }] }),
		);
		const [head, , signature] = split(token);
		const forged = part(
			claims({ schools: [{ id: "s1", role: "owner", finance: true }] }),
		);
		expect(
			await verifyJwt(`${head}.${forged}.${signature}`, jwks, OPTIONS),
		).toEqual({ ok: false, reason: "signature" });
		const flipped =
			signature.slice(0, -2) + (signature.endsWith("AA") ? "BB" : "AA");
		expect(
			await verifyJwt(`${head}.${split(token)[1]}.${flipped}`, jwks, OPTIONS),
		).toEqual({ ok: false, reason: "signature" });
		const other = split(await signToken(signer, claims({ sub: "p2" })));
		expect(
			await verifyJwt(`${head}.${other[1]}.${signature}`, jwks, OPTIONS),
		).toEqual({ ok: false, reason: "signature" });
	});

	test("another key under the same kid is a bad signature; an unknown kid is unknown_kid; a key the token carries is never used", async () => {
		const real = await testSigner(1);
		const evil = await testSigner(9);
		const forged = await signToken({ ...evil, kid: real.kid }, claims());
		expect(await verifyJwt(forged, { keys: [real.jwk] }, OPTIONS)).toEqual({
			ok: false,
			reason: "signature",
		});
		expect(
			await verifyJwt(
				await signToken(evil, claims()),
				{ keys: [real.jwk] },
				OPTIONS,
			),
		).toEqual({ ok: false, reason: "unknown_kid" });
		expect(
			await verifyJwt(await signToken(real, claims()), { keys: [] }, OPTIONS),
		).toEqual({ ok: false, reason: "unknown_kid" });
		const carrying = await signToken(evil, claims(), { jwk: evil.jwk });
		expect(await verifyJwt(carrying, { keys: [real.jwk] }, OPTIONS)).toEqual({
			ok: false,
			reason: "unknown_kid",
		});
	});

	test("aud must be exactly the one string: an array is refused", async () => {
		const signer = await testSigner(1);
		const jwks = { keys: [signer.jwk] };
		for (const aud of [["atm-ledger"], ["atm-ledger", "other"], undefined])
			expect(
				await verifyJwt(
					await signToken(signer, claims({ aud })),
					jwks,
					OPTIONS,
				),
			).toEqual({ ok: false, reason: "aud" });
	});

	test("iat is required, may not be in the future, and exp - iat may not pass 300 seconds", async () => {
		const signer = await testSigner(1);
		const jwks = { keys: [signer.jwk] };
		expect(
			await verifyJwt(
				await signToken(signer, claims({ iat: undefined })),
				jwks,
				OPTIONS,
			),
		).toEqual({ ok: false, reason: "malformed" });
		expect(
			await verifyJwt(
				await signToken(signer, claims({ iat: "1000000" })),
				jwks,
				OPTIONS,
			),
		).toEqual({ ok: false, reason: "malformed" });
		expect(
			await verifyJwt(
				await signToken(
					signer,
					claims({ iat: IAT + 100, nbf: undefined, exp: IAT + 400 }),
				),
				jwks,
				OPTIONS,
			),
		).toEqual({ ok: false, reason: "not_yet" });
		expect(
			await verifyJwt(
				await signToken(signer, claims({ exp: IAT + 300 })),
				jwks,
				OPTIONS,
			),
		).toMatchObject({ ok: true });
		expect(
			await verifyJwt(
				await signToken(signer, claims({ exp: IAT + 301 })),
				jwks,
				OPTIONS,
			),
		).toEqual({ ok: false, reason: "lifetime" });
		expect(
			await verifyJwt(
				await signToken(signer, claims({ exp: IAT + 86_400 })),
				jwks,
				OPTIONS,
			),
		).toEqual({ ok: false, reason: "lifetime" });
	});

	test("the leeway covers a slightly fast issuer clock, and no more", async () => {
		const signer = await testSigner(1);
		const jwks = { keys: [signer.jwk] };
		const token = await signToken(
			signer,
			claims({ iat: IAT + 14, nbf: IAT + 14, exp: IAT + 314 }),
		);
		expect(
			await verifyJwt(token, jwks, { ...OPTIONS, leewaySeconds: 5 }),
		).toMatchObject({ ok: true });
		expect(
			await verifyJwt(token, jwks, { ...OPTIONS, leewaySeconds: 2 }),
		).toEqual({ ok: false, reason: "not_yet" });
	});

	test("alg none, alg HS256 and a header without kid are refused before any key is touched", async () => {
		const signer = await testSigner(1);
		const jwks = { keys: [signer.jwk] };
		const body = part(claims());
		expect(
			await verifyJwt(
				`${part({ alg: "none", kid: signer.kid })}.${body}.`,
				jwks,
				OPTIONS,
			),
		).toEqual({ ok: false, reason: "alg" });
		expect(
			await verifyJwt(
				`${part({ alg: "HS256", kid: signer.kid })}.${body}.${base64urlEncode(new Uint8Array(32))}`,
				jwks,
				OPTIONS,
			),
		).toEqual({ ok: false, reason: "alg" });
		expect(
			await verifyJwt(
				`${part({ alg: "EdDSA" })}.${body}.${base64urlEncode(new Uint8Array(64))}`,
				jwks,
				OPTIONS,
			),
		).toEqual({ ok: false, reason: "unknown_kid" });
	});

	test("garbage is malformed, never a throw", async () => {
		for (const token of [
			"",
			"a",
			"a.b",
			"a.b.c.d",
			"!!.!!.!!",
			`${part({ alg: "EdDSA" })}.${part([1])}.AA`,
		])
			expect((await verifyJwt(token, { keys: [] }, OPTIONS)).ok).toBe(false);
	});
});

describe("JwksCache", () => {
	const response = (keys: unknown[], cacheControl?: string) =>
		new Response(JSON.stringify({ keys }), {
			status: 200,
			headers: cacheControl ? { "cache-control": cacheControl } : {},
		});
	const SECOND = 1000;

	test("keys are cached for the response's max-age, default 300 seconds", async () => {
		const signer = await testSigner(1);
		let fetched = 0;
		const cache = new JwksCache("https://jwks.test", async () => {
			fetched += 1;
			return response([signer.jwk]);
		});
		await cache.current(0);
		await cache.current(299 * SECOND);
		expect(fetched).toBe(1);
		await cache.current(300 * SECOND);
		expect(fetched).toBe(2);
		const short = new JwksCache("https://jwks.test", async () => {
			fetched += 1;
			return response([signer.jwk], "public, max-age=60");
		});
		await short.current(0);
		await short.current(59 * SECOND);
		expect(fetched).toBe(3);
		await short.current(60 * SECOND);
		expect(fetched).toBe(4);
	});

	test("an unknown kid refetches, no more often than every 30 seconds", async () => {
		const signer = await testSigner(1);
		let fetched = 0;
		const cache = new JwksCache("https://jwks.test", async () => {
			fetched += 1;
			return response([signer.jwk]);
		});
		await cache.current(0);
		expect(await cache.refetchForUnknownKid(10 * SECOND)).toBeNull();
		expect(fetched).toBe(1);
		expect(
			await cache.refetchForUnknownKid(MIN_REFETCH_SECONDS * SECOND),
		).not.toBeNull();
		expect(fetched).toBe(2);
		expect(
			await cache.refetchForUnknownKid(MIN_REFETCH_SECONDS * SECOND + 1),
		).toBeNull();
		expect(fetched).toBe(2);
	});

	test("the stale keys stand in when a refetch fails or is too soon; no keys at all is an error", async () => {
		const signer = await testSigner(1);
		let healthy = true;
		const cache = new JwksCache("https://jwks.test", async () =>
			healthy
				? response([signer.jwk], "max-age=1")
				: new Response("no", { status: 500 }),
		);
		await cache.current(0);
		healthy = false;
		expect((await cache.current(100 * SECOND)).keys).toHaveLength(1);
		const empty = new JwksCache(
			"https://jwks.test",
			async () => new Response("no", { status: 500 }),
		);
		await expect(empty.current(0)).rejects.toThrow();
	});

	test("keys that are not Ed25519 OKP keys are dropped", async () => {
		const signer = await testSigner(1);
		const cache = new JwksCache("https://jwks.test", async () =>
			response([
				signer.jwk,
				{ kty: "RSA", kid: "r", n: "x", e: "y" },
				{ kty: "OKP", crv: "Ed448", x: "a", kid: "e" },
				"junk",
			]),
		);
		expect((await cache.current(0)).keys.map((key) => key.kid)).toEqual([
			signer.kid,
		]);
	});

	test("concurrent callers each fetch for themselves, and the keys stay cached once one is done", async () => {
		const signer = await testSigner(1);
		let fetched = 0;
		const cache = new JwksCache("https://jwks.test", async () => {
			fetched += 1;
			await Bun.sleep(10);
			return response([signer.jwk]);
		});
		await Promise.all([cache.current(0), cache.current(0), cache.current(0)]);
		expect(fetched).toBe(3);
		await cache.current(1);
		expect(fetched).toBe(3);
	});

	test("a fetch that never finishes holds nothing up for the next caller", async () => {
		const signer = await testSigner(1);
		let fetched = 0;
		const cache = new JwksCache("https://jwks.test", () => {
			fetched += 1;
			return fetched === 1
				? new Promise<Response>(() => undefined)
				: Promise.resolve(response([signer.jwk]));
		});
		cache.current(0).catch(() => undefined);
		const keys = await cache.current(0);
		expect(keys.keys).toHaveLength(1);
		expect(fetched).toBe(2);
	});
});
