import { describe, expect, test } from "bun:test";
import type { Route } from "../../src/app/route.ts";
import type { Disclosure } from "../../src/data/disclosure.ts";
import { audiences } from "../../src/data/disclosure.ts";
import type { Reader } from "../../src/data/reader.ts";
import type { School } from "../../src/data/types.ts";
import { createFixtureReader } from "../../src/fixtures/reader.ts";
import { startFirstLoad } from "../../src/http/browser.ts";
import { schoolId } from "./helpers.ts";
import { ledgerTokenAnswer, refusal, tokenLifetime } from "./recorded.ts";
import { adapters, workerBase } from "./setup.ts";

/**
 * The page's first load on staging (2026-11-08: 8.8 s to the first figure, cold). Signed out, the ledger token is
 * asked for once per page, not once per Worker read; signed in, it is kept and refreshed as before. The disclosure of
 * the school the route names is read alongside the schools, and the route's pane module starts downloading before the
 * disclosure is in. The whole app's count, on the real Worker, is `test/worker-e2e/demo-schools.test.ts`.
 */

const demo = "demo-monthly-members";
const envelope = (data: unknown) => ({
	asOf: "2026-11-07T12:00:00Z",
	lagMinutes: 3,
	data,
});
const demoRow = {
	id: demo,
	asOf: "2026-11-05T12:00:00Z",
	lagMinutes: 3,
	stale: false,
	demo: true,
	name: "Demo · Monthly members",
	timeZone: "America/Denver",
	currency: "USD",
	creditUnit: { one: "class", other: "classes" },
};
const tokenCalls = (http: ReturnType<typeof adapters>["http"]) =>
	http.calls.filter(({ url }) => url.endsWith("/school-admin/ledger-token"));
const bearers = (http: ReturnType<typeof adapters>["http"]) =>
	http.calls
		.filter(({ url }) => url.startsWith(workerBase))
		.map(({ headers }) => headers.authorization ?? null);

describe("the ledger token per page", () => {
	test("signed out: one ledger-token request for the schools and every Worker read after, until Try again", async () => {
		const { reader, http } = adapters({
			worker: "fetch",
			token: { status: 401, body: refusal("unauthenticated") },
		});
		http.always("GET", /^\/v1\/schools$/, {
			status: 200,
			body: envelope({ schools: [demoRow] }),
		});
		http.always("GET", new RegExp(`^/v1/schools/${demo}/kpi$`), {
			status: 200,
			body: envelope({ school: demo }),
		});
		http.always("GET", new RegExp(`^/v1/schools/${demo}/income-statement$`), {
			status: 200,
			body: envelope({ school: demo }),
		});
		expect((await reader.schools()).map(({ id }) => id)).toEqual([demo]);
		expect(reader.session()).toBe("signed_out");
		// The Dashboard's document and the other audiences' after it, then another tab's read.
		for (const audience of audiences)
			await reader.kpiDocument({
				school: demo,
				preset: "",
				audience,
				pinLocked: false,
			});
		await reader.incomeStatement({
			school: demo,
			from: "2026-01-01",
			to: "2026-10-31",
			compare: false,
		});
		expect(tokenCalls(http)).toHaveLength(1);
		expect(bearers(http).every((bearer) => bearer === null)).toBe(true);
		// A real school's read needs the token: it is refused with the kept 401, without asking again.
		await expect(reader.disclosure(schoolId)).rejects.toMatchObject({
			kind: "unauthenticated",
		});
		expect(tokenCalls(http)).toHaveLength(1);
		// Try again reads the schools again: the person may have signed in since, so the token is asked for again.
		await reader.schools();
		expect(tokenCalls(http)).toHaveLength(2);
	});

	test("signed in: the token is kept while fresh, and refreshed on its timer and after a Worker 401", async () => {
		const { reader, http, scheduler } = adapters({ worker: "fetch" });
		http.always("GET", /^\/school-admin\/schools\/[^/]+\/ledger\/school$/, {
			status: 200,
			body: {
				school: schoolId,
				name: "Vibes of Light",
				timeZone: "America/Denver",
				currency: "usd",
				creditUnit: { one: "session", other: "sessions" },
			},
		});
		http.always("GET", /^\/v1\/schools$/, {
			status: 200,
			body: envelope({ schools: [] }),
		});
		http.on(
			"GET",
			new RegExp(`^/v1/schools/${schoolId}/kpi$`),
			{ status: 200, body: envelope({ school: schoolId }) },
			{
				status: 401,
				body: { error: { code: "token_expired", message: "expired" } },
			},
			{ status: 200, body: envelope({ school: schoolId }) },
		);
		const read = () =>
			reader.kpiDocument({
				school: schoolId,
				preset: "",
				audience: "finance",
				pinLocked: false,
			});
		await reader.schools();
		await read();
		expect(tokenCalls(http)).toHaveLength(1);
		expect(bearers(http).at(-1)).toBe(`Bearer ${ledgerTokenAnswer().token}`);
		await read();
		expect(tokenCalls(http)).toHaveLength(2);
		scheduler.advance(tokenLifetime);
		expect(tokenCalls(http)).toHaveLength(3);
	});
});

/** A promise and its resolve, to hold a read until the test lets it answer. */
function held<Value>() {
	let release: (value: Value) => void = () => undefined;
	const promise = new Promise<Value>((resolve) => {
		release = resolve;
	});
	return { promise, release };
}

describe("the first load's reads and modules start together", () => {
	const fixtures = createFixtureReader({
		clock: { today: "2026-11-05", now: "2026-11-05T12:00" },
	});
	/** The fixtures with Vibes of Light (`vol`) as a demo school, its schools and disclosure held. */
	const delayed = async () => {
		const schools = held<School[]>();
		const disclosure = held<Disclosure>();
		const listed = (await fixtures.schools()).map((school) =>
			school.id === "vol" ? { ...school, demo: true } : school,
		);
		const asked: string[] = [];
		const reader: Reader = {
			...fixtures,
			schools: () => {
				asked.push("schools");
				return schools.promise;
			},
			disclosure: (school) => {
				asked.push(`disclosure ${school}`);
				return disclosure.promise;
			},
		};
		return { reader, asked, schools, disclosure, listed };
	};

	test("the disclosure of the school the route names is read alongside the schools, and handed to the shell", async () => {
		const { reader, asked, schools, disclosure, listed } = await delayed();
		const first = startFirstLoad(reader, "#/vol/dashboard", () => undefined);
		expect(asked).toEqual(["schools", "disclosure vol"]);
		schools.release(listed);
		disclosure.release(await fixtures.disclosure("vol"));
		expect(await first.reader.schools()).toBe(listed);
		expect(await first.reader.disclosure("vol")).toEqual(
			await fixtures.disclosure("vol"),
		);
		expect(asked).toEqual(["schools", "disclosure vol"]);
		// Later asks read again: Try again, or another school.
		await first.reader.disclosure("vol");
		expect(asked).toEqual(["schools", "disclosure vol", "disclosure vol"]);
	});

	test("the Dashboard's module is loaded before the disclosure answers", async () => {
		const { reader, schools, disclosure, listed } = await delayed();
		const warmed: Route[] = [];
		const panes = await import("../../src/app/panes.tsx");
		let dashboard: unknown = null;
		startFirstLoad(reader, "#/vol/dashboard", (route) => {
			warmed.push(route);
			if (route.tab !== "all")
				panes.loadPane(route.tab).then((pane) => {
					dashboard = pane;
				});
		});
		expect(warmed.map(({ schoolId, tab }) => `${schoolId}/${tab}`)).toEqual([
			"vol/dashboard",
		]);
		for (let attempt = 0; attempt < 100 && !dashboard; attempt += 1)
			await new Promise((resolve) => setTimeout(resolve, 0));
		const { Dashboard } = await import("../../src/app/dashboard.tsx");
		// Loaded while the schools and the disclosure are still held.
		expect(dashboard).toBe(Dashboard);
		schools.release(listed);
		disclosure.release(await fixtures.disclosure("vol"));
		await new Promise((resolve) => setTimeout(resolve, 0));
		// The schools settle the route and warm it again; the module is the same load.
		expect(warmed).toHaveLength(2);
	});

	test("a demo school's route with no tab warms its Dashboard before the schools are in", async () => {
		const { reader } = await delayed();
		const warmed: string[] = [];
		startFirstLoad(reader, `#/${demo}`, (route) =>
			warmed.push(`${route.schoolId}/${route.tab}`),
		);
		expect(warmed).toEqual([`${demo}/dashboard`]);
	});

	test("a hash naming no school starts the schools alone, and warms the route they settle", async () => {
		const { reader, asked, schools, listed } = await delayed();
		const warmed: string[] = [];
		startFirstLoad(reader, "", (route) =>
			warmed.push(`${route.schoolId}/${route.tab}`),
		);
		expect(asked).toEqual(["schools"]);
		expect(warmed).toEqual([]);
		schools.release(listed);
		await new Promise((resolve) => setTimeout(resolve, 0));
		// The first school, Vibes of Light, a demo school here: its Dashboard.
		expect(warmed).toEqual(["vol/dashboard"]);
	});
});
