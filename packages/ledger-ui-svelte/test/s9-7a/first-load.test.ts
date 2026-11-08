import { describe, expect, test } from "bun:test";
import type { Route } from "$contract/app/route.ts";
import type { Disclosure } from "$contract/data/disclosure.ts";
import type { Reader } from "$contract/data/reader.ts";
import type { School } from "$contract/data/types.ts";
import { createFixtureReader } from "$contract/fixtures/reader.ts";
import { memoryStorage } from "$contract/http/pending.ts";
import {
	ledgerTokenAnswer,
	refusal,
} from "../../../ledger-ui/test/s8e/recorded.ts";
import { createHttpServices } from "../../src/effect/http-layer.ts";
import { startFirstLoad } from "../../src/first-load.ts";
import { signedInHandler, warmUp } from "../../src/http-entry.ts";
import { apiBase, demoId, demoRow, workerBase } from "./support.ts";

/** The Svelte package's port of `test/s8e/first-load.test.ts` (Preact package): the page's first load. Signed out, the
 * ledger token is asked for once per page, not once per Worker read; the disclosure of the school the route names is
 * read alongside the schools, and the route's pane module starts downloading before the disclosure is in. "I have
 * signed in" and Try again ask the token again. */
const tokenCalls = (urls: string[]) =>
	urls.filter((url) => url.endsWith("/school-admin/ledger-token"));

describe("the ledger token per page", () => {
	test("signed out: one request for the schools and every Worker read after, and again after 'I have signed in'", async () => {
		const urls: string[] = [];
		let signedIn = false;
		const services = createHttpServices({
			fetch: async (url) => {
				urls.push(url);
				if (url.endsWith("/school-admin/ledger-token"))
					return signedIn
						? new Response(JSON.stringify(ledgerTokenAnswer([])), {
								status: 200,
							})
						: new Response(JSON.stringify(refusal("unauthenticated")), {
								status: 401,
							});
				return new Response(
					JSON.stringify({
						asOf: null,
						lagMinutes: null,
						data: { schools: [demoRow] },
					}),
					{ status: 200 },
				);
			},
			apiBase,
			workerBase,
			storage: memoryStorage(),
			newKey: () => "key-1",
			files: { save: () => Promise.resolve() },
		});
		expect((await services.reader.schools()).map(({ id }) => id)).toEqual([
			demoId,
		]);
		expect(services.reader.session()).toBe("signed_out");
		expect(tokenCalls(urls)).toHaveLength(1);
		// A real school's read needs the token: refused with the kept 401, without asking again.
		await expect(
			services.reader.disclosure("6f1c2a7e-3b4d-4e5f-8a9b-0c1d2e3f4a5b"),
		).rejects.toMatchObject({ kind: "unauthenticated" });
		expect(tokenCalls(urls)).toHaveLength(1);
		// "I have signed in": the entry forgets the kept 401 and loads the page again, whose first read asks again.
		let reloaded = 0;
		signedInHandler(services.tokens, () => {
			reloaded += 1;
		})();
		expect(reloaded).toBe(1);
		signedIn = true;
		await expect(services.tokens.current()).resolves.toMatchObject({
			schools: [],
		});
		expect(tokenCalls(urls)).toHaveLength(2);
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

	test("a failed early disclosure is the ask's own, not an unhandled rejection", async () => {
		const { reader } = await delayed();
		const failing = Promise.reject<Disclosure>(new Error("no such school"));
		const failed: Reader = { ...reader, disclosure: () => failing };
		const first = startFirstLoad(failed, "#/vol/plans", () => undefined);
		// Nobody asks for it yet: bun fails the test on an unhandled rejection.
		await new Promise((resolve) => setTimeout(resolve, 10));
		await expect(first.reader.disclosure("vol")).rejects.toThrow(
			"no such school",
		);
	});

	test("the Dashboard's chunk is loaded before the disclosure answers", async () => {
		const { reader, schools, disclosure, listed } = await delayed();
		const warmed: Route[] = [];
		startFirstLoad(reader, "#/vol/dashboard", (route) => {
			warmed.push(route);
			warmUp(route);
		});
		expect(warmed.map(({ schoolId, tab }) => `${schoolId}/${tab}`)).toEqual([
			"vol/dashboard",
		]);
		schools.release(listed);
		disclosure.release(await fixtures.disclosure("vol"));
		await new Promise((resolve) => setTimeout(resolve, 0));
		// The schools settle the route and warm it again; the module is the same load.
		expect(warmed).toHaveLength(2);
	});

	test("a demo school's route with no tab warms its Dashboard before the schools are in", async () => {
		const { reader } = await delayed();
		const warmed: string[] = [];
		startFirstLoad(reader, `#/${demoId}`, (route) =>
			warmed.push(`${route.schoolId}/${route.tab}`),
		);
		expect(warmed).toEqual([`${demoId}/dashboard`]);
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
		expect(warmed).toEqual(["vol/dashboard"]);
	});
});
