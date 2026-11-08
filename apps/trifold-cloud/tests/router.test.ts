import { describe, expect, test } from "bun:test";
import worker from "../src/index";
import { fakeEnv } from "./fakes";

const LEDGER = "staging-ledger.trifold.app";
const API = "staging-api.trifold.app";

const call = (url: string, env = fakeEnv(), method = "GET") =>
	worker.fetch(new Request(url, { method }), env);

describe("routing by host", () => {
	test("healthz answers on the ledger host with every check", async () => {
		const response = await call(`https://${LEDGER}/healthz`);
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			ok: true,
			service: "trifold-cloud",
			surface: "ledger",
			environment: "staging",
			checks: { d1: true, books: true, backups: true },
		});
	});

	test("healthz answers on the API host as the api surface, and to HEAD", async () => {
		const body = (await (await call(`https://${API}/healthz`)).json()) as {
			surface: string;
		};
		expect(body.surface).toBe("api");
		const head = await call(`https://${API}/healthz`, fakeEnv(), "HEAD");
		expect(head.status).toBe(200);
		expect(await head.text()).toBe("");
	});

	test("an unknown host is a 404, even for healthz", async () => {
		expect((await call("https://evil.example/healthz")).status).toBe(404);
	});

	test("unknown paths and methods are 404", async () => {
		expect((await call(`https://${LEDGER}/nope`)).status).toBe(404);
		expect(
			(await call(`https://${LEDGER}/healthz`, fakeEnv(), "POST")).status,
		).toBe(404);
	});

	test("a failing binding makes healthz 503 without leaking the reason", async () => {
		const response = await call(
			`https://${API}/healthz`,
			fakeEnv({ booksFail: true }),
		);
		expect(response.status).toBe(503);
		const text = await response.text();
		expect(JSON.parse(text).checks).toEqual({
			d1: true,
			books: false,
			backups: true,
		});
		expect(text).not.toContain("R2 down");
	});

	test("every answer carries the security headers", async () => {
		const response = await call("https://evil.example/");
		expect(response.headers.get("Strict-Transport-Security")).toBe(
			"max-age=63072000; includeSubDomains",
		);
		expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
		expect(response.headers.get("X-Frame-Options")).toBe("DENY");
	});
});
