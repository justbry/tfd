import { describe, expect, test } from "bun:test";
import { signStripePayload as tfdSign } from "../../../packages/atm/src/cloud.ts";
import {
	signStripePayload,
	verifyStripeSignature,
} from "../src/billing/stripe-signature";

const SECRET = "whsec_signature_test";
const NOW = Date.parse("2026-11-08T12:00:00Z");
const T = Math.floor(NOW / 1000);
const PAYLOAD = '{"id":"evt_1","object":"event"}';

const check = (
	header: string | null,
	over: { secret?: string; nowMs?: number } = {},
) =>
	verifyStripeSignature({
		payload: PAYLOAD,
		header,
		secret: over.secret ?? SECRET,
		nowMs: over.nowMs ?? NOW,
	});

describe("Stripe signature on WebCrypto", () => {
	test("a good signature passes, and matches the one tfd's node:crypto signer makes", async () => {
		const header = await signStripePayload({
			payload: PAYLOAD,
			secret: SECRET,
			timestampSeconds: T,
		});
		expect(header).toBe(
			tfdSign({ payload: PAYLOAD, secret: SECRET, timestampSeconds: T }),
		);
		expect(await check(header)).toEqual({ ok: true, timestamp: T });
	});

	test("one good v1 among several passes (a secret being rolled)", async () => {
		const good = await signStripePayload({
			payload: PAYLOAD,
			secret: SECRET,
			timestampSeconds: T,
		});
		const header = `t=${T},v1=${"0".repeat(64)},${good.split(",")[1]},v0=abc`;
		expect((await check(header)).ok).toBe(true);
	});

	test("a changed body, a wrong secret, a stale or future time, a missing or malformed header all fail", async () => {
		const header = await signStripePayload({
			payload: PAYLOAD,
			secret: SECRET,
			timestampSeconds: T,
		});
		expect(
			await verifyStripeSignature({
				payload: `${PAYLOAD} `,
				header,
				secret: SECRET,
				nowMs: NOW,
			}),
		).toEqual({ ok: false, reason: "mismatch" });
		expect(await check(header, { secret: "whsec_other" })).toEqual({
			ok: false,
			reason: "mismatch",
		});
		expect(await check(header, { nowMs: NOW + 301_000 })).toEqual({
			ok: false,
			reason: "stale",
		});
		expect(await check(header, { nowMs: NOW - 301_000 })).toEqual({
			ok: false,
			reason: "stale",
		});
		expect((await check(header, { nowMs: NOW + 299_000 })).ok).toBe(true);
		expect(await check(null)).toEqual({ ok: false, reason: "missing" });
		expect(await check("v1=abc")).toEqual({ ok: false, reason: "malformed" });
		expect(await check(`t=${T}`)).toEqual({ ok: false, reason: "malformed" });
	});
});
