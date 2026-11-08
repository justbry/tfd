import { afterEach, describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { flushSync } from "svelte";
import { AdapterError } from "$contract/http/errors.ts";
import { bytesOf, canonicalJson, sha256Hex } from "$worker-config/canonical.ts";
import type { SettingsConfig } from "$worker-config/types.ts";
import type { MountedApp } from "../../src/app/mount.ts";
import type { ConfigApi } from "../../src/effect/config-client.ts";
import { createHttpConfig } from "../../src/effect/config-http.ts";
import { UiError } from "../../src/effect/ui-error.ts";
import {
	fixtureObjects,
	hashOf,
	settle as settleEffect,
	workerWire,
} from "../s9-3/config-support.ts";
import { fixtureConfigFor, openPane, settle, until } from "../s9-3/harness.ts";

/**
 * The Settings drawer's config writes (S9-plan D18 to D22): the basis, the booking rules and the disclosure are three
 * objects of the ledger's config, each read with its ETag and written by verify then PUT. Beside the Preact golden file S7
 * (golden-s7.test.ts), this file proves what the drawer does with the Worker's answers: the order of the calls and what each
 * carries (the base ETag, the hash of the canonical value), each refusal (412 stale_etag, 422 invalid_config, 403 owner_only,
 * 403 step_up_required) in the message table's words and at the field, a PUT whose answer was lost and is sent again, that
 * an admin and a preview write nothing, that a school with nothing stored starts from the Reader's settings, and that what
 * the build cannot do says so with the action off and its reason reachable.
 */
let mounted: MountedApp | undefined;
afterEach(async () => {
	await mounted?.unmount();
	mounted = undefined;
	document.body.innerHTML = "";
});
const one = (selector: string): HTMLElement | null =>
	document.querySelector<HTMLElement>(selector);
const all = (selector: string): HTMLElement[] => [
	...document.querySelectorAll<HTMLElement>(selector),
];
const text = (selector: string): string =>
	(one(selector)?.textContent ?? "").replace(/\s+/g, " ").trim();
const toasts = (app: MountedApp) => [
	...app.toasts.state.visible,
	...app.toasts.state.waiting,
];
const click = async (selector: string): Promise<void> => {
	await until(() => one(selector) !== null, `${selector} to exist`, 800);
	one(selector)?.click();
	flushSync();
	await settle(document.body);
};
const type = (selector: string, value: string): void => {
	const input = one(selector) as HTMLInputElement;
	input.value = value;
	input.dispatchEvent(new Event("input", { bubbles: true }));
	flushSync();
};
const pause = async (milliseconds: number): Promise<void> => {
	await new Promise((resolve) => setTimeout(resolve, milliseconds));
	flushSync();
};
const tick = async (turns = 20): Promise<void> => {
	for (let turn = 0; turn < turns; turn += 1) await pause(0);
};
const notAvailable = () =>
	new AdapterError("not_available", "no source", { code: "not_available" });

async function openSettings(
	route = "#/vol/plans?theme=light",
	options: Parameters<typeof openPane>[1] = {},
) {
	const opened = await openPane(route, options);
	mounted = opened.app;
	await tick(40);
	(one("[data-test=settings-button]") as HTMLElement).click();
	flushSync();
	await until(
		() =>
			one("[data-test=basis-option]") !== null ||
			one("[data-test=settings-basis-not-available]") !== null ||
			one("[data-test=load-failed]") !== null,
		"the settings",
		1200,
	);
	await tick();
	return opened;
}
const calls = (
	config: { calls: ReadonlyArray<{ method: string; args: unknown[] }> },
	...methods: string[]
) => config.calls.filter(({ method }) => methods.includes(method));

describe("the basis: verify, then PUT over the ETag it was read at", () => {
	test("a school with nothing stored starts from the Reader's settings; the first Save is a create (no base ETag) of the canonical value", async () => {
		const { config } = await openSettings();
		expect(calls(config, "get").map(({ args }) => args.slice(0, 2))).toEqual([
			["vol", "settings"],
			["vol", "booking-rules"],
			["vol", "disclosure"],
		]);
		// Nothing was edited, so nothing was verified: the seed waits for the person's change.
		expect(calls(config, "verify")).toEqual([]);
		expect(
			one("[data-test=basis-option][data-basis=cash]")?.getAttribute(
				"aria-pressed",
			),
		).toBe("true");
		await click("[data-test=basis-option][data-basis=deferred]");
		await click("[data-test=basis-save]");
		await until(() => calls(config, "put").length === 1, "the put");
		const [verify] = calls(config, "verify");
		const [put] = calls(config, "put");
		expect(verify?.args.slice(0, 2)).toEqual(["vol", "settings"]);
		const sent = put?.args[2] as SettingsConfig;
		expect(sent.basis).toBe("deferred");
		expect(sent.school).toBe("vol");
		expect(put?.args[3]).toBe(await hashOf(sent));
		expect(put?.args[4]).toBeNull();
		expect(
			config.calls
				.map(({ method }) => method)
				.filter((method) => method !== "get"),
		).toEqual(["verify", "put"]);
		await until(
			() =>
				text("[data-test=settings-basis-etag]").includes("Stored copy ETag"),
			"the new ETag",
		);
		expect(config.peek("vol", "settings")?.etag).toBe(await hashOf(sent));
		expect(text("[data-test=settings-basis-etag]")).toContain(
			(await hashOf(sent)).slice(0, 8),
		);
		expect(toasts(mounted as MountedApp).map(({ title }) => title)).toContain(
			"Accounting basis saved: deferred from Dec 1. Logged as a policy change.",
		);
	});
	test("a stored object is the one shown and the one the next PUT is over (If-Match its ETag), whatever the Reader says", async () => {
		const store = fixtureConfigFor();
		const stored = (await fixtureObjects("vol", "vol")).settings;
		await store.writeBehind("vol", "settings", {
			...stored,
			basis: "deferred",
			basisFrom: "2027-01-01",
		});
		const etag = store.peek("vol", "settings")?.etag;
		await openSettings("#/vol/plans?theme=light", { config: store });
		expect(
			one("[data-test=basis-option][data-basis=deferred]")?.getAttribute(
				"aria-pressed",
			),
		).toBe("true");
		expect((one("[data-test=basis-from]") as HTMLInputElement).value).toBe(
			"2027-01-01",
		);
		type("[data-test=basis-from]", "2027-02-01");
		await click("[data-test=basis-save]");
		await until(() => calls(store as never, "put").length === 1, "the put");
		const [put] = calls(store as never, "put");
		expect(put?.args[4]).toBe(etag);
		expect((put?.args[2] as SettingsConfig).basisFrom).toBe("2027-02-01");
	});
	test("the same request goes over HTTP as the Worker's route wants it: If-Match, then the verified hash in the body", async () => {
		const store = fixtureConfigFor();
		const stored = (await fixtureObjects("vol", "vol")).settings;
		await store.writeBehind("vol", "settings", stored);
		const wire = workerWire(store);
		const http = createHttpConfig({
			fetch: wire.fetch,
			base: "/v1",
			tokens: wire.tokens,
		});
		await openSettings("#/vol/plans?theme=light", { config: http });
		await click("[data-test=basis-option][data-basis=deferred]");
		await click("[data-test=basis-save]");
		await until(
			() => wire.seen.some(({ method }) => method === "PUT"),
			"the put",
		);
		const put = wire.seen.find(({ method }) => method === "PUT");
		expect(put?.headers["If-Match"] ?? put?.headers["if-match"]).toBe(
			`"${store.peek("vol", "settings")?.etag ? await hashOf(stored) : ""}"`,
		);
		expect((put?.body as { verifiedHash: string }).verifiedHash).toMatch(
			/^[0-9a-f]{64}$/,
		);
		expect(
			wire.seen.filter(({ url }) => url.endsWith("/settings/verify")).length,
		).toBeGreaterThanOrEqual(1);
	});
});

describe("each refusal of the Worker is shown in the message table's words", () => {
	test("422 invalid_config: the problem is at its field (and in one summary toast), Save writes nothing, and fixing it verifies again", async () => {
		const { config } = await openSettings();
		type("[data-test=basis-from]", "");
		await until(
			() => one("[data-test=basis-from][aria-invalid=true]") !== null,
			"the problem at the field",
			1500,
		);
		expect(all("[data-test=inline-error] div").length).toBeGreaterThan(0);
		expect(
			toasts(mounted as MountedApp).some(
				({ title }) => title === "Some fields need a change",
			),
		).toBe(true);
		expect((one("[data-test=basis-save]") as HTMLButtonElement).disabled).toBe(
			true,
		);
		expect(calls(config, "put")).toEqual([]);
		type("[data-test=basis-from]", "2027-03-01");
		await until(
			() =>
				one("[data-test=basis-from][aria-invalid=true]") === null &&
				!(one("[data-test=basis-save]") as HTMLButtonElement).disabled,
			"the fix",
			1500,
		);
		expect(
			toasts(mounted as MountedApp).some(
				({ title }) => title === "Some fields need a change",
			),
		).toBe(false);
	});
	test("422 on the booking rules shows the Worker's message at the field it names", async () => {
		await openSettings();
		type("[data-test=rules-field][data-field=cancelCutoffHours]", "100000");
		await until(
			() =>
				one(
					"[data-test=rules-field][data-field=cancelCutoffHours][aria-invalid=true]",
				) !== null,
			"the field's problem",
			1500,
		);
		expect((one("[data-test=rules-save]") as HTMLButtonElement).disabled).toBe(
			true,
		);
		expect(text("[data-test=settings-rules-status]")).toContain("1 problem");
	});
	test("412 stale_etag: the person's copy is not saved over theirs; the difference and Reload are offered; Reload reads theirs", async () => {
		const store = fixtureConfigFor();
		const stored = (await fixtureObjects("vol", "vol")).settings;
		await store.writeBehind("vol", "settings", stored);
		await openSettings("#/vol/plans?theme=light", { config: store });
		await click("[data-test=basis-option][data-basis=deferred]");
		await until(
			() => calls(store as never, "verify").length >= 1,
			"the verify",
			1500,
		);
		// Someone else saves in between: the next verdict is over their ETag.
		await store.writeBehind("vol", "settings", {
			...stored,
			basisFrom: "2030-01-01",
		});
		type("[data-test=basis-from]", "2027-05-05");
		await until(
			() => one("[data-test=settings-basis-conflict]") !== null,
			"the conflict",
			1500,
		);
		expect(text("[data-test=settings-basis-conflict]")).toContain(
			"Someone changed this. Review their change",
		);
		expect(all("[data-test=settings-basis-diff]").length).toBeGreaterThan(0);
		expect((one("[data-test=basis-save]") as HTMLButtonElement).disabled).toBe(
			true,
		);
		expect(calls(store as never, "put")).toEqual([]);
		await click("[data-test=settings-basis-reload]");
		await until(
			() =>
				(one("[data-test=basis-from]") as HTMLInputElement | null)?.value ===
				"2030-01-01",
			"their copy",
			1500,
		);
		expect(one("[data-test=settings-basis-conflict]")).toBeNull();
	});
	test("403 step_up_required: Confirm it is you asks for the PIN, opens the session, takes a new token and saves", async () => {
		const store = fixtureConfigFor();
		store.setStepUp(false);
		const { writer } = await openSettings("#/vol/plans?theme=light", {
			config: store,
		});
		await click("[data-test=basis-option][data-basis=deferred]");
		await click("[data-test=basis-save]");
		await until(
			() => one("[data-test=settings-basis-step-up]") !== null,
			"the step-up panel",
			1500,
		);
		expect(
			toasts(mounted as MountedApp).some(
				({ title }) => title === "Confirm it is you",
			),
		).toBe(true);
		expect(store.peek("vol", "settings")).toBeNull();
		store.setStepUp(true);
		type("[data-test=settings-basis-pin]", "1234");
		await click("[data-test=settings-basis-confirm]");
		await until(
			() => store.peek("vol", "settings") !== null,
			"the saved object",
			1500,
		);
		expect(store.sessionRefreshes()).toBe(1);
		expect(one("[data-test=settings-basis-step-up]")).toBeNull();
		expect(writer.calls).toEqual([]);
	});
	test("403 owner_only: nothing is saved and the toast says whose change it is", async () => {
		const store = fixtureConfigFor();
		const refusing: ConfigApi = {
			...store,
			put: () =>
				Effect.fail(
					new UiError({
						kind: "forbidden",
						detail: { status: 403, code: "owner_only" },
						reason: "403 owner_only",
						retryable: false,
					}),
				),
		};
		await openSettings("#/vol/plans?theme=light", { config: refusing });
		await click("[data-test=basis-option][data-basis=deferred]");
		await click("[data-test=basis-save]");
		await until(
			() =>
				toasts(mounted as MountedApp).some(
					({ title }) => title === "Owners only",
				),
			"the toast",
			1500,
		);
		expect(text("[data-test=basis-save]")).toBe("Save");
		expect(one("[data-test=toast-action]")).toBeNull();
	});
});

describe("a PUT whose answer was lost is sent again and is still one write", () => {
	test("the object landed, the answer did not: the retry meets 412, reads it back, finds its own hash, and says saved", async () => {
		const store = fixtureConfigFor();
		const stored = (await fixtureObjects("vol", "vol")).settings;
		await store.writeBehind("vol", "settings", stored);
		let puts = 0;
		const flaky: ConfigApi = {
			...store,
			put: (school, name, value, hash, base) =>
				Effect.suspend(() => {
					puts += 1;
					const landing = store.put(school, name, value, hash, base);
					if (puts > 1) return landing;
					return Effect.flatMap(landing, () =>
						Effect.fail(
							new UiError({
								kind: "unavailable",
								detail: { status: 503 },
								reason: "503",
								retryable: true,
							}),
						),
					);
				}),
		};
		await openSettings("#/vol/plans?theme=light", { config: flaky });
		await click("[data-test=basis-option][data-basis=deferred]");
		await click("[data-test=basis-save]");
		await until(
			() => text("[data-test=settings-basis-status]") === "Saved to the ledger",
			"the save",
			6000,
		);
		expect((store.peek("vol", "settings")?.value as SettingsConfig).basis).toBe(
			"deferred",
		);
		expect(
			toasts(mounted as MountedApp).filter(({ tone }) => tone === "error"),
		).toEqual([]);
		expect(puts).toBeGreaterThanOrEqual(2);
	}, 15_000);
});

describe("the disclosure: PIN, verify, PUT; the mailed link is not available", () => {
	test("Check and save asks for the PIN, opens the session, then verifies and puts the override; no Writer write is made", async () => {
		const { config, writer } = await openSettings();
		const select = (field: string, value: string) =>
			type(`[data-test=override-field][data-field=${field}]`, value);
		select("every", "month");
		await click("[data-test=disclosure-save]");
		expect(text("[data-test=dialog-title]")).toBe("Save the disclosure change");
		type("[data-test=dialog-field][data-field=pin]", "1234");
		await click("[data-test=dialog-confirm]");
		await until(() => calls(config, "put").length === 1, "the put", 1500);
		const [put] = calls(config, "put");
		expect(put?.args[1]).toBe("disclosure");
		expect(JSON.stringify(put?.args[2])).toContain('"every":"month"');
		expect(config.sessionRefreshes()).toBe(1);
		expect(writer.calls).toEqual([]);
		await until(
			() => one("[data-test=dialog]") === null,
			"the dialog to close",
		);
		expect(toasts(mounted as MountedApp).map(({ title }) => title)).toContain(
			"Disclosure saved. Logged as books.disclosure_changed; applies from the next document build.",
		);
		expect(text("[data-test=settings-books-etag]")).toContain(
			"Stored copy ETag",
		);
	});
	test("a change that opens Public cannot be saved: the button is aria-disabled and focusable, its reason is on the page and in its description, and nothing is sent", async () => {
		const { config } = await openSettings();
		type("[data-test=override-field][data-field=rule-audience]", "public");
		type("[data-test=override-field][data-field=every]", "quarter");
		await tick();
		const button = one("[data-test=disclosure-save]") as HTMLButtonElement;
		expect(button.disabled).toBe(false);
		expect(button.getAttribute("aria-disabled")).toBe("true");
		expect(button.title).toContain("Not available yet");
		const described = button.getAttribute("aria-describedby") ?? "";
		expect(document.getElementById(described)?.textContent).toContain(
			"no route sends it yet",
		);
		button.focus();
		expect(document.activeElement).toBe(button);
		button.click();
		await tick();
		expect(one("[data-test=dialog]")).toBeNull();
		expect(calls(config, "put")).toEqual([]);
	});
	test("a wrong PIN is said in the dialog and saves nothing", async () => {
		const { config } = await openSettings("#/vol/plans?theme=light", {
			writerWrap: (writer) =>
				({
					...writer,
					unlockBooks: async () => ({ unlocked: false, reason: "pin_wrong" }),
				}) as never,
		});
		type("[data-test=override-field][data-field=every]", "month");
		await click("[data-test=disclosure-save]");
		type("[data-test=dialog-field][data-field=pin]", "0000");
		await click("[data-test=dialog-confirm]");
		await until(
			() => text("[data-test=dialog-pin-problem]") !== "",
			"the PIN's problem",
			1500,
		);
		expect(text("[data-test=dialog-pin-problem]")).toContain(
			"That PIN is not right",
		);
		expect(calls(config, "put")).toEqual([]);
		expect(one("[data-test=dialog]")).not.toBeNull();
	});
});

describe("who may write, and what a build cannot do yet", () => {
	test("an admin reads: every write control is off, and no verify or put is ever sent", async () => {
		const { config } = await openSettings("#/b4u/plans?theme=light");
		expect(text("[data-test=settings-readonly]")).toContain("Owners only");
		for (const selector of [
			"basis-option",
			"basis-from",
			"basis-save",
			"key-create",
			"stripe-connect",
			"zeffy-connect",
			"rules-save",
			"rules-field",
		])
			for (const control of all(`[data-test=${selector}]`))
				expect((control as HTMLButtonElement).disabled).toBe(true);
		expect(all("[data-test=override-field][disabled]").length).toBe(8);
		await tick(30);
		expect(calls(config, "verify", "put")).toEqual([]);
	});
	test("while previewing another audience every write control is off with the preview's title", async () => {
		const { config, writer } = await openSettings(
			"#/vol/plans?theme=light&as=governance",
		);
		for (const selector of [
			"basis-save",
			"basis-option",
			"key-create",
			"stripe-connect",
			"zeffy-connect",
			"rules-save",
		])
			for (const control of all(`[data-test=${selector}]`)) {
				expect((control as HTMLButtonElement).disabled).toBe(true);
				expect((control as HTMLButtonElement).title).toBe(
					"Exit preview to act",
				);
			}
		expect(calls(config, "verify", "put")).toEqual([]);
		expect(writer.calls).toEqual([]);
	});
	test("settings nothing provides yet (no stored object, no Reader source) say so in place, with Check again; the books table still shows the school's disclosure", async () => {
		await openSettings("#/vol/plans?theme=light", {
			reader: (fixture) =>
				({
					...fixture,
					settings: () => Promise.reject(notAvailable()),
				}) as unknown as ReturnType<typeof fixture.schools> extends never
					? never
					: typeof fixture,
		});
		await until(
			() => one("[data-test=settings-basis-not-available]") !== null,
			"the message",
			1500,
		);
		expect(text("[data-test=settings-basis-not-available]")).toContain(
			"Not available yet",
		);
		expect(one("[data-test=settings-rules-not-available]")).not.toBeNull();
		expect(one("[data-test=basis-option]")).toBeNull();
		expect(one("[data-test=key-row]")).toBeNull();
		expect(all("[data-test=disclosure-row]").length).toBe(6);
		expect(text("body")).not.toMatch(/\bNaN\b|\bundefined\b|\[object/);
		expect(one("[data-test=not-available-check]")).not.toBeNull();
	});
	test("a Writer that has no route for Zeffy: the dialog says so, and the button is then aria-disabled with its reason, still focusable", async () => {
		const { writer } = await openSettings("#/vol/plans?theme=light", {
			writerWrap: (fixture) =>
				({
					...fixture,
					saveZeffyKey: () => Promise.reject(notAvailable()),
				}) as never,
		});
		await click("[data-test=zeffy-connect]");
		type(
			"[data-test=dialog-field][data-field=apiKey]",
			"zeffy-example-key-0001",
		);
		await click("[data-test=dialog-confirm]");
		await until(
			() => one("[data-test=dialog-failure]") !== null,
			"the failure in the dialog",
			1500,
		);
		expect(text("[data-test=dialog-failure]")).toContain("Not available yet");
		await click("[data-test=dialog-cancel]");
		const button = one("[data-test=zeffy-connect]") as HTMLButtonElement;
		expect(button.disabled).toBe(false);
		expect(button.getAttribute("aria-disabled")).toBe("true");
		expect(
			document.getElementById(button.getAttribute("aria-describedby") ?? "")
				?.textContent,
		).toContain("Not available yet");
		button.click();
		await tick();
		expect(one("[data-test=dialog]")).toBeNull();
		expect(writer.calls).toEqual([]);
	});
});

describe("keys and connections go through the Writer, applied when it answers", () => {
	test("a key made is listed only after the Writer answered, and a Writer that fails leaves the list as it was, with a Retry toast that resends the same request", async () => {
		let attempts = 0;
		const requests: unknown[] = [];
		await openSettings("#/vol/plans?theme=light", {
			writerWrap: (fixture) =>
				({
					...fixture,
					createKey: (request: unknown) => {
						requests.push(request);
						attempts += 1;
						if (attempts <= 3)
							return Promise.reject(
								new AdapterError("unavailable", "catching up", { status: 503 }),
							);
						return (
							fixture.createKey as (request: unknown) => Promise<unknown>
						)(request);
					},
				}) as never,
		});
		await click("[data-test=key-create]");
		await click("[data-test=key-create-option][data-kind=pk]");
		type("[data-test=dialog-field][data-field=label]", "Docs site");
		await click("[data-test=dialog-confirm]");
		await until(
			() =>
				toasts(mounted as MountedApp).some(
					({ title }) => title === "The ledger is catching up",
				),
			"the failure",
			4000,
		);
		expect(all("[data-test=key-row]").length).toBe(3);
		expect(one("[data-test=dialog]")).not.toBeNull();
		await click("[data-test=toast-action]");
		await until(() => all("[data-test=key-row]").length === 4, "the key", 3000);
		expect(
			new Set(requests.map((request) => JSON.stringify(request))).size,
		).toBe(1);
		expect(text("[data-test=dialog-title]")).toBe("Key created");
	}, 20_000);
	test("leaving the drawer before a sent write answers: it is not aborted, and its answer toasts nothing", async () => {
		const { writer, app } = await openSettings("#/vol/plans?theme=light", {
			writer: "hold",
		});
		await click("[data-test=key-create]");
		await click("[data-test=key-create-option][data-kind=pk]");
		await click("[data-test=dialog-confirm]");
		expect(writer.calls.map(({ method }) => method)).toEqual(["createKey"]);
		window.location.hash = "#/b4u/plans?theme=light";
		window.dispatchEvent(new Event("hashchange"));
		await tick(40);
		writer.release();
		await tick(40);
		expect(toasts(app).filter(({ tone }) => tone === "success")).toEqual([]);
	});
});

test("canonical JSON and the hash the drawer sends are the Worker's own (a spot check of the import)", async () => {
	const value = { b: 1, a: 2 };
	expect(await sha256Hex(bytesOf(canonicalJson(value)))).toBe(
		await hashOf(value),
	);
	expect((await settleEffect(Effect.succeed(1))).ok).toBe(true);
});
