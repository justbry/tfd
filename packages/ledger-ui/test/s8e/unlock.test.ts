import { afterEach, describe, expect, test } from "bun:test";
import { mountApp } from "../../src/app/mount.tsx";
import type { BooksUnlock } from "../../src/data/ledger.ts";
import { createFixtureReader } from "../../src/fixtures/reader.ts";
import { createFixtureWriter } from "../../src/fixtures/writer.ts";
import { createHttpAdapters } from "../../src/http/adapters.ts";
import { AdapterError } from "../../src/http/errors.ts";
import { notConnectedWorker } from "../../src/http/worker-source.ts";
import {
	apiBase,
	fakeFetch,
	manualScheduler,
	memoryStore,
	schoolId,
	sequentialKeys,
} from "./helpers.ts";
import {
	ledgerTokenAnswer,
	pinVerifiedAnswer,
	refundAnswer,
	refusal,
} from "./recorded.ts";
import { adapters, apiCalls } from "./setup.ts";

/**
 * The books PIN reaches the server (S8e part 2): `Writer.unlockBooks` sends `POST /family/pin/verify` (buzz-school
 * `routes/pin.ts`: 200 the session view, 403 `pin_wrong`, 429 `rate_limited` once `PIN_TRIES` are spent), the pin lock
 * opens the books only on the server's yes, and the session it opened carries the money writes.
 */

const refundRequest = {
	schoolId,
	paymentIntentId: "pi_1A2b3C4d5E",
	amountCents: 2500,
	reason: "requested_by_customer",
	note: "double charge",
} as const;

describe("the HTTP Writer's unlockBooks", () => {
	test("sends the PIN to /family/pin/verify and answers unlocked; the PIN is not kept", async () => {
		const { writer, http, storage } = adapters();
		http.on("POST", /pin\/verify$/, { status: 200, body: pinVerifiedAnswer });
		expect(await writer.unlockBooks(schoolId, "2468")).toEqual({
			unlocked: true,
		});
		expect(
			apiCalls(http).map(({ url, body, headers }) => [
				new URL(url).pathname,
				body,
				headers["x-b4u"],
			]),
		).toEqual([["/family/pin/verify", { pin: "2468" }, "1"]]);
		expect([...storage.items.values()].join("")).not.toContain("2468");
	});

	const refusals: Array<[number, string, BooksUnlock]> = [
		[403, "pin_wrong", { unlocked: false, reason: "pin_wrong" }],
		[429, "rate_limited", { unlocked: false, reason: "pin_locked" }],
	];
	for (const [status, code, answer] of refusals)
		test(`${status} ${code} is the answer ${JSON.stringify(answer)}, not a rejection`, async () => {
			const { writer, http } = adapters();
			http.on("POST", /pin\/verify$/, { status, body: refusal(code) });
			expect(await writer.unlockBooks(schoolId, "1111")).toEqual(answer);
		});

	test("any other failure rejects (pin_not_set, a network failure)", async () => {
		const { writer, http } = adapters();
		http.on(
			"POST",
			/pin\/verify$/,
			{ status: 403, body: refusal("pin_not_set") },
			"network",
		);
		for (const kind of ["forbidden", "network"] as const) {
			const error = await writer.unlockBooks(schoolId, "1111").then(
				() => null,
				(caught: unknown) => caught,
			);
			expect(error).toBeInstanceOf(AdapterError);
			expect((error as AdapterError).kind).toBe(kind);
		}
	});

	test("after an unlock the money writes go through on the open session: no pin_required, no PIN asked", async () => {
		const http = fakeFetch();
		http.always("POST", /\/school-admin\/ledger-token$/, {
			status: 200,
			body: ledgerTokenAnswer(),
		});
		http.always("POST", /pin\/verify$/, {
			status: 200,
			body: pinVerifiedAnswer,
		});
		http.always("POST", /refunds$/, { status: 200, body: refundAnswer });
		// buzz-school's session: the money routes answer pin_required until the session's PIN is open.
		let pinOpen = false;
		const pinAsks: string[] = [];
		const { writer } = createHttpAdapters({
			fetch: async (url, init) => {
				const { pathname } = new URL(url);
				if (pathname === "/family/pin/verify") pinOpen = true;
				if (pathname.endsWith("/billing/refunds") && !pinOpen)
					return Response.json(refusal("pin_required"), { status: 403 });
				return http.fetch(url, init);
			},
			apiBase,
			scheduler: manualScheduler(),
			storage: memoryStore(),
			newKey: sequentialKeys(),
			worker: () => notConnectedWorker(),
			files: { save: async () => undefined },
			pinSource: {
				pin: async ({ purpose }) => {
					pinAsks.push(purpose);
					return null;
				},
			},
		});
		const before = await writer.refund(refundRequest).then(
			() => null,
			(caught: unknown) => caught,
		);
		expect((before as AdapterError).kind).toBe("pin_required");
		expect(await writer.unlockBooks(schoolId, "2468")).toEqual({
			unlocked: true,
		});
		const refunded = await writer.refund(refundRequest);
		expect(refunded.refundId).toBe(String(refundAnswer.refundId));
		// Asked once, by the refund before the unlock; the one after needed nothing.
		expect(pinAsks).toEqual(["refund"]);
	});
});

const clock = { today: "2026-11-05", now: "2026-11-05T12:00" };
const macrotask = (): Promise<void> =>
	new Promise((resolve) => setTimeout(resolve, 0));
let unmount: (() => void) | null = null;
afterEach(() => {
	unmount?.();
	unmount = null;
	document.body.innerHTML = "";
	window.location.hash = "";
});

/** The Dashboard behind the PIN, on a Writer whose unlockBooks gives `answers` in turn. */
const lockedDashboard = async (answers: Array<BooksUnlock | Error>) => {
	const asked: Array<[string, string]> = [];
	const writer = {
		...createFixtureWriter({ mode: "instant" }),
		unlockBooks: async (school: string, pin: string) => {
			asked.push([school, pin]);
			const answer = answers.shift();
			if (!answer || answer instanceof Error) throw answer;
			return answer;
		},
	};
	window.location.hash = "#/b4u/dashboard?pin=locked&month=2026-06";
	const root = document.createElement("div");
	root.id = "app";
	document.body.appendChild(root);
	unmount = mountApp(root, {
		reader: createFixtureReader({ clock }),
		writer,
		clock,
	}).unmount;
	for (
		let attempt = 0;
		attempt < 400 && !root.querySelector("[data-test=pin-input]");
		attempt += 1
	)
		await macrotask();
	return { root, asked };
};
const typeAndUnlock = async (root: HTMLElement, pin: string) => {
	const input = root.querySelector<HTMLInputElement>("[data-test=pin-input]");
	if (!input) throw new Error("no PIN input");
	input.value = pin;
	input.dispatchEvent(new Event("input", { bubbles: true }));
	await macrotask();
	root.querySelector<HTMLButtonElement>("[data-test=pin-unlock]")?.click();
	for (let attempt = 0; attempt < 5; attempt += 1) await macrotask();
};
const problemText = (root: HTMLElement) =>
	root.querySelector("[data-test=pin-problem]")?.textContent ?? null;

describe("the pin lock asks the server", () => {
	test("a wrong PIN keeps the books shut and says so; the right one opens them", async () => {
		const { root, asked } = await lockedDashboard([
			{ unlocked: false, reason: "pin_wrong" },
			{ unlocked: true },
		]);
		await typeAndUnlock(root, "1111");
		expect(window.location.hash).toContain("pin=locked");
		expect(problemText(root)).toBe("That is not your family PIN. Try again.");
		expect(
			root.querySelector("[data-test=pin-problem]")?.getAttribute("role"),
		).toBe("alert");
		expect(root.querySelector("[data-test=kpi-card]")).toBeNull();
		await typeAndUnlock(root, "2468");
		expect(window.location.hash).not.toContain("pin=");
		expect(asked).toEqual([
			["b4u", "1111"],
			["b4u", "2468"],
		]);
	});

	test("a locked PIN says to wait; a failed check says to try again; neither opens the books", async () => {
		const { root } = await lockedDashboard([
			{ unlocked: false, reason: "pin_locked" },
			new Error("no answer"),
		]);
		await typeAndUnlock(root, "1111");
		expect(problemText(root)).toBe(
			"Too many tries. Your PIN is locked for a while; try again later.",
		);
		await typeAndUnlock(root, "2222");
		expect(problemText(root)).toBe("Could not check your PIN. Try again.");
		expect(window.location.hash).toContain("pin=locked");
	});
});
