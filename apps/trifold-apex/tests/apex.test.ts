import { describe, expect, test } from "bun:test";
import { handle } from "../src/index";

const env = {
	APEX: "trifold.app",
	ORIGIN: "tfd-ledger.pages.dev",
	VERIFY: "verify.trifold.app",
};

const recorder = (answer: (request: Request) => Response) => {
	const seen: Request[] = [];
	const upstream = async (request: Request) => {
		seen.push(request);
		return answer(request);
	};
	return { seen, upstream };
};

describe("trifold.app", () => {
	test("www redirects to the apex, keeping path and query", async () => {
		const response = await handle(
			new Request("https://www.trifold.app/pricing?x=1"),
			env,
		);
		expect(response.status).toBe(301);
		expect(response.headers.get("location")).toBe(
			"https://trifold.app/pricing?x=1",
		);
	});

	test("the apex serves the Pages origin's answer for the same path", async () => {
		const { seen, upstream } = recorder(
			() =>
				new Response("<h1>Trifold</h1>", {
					headers: { "content-type": "text/html" },
				}),
		);
		const response = await handle(
			new Request("https://trifold.app/how-it-works?ref=a"),
			env,
			upstream,
		);
		expect(await response.text()).toBe("<h1>Trifold</h1>");
		expect(seen[0]?.url).toBe(
			"https://tfd-ledger.pages.dev/how-it-works?ref=a",
		);
		expect(seen[0]?.headers.get("host")).toBeNull();
	});

	test("the origin's status and headers pass through", async () => {
		const { upstream } = recorder(
			() =>
				new Response("missing", {
					status: 404,
					headers: { "content-security-policy": "default-src 'self'" },
				}),
		);
		const response = await handle(
			new Request("https://trifold.app/nope"),
			env,
			upstream,
		);
		expect(response.status).toBe(404);
		expect(response.headers.get("content-security-policy")).toBe(
			"default-src 'self'",
		);
	});

	test("an origin redirect to its own host comes back on the apex", async () => {
		const { upstream } = recorder(
			() =>
				new Response(null, {
					status: 308,
					headers: { location: "https://tfd-ledger.pages.dev/pricing/" },
				}),
		);
		const response = await handle(
			new Request("https://trifold.app/pricing"),
			env,
			upstream,
		);
		expect(response.status).toBe(308);
		expect(response.headers.get("location")).toBe(
			"https://trifold.app/pricing/",
		);
	});

	test("an http origin redirect to its own host comes back as https on the apex", async () => {
		const { upstream } = recorder(
			() =>
				new Response(null, {
					status: 301,
					headers: { location: "http://tfd-ledger.pages.dev/x/" },
				}),
		);
		const response = await handle(
			new Request("https://trifold.app/x"),
			env,
			upstream,
		);
		expect(response.headers.get("location")).toBe("https://trifold.app/x/");
	});

	test("a relative origin redirect resolves to the apex", async () => {
		const { upstream } = recorder(
			() => new Response(null, { status: 308, headers: { location: "/for/" } }),
		);
		const response = await handle(
			new Request("https://trifold.app/for"),
			env,
			upstream,
		);
		expect(response.headers.get("location")).toBe("https://trifold.app/for/");
	});

	test("an origin redirect elsewhere is left alone", async () => {
		const { upstream } = recorder(
			() =>
				new Response(null, {
					status: 302,
					headers: { location: "https://github.com/justbry/tfd" },
				}),
		);
		const response = await handle(
			new Request("https://trifold.app/gh"),
			env,
			upstream,
		);
		expect(response.headers.get("location")).toBe(
			"https://github.com/justbry/tfd",
		);
	});

	test("a form POST is forwarded with its body", async () => {
		const { seen, upstream } = recorder(() => new Response("ok"));
		await handle(
			new Request("https://trifold.app/early-access", {
				method: "POST",
				body: "email=a%40b.c",
			}),
			env,
			upstream,
		);
		expect(seen[0]?.method).toBe("POST");
		expect(await seen[0]?.text()).toBe("email=a%40b.c");
	});
});

describe("verify.trifold.app", () => {
	test("points at the site's verifier with a temporary redirect, keeping a receipt link's query", async () => {
		const response = await handle(
			new Request("https://verify.trifold.app/?r=eyJyZWNlaXB0Ijp7fX0"),
			env,
		);
		expect(response.status).toBe(302);
		expect(response.headers.get("location")).toBe(
			"https://trifold.app/verify?r=eyJyZWNlaXB0Ijp7fX0",
		);
	});

	test("any path lands on the verifier", async () => {
		const response = await handle(
			new Request("https://verify.trifold.app/check"),
			env,
		);
		expect(response.headers.get("location")).toBe("https://trifold.app/verify");
	});

	test("has no keys file yet", async () => {
		const response = await handle(
			new Request("https://verify.trifold.app/.well-known/trifold-keys.json"),
			env,
		);
		expect(response.status).toBe(404);
	});
});
