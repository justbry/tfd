import { afterEach, describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { flushSync } from "svelte";
import { canonicalJson } from "$worker-config/canonical.ts";
import type { PlansDraftConfig } from "$worker-config/types.ts";
import type { MountedApp } from "../../src/app/mount.ts";
import { UiError } from "../../src/effect/ui-error.ts";
import { hashOf } from "./config-support.ts";
import {
	fixtureConfigFor,
	macrotask,
	openPane,
	settle,
	until,
} from "./harness.ts";

/**
 * The Plans tab's copy in the ledger (S9-plan D18, D22): the `plans-draft` config object edited through the ConfigClient:
 * read, verified on every pause in editing, problems at the field and in one summary toast, Save only for a verified value
 * over a fresh base, the PUT, a 412's difference and Reload, and the 403 `step_up_required`'s "Confirm it is you".
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
const nameField = (tier: string): string =>
	`[data-test=ledger-copy-tier][data-tier=${tier}] [data-field=name]`;
const save = (): HTMLButtonElement =>
	one("[data-test=ledger-copy-save]") as HTMLButtonElement;

async function openCopy(
	route = "#/vol/plans?theme=light",
	options: Parameters<typeof openPane>[1] = {},
) {
	const opened = await openPane(route, options);
	mounted = opened.app;
	await settle(opened.root);
	(one("[data-test=plan-ledger-copy]") as HTMLElement).click();
	await until(
		() => one("[data-test=ledger-copy-tier]") !== null,
		"the copy to load",
	);
	return opened;
}

/** The copy a school with nothing stored yet starts from: the draft menu's names, order and audiences, never a price. */
const seeded = (): PlansDraftConfig => ({
	schemaVersion: 1,
	draftVersion: 4,
	features: [
		{
			id: "sessions",
			name: "Sessions",
			unit: { one: "session", other: "sessions" },
		},
	],
	tierOrder: ["sparkle", "shine", "glow"],
	tiers: [
		{
			id: "sparkle",
			name: "Sparkle",
			blurb: "A little time, every month",
			public: true,
		},
		{ id: "shine", name: "Shine", blurb: "Regular sessions", public: true },
		{ id: "glow", name: "Glow", blurb: "One big plan", public: true },
	],
	purchaseLinkShared: true,
});

describe("opening the copy", () => {
	test("a school with nothing stored starts from its draft menu (no price in it), verified at once, and the first Save is a create", async () => {
		const { config } = await openCopy();
		expect(
			all("[data-test=ledger-copy-tier]").map((tier) => tier.dataset.tier),
		).toEqual(["sparkle", "shine", "glow"]);
		expect(config.calls.map(({ method }) => method)).toEqual(["get", "verify"]);
		expect(JSON.stringify(config.calls[1]?.args[2])).not.toMatch(
			/"(prices?|amount|monthlyMinor|interval)"/,
		);
		await until(() => !save().disabled, "Save to turn on");
		expect(text("[data-test=ledger-copy-status]")).toBe(
			"Verified: ready to save",
		);
		save().click();
		await until(
			() => text("[data-test=ledger-copy-status]") === "Saved to the ledger",
			"the save",
		);
		const put = config.calls.find(({ method }) => method === "put");
		// Over a new object: no base ETag (If-None-Match: *), and the hash of the canonical value.
		expect(put?.args[4]).toBeNull();
		expect(put?.args[3]).toBe(await hashOf(seeded()));
		expect(config.peek("vol", "plans-draft")).toEqual({
			value: seeded(),
			etag: await hashOf(seeded()),
		});
		expect(canonicalJson(config.peek("vol", "plans-draft")?.value)).toContain(
			'"schemaVersion": 1',
		);
	});

	test("a stored copy is read with its ETag and shown as stored; nothing is verified or changed until an edit", async () => {
		const opened = await openPane("#/vol/plans?theme=light");
		mounted = opened.app;
		await settle(opened.root);
		const stored = { ...seeded(), tierOrder: ["glow", "shine", "sparkle"] };
		await opened.config.writeBehind("vol", "plans-draft", stored);
		(one("[data-test=plan-ledger-copy]") as HTMLElement).click();
		await until(
			() => one("[data-test=ledger-copy-tier]") !== null,
			"the copy to load",
		);
		expect(
			all("[data-test=ledger-copy-tier]").map((tier) => tier.dataset.tier),
		).toEqual(["glow", "shine", "sparkle"]);
		expect(opened.config.calls.map(({ method }) => method)).toEqual(["get"]);
		expect(save().disabled).toBe(true);
		expect(save().title).toBe("Nothing to save");
		expect(text("[data-test=ledger-copy-status]")).toBe("No changes yet");
	});

	test("an admin cannot open it: the button is off and says the owner writes the copy", async () => {
		const opened = await openPane("#/b4u/plans?theme=light");
		mounted = opened.app;
		await settle(opened.root);
		const button = one("[data-test=plan-ledger-copy]") as HTMLButtonElement;
		expect(button.disabled).toBe(true);
		expect(button.title).toBe("Owners write the copy in the ledger");
	});
});

describe("editing: verify on every pause, problems where they are", () => {
	test("an edit is verified after a pause, not on every key; Save waits for it, then turns on for the verified value", async () => {
		const { config } = await openCopy();
		await until(() => !save().disabled, "the first verify");
		const verifies = (): number =>
			config.calls.filter(({ method }) => method === "verify").length;
		expect(verifies()).toBe(1);
		type(nameField("glow"), "Gl");
		type(nameField("glow"), "Glo");
		type(nameField("glow"), "Glow Plus");
		expect(save().disabled).toBe(true);
		expect(save().title).toBe("Checking the copy…");
		expect(verifies()).toBe(1);
		await until(() => verifies() === 2, "the verify after the pause");
		await until(() => !save().disabled, "Save to turn on");
		const lastVerified = config.calls.filter(
			({ method }) => method === "verify",
		)[1]?.args[2] as PlansDraftConfig;
		expect(lastVerified.tiers.find(({ id }) => id === "glow")?.name).toBe(
			"Glow Plus",
		);
		save().click();
		await until(
			() => text("[data-test=ledger-copy-status]") === "Saved to the ledger",
			"the save",
		);
		expect(
			(config.peek("vol", "plans-draft")?.value as PlansDraftConfig).tiers[2]
				?.name,
		).toBe("Glow Plus");
	});

	test("a value with problems shows each at its field and as one summary toast, and Save stays off until they are fixed", async () => {
		const { app, config } = await openCopy();
		await until(() => !save().disabled, "the first verify");
		type(nameField("glow"), "");
		const glowError =
			"[data-test=ledger-copy-tier][data-tier=glow] [data-test=inline-error]";
		await until(
			() => one(glowError)?.textContent?.includes("must not be empty") === true,
			"the problem at the field",
		);
		const atField = one(glowError);
		expect(atField?.textContent).toContain("must not be empty");
		expect(atField?.textContent).toContain("Fill it in.");
		expect(
			(one(nameField("glow")) as HTMLInputElement).getAttribute("aria-invalid"),
		).toBe("true");
		expect(save().disabled).toBe(true);
		expect(save().title).toBe("Fix the fields marked first");
		const summaries = toasts(app).filter(
			(toast) => toast.title === "Some fields need a change",
		);
		expect(summaries.length).toBe(1);
		expect(summaries[0]?.detail).toBe("1 field needs a change.");
		expect(summaries[0]?.action?.label).toBe("Show the problems");
		// The summary's action goes to the first marked field.
		summaries[0]?.action?.run();
		expect(document.activeElement).toBe(one(nameField("glow")));
		type(nameField("glow"), "Glow");
		await until(() => !save().disabled, "Save to turn on again");
		await until(
			() =>
				!toasts(app).some(
					(toast) => toast.title === "Some fields need a change",
				),
			"the summary to leave",
		);
		expect(config.peek("vol", "plans-draft")).toBeNull();
	});

	test("a verify that a newer edit overtook makes no toast and no log entry, and its answer is never used", async () => {
		const base = fixtureConfigFor();
		let verifies = 0;
		const config = {
			...base,
			verify: ((...args: Parameters<typeof base.verify>) => {
				verifies += 1;
				if (verifies !== 2) return base.verify(...args);
				// The verify of the first edit is slow and would fail: the second edit overtakes it.
				return Effect.promise(
					() => new Promise<void>((resolve) => setTimeout(resolve, 120)),
				).pipe(
					Effect.flatMap(() =>
						Effect.fail(
							new UiError({
								kind: "network",
								detail: {},
								reason: "late",
								retryable: false,
							}),
						),
					),
				);
			}) as typeof base.verify,
		};
		const opened = await openCopy("#/vol/plans?theme=light", { config });
		await until(() => !save().disabled, "the first verify");
		type(nameField("glow"), "One");
		await until(() => verifies === 2, "the verify of the first edit");
		type(nameField("glow"), "Two");
		await until(() => verifies === 3, "the verify of the second edit");
		await until(() => !save().disabled, "Save to turn on for the newer value");
		await pause(200);
		expect(
			opened.app.toasts.state.visible.filter((toast) => toast.tone === "error"),
		).toEqual([]);
		expect(opened.log.entries()).toEqual([]);
		expect(save().disabled).toBe(false);
		save().click();
		await until(
			() => text("[data-test=ledger-copy-status]") === "Saved to the ledger",
			"the save",
		);
		expect(
			(base.peek("vol", "plans-draft")?.value as PlansDraftConfig).tiers[2]
				?.name,
		).toBe("Two");
	});
});

describe("saving: stale, step-up, retry", () => {
	test("a copy someone else changed is a conflict: the difference, Save off, and Reload brings their copy", async () => {
		const { config } = await openCopy();
		await until(() => !save().disabled, "the first verify");
		save().click();
		await until(
			() => text("[data-test=ledger-copy-status]") === "Saved to the ledger",
			"the first save",
		);
		const theirs: PlansDraftConfig = { ...seeded(), purchaseLinkShared: false };
		await config.writeBehind("vol", "plans-draft", theirs);
		type(nameField("glow"), "Glow Two");
		await until(
			() => one("[data-test=ledger-copy-conflict]") !== null,
			"the conflict",
		);
		expect(save().disabled).toBe(true);
		expect(save().title).toBe("Someone changed this: reload first");
		expect(
			all("[data-test=ledger-copy-diff]").map((entry) =>
				entry.textContent?.trim(),
			),
		).toContain('tiers[2].name: "Glow" → "Glow Two"');
		(one("[data-test=ledger-copy-reload]") as HTMLElement).click();
		await until(
			() =>
				one("[data-test=ledger-copy-conflict]") === null &&
				(one(nameField("glow")) as HTMLInputElement).value === "Glow",
			"their copy",
		);
		expect(
			(
				one(
					"[data-test=ledger-copy-field][data-field=purchaseLinkShared]",
				) as HTMLInputElement
			).checked,
		).toBe(false);
	});

	test("a 412 on the PUT itself shows the toast 'Someone changed this' with Reload, and the difference", async () => {
		const { app, config } = await openCopy();
		await until(() => !save().disabled, "the first verify");
		// Verified over the ETag it was read at (none), then someone writes the object before the person saves.
		await config.writeBehind("vol", "plans-draft", {
			...seeded(),
			purchaseLinkShared: false,
		});
		save().click();
		await until(
			() =>
				toasts(app).some(
					(toast) =>
						toast.title === "Someone changed this. Review their change",
				),
			"the 412 toast",
		);
		const toast = toasts(app).find(
			(entry) => entry.title === "Someone changed this. Review their change",
		);
		expect(toast?.tone).toBe("error");
		expect(toast?.action?.label).toBe("Reload");
		await until(
			() => one("[data-test=ledger-copy-conflict]") !== null,
			"the difference",
		);
		expect(config.peek("vol", "plans-draft")?.value).toEqual({
			...seeded(),
			purchaseLinkShared: false,
		});
		toast?.action?.run();
		await until(
			() =>
				one("[data-test=ledger-copy-conflict]") === null &&
				save().title === "Nothing to save",
			"the reload",
		);
	});

	test("a 403 step_up_required is the toast 'Confirm it is you' with its action, and the sheet asks for the PIN; confirming saves", async () => {
		const { app, config } = await openCopy();
		await until(() => !save().disabled, "the first verify");
		config.setStepUp(false);
		save().click();
		await until(
			() => toasts(app).some((toast) => toast.title === "Confirm it is you"),
			"the step-up toast",
		);
		const toast = toasts(app).find(
			(entry) => entry.title === "Confirm it is you",
		);
		expect(toast?.action?.label).toBe("Confirm it is you");
		expect(config.peek("vol", "plans-draft")).toBeNull();
		await until(
			() => one("[data-test=ledger-copy-step-up]") !== null,
			"the PIN panel",
		);
		type("[data-test=ledger-copy-pin]", "1234");
		// The new ledger token carries the step-up: the Worker accepts the write from then on.
		config.setStepUp(true);
		(one("[data-test=ledger-copy-confirm]") as HTMLElement).click();
		await until(
			() => text("[data-test=ledger-copy-status]") === "Saved to the ledger",
			"the save after the confirmation",
		);
		expect(config.sessionRefreshes()).toBe(1);
		expect(one("[data-test=ledger-copy-step-up]")).toBeNull();
		expect(config.peek("vol", "plans-draft")).not.toBeNull();
	});

	test("until buzz-school ships the su claim every real PUT is a 403 step_up_required: confirming still shows it properly, once more", async () => {
		const { app, config } = await openCopy();
		await until(() => !save().disabled, "the first verify");
		config.setStepUp(false);
		save().click();
		await until(
			() => one("[data-test=ledger-copy-step-up]") !== null,
			"the PIN panel",
		);
		type("[data-test=ledger-copy-pin]", "1234");
		(one("[data-test=ledger-copy-confirm]") as HTMLElement).click();
		await until(
			() =>
				toasts(app).some(
					(toast) => toast.title === "Confirm it is you" && toast.count > 1,
				),
			"the second refusal",
		);
		expect(one("[data-test=ledger-copy-step-up]")).not.toBeNull();
		expect(config.peek("vol", "plans-draft")).toBeNull();
	});

	test("a PUT whose answer was lost is retried with the same verified hash and base, and lands once (the retry meets its own write)", async () => {
		const base = fixtureConfigFor();
		let puts = 0;
		const config = {
			...base,
			put: ((...args: Parameters<typeof base.put>) =>
				Effect.suspend(() => {
					puts += 1;
					const attempt = puts;
					return base.put(...args).pipe(
						// The first try reaches the store and writes; its answer is lost.
						Effect.flatMap((done) =>
							attempt === 1
								? Effect.fail(
										new UiError({
											kind: "network",
											detail: {},
											reason: "no answer",
											retryable: true,
										}),
									)
								: Effect.succeed(done),
						),
					);
				})) as typeof base.put,
		};
		const opened = await openCopy("#/vol/plans?theme=light", { config });
		await until(() => !save().disabled, "the first verify");
		save().click();
		await until(
			() => text("[data-test=ledger-copy-status]") === "Saved to the ledger",
			"the retried save",
			3000,
		);
		// The same effect ran twice (the retry re-runs it, it does not build another request): the second run met the 412 of
		// its own write, read the object (the reconcile `get`), found it at its verified hash, and ended as saved.
		expect(puts).toBe(2);
		expect(base.calls.map(({ method }) => method)).toEqual([
			"get",
			"verify",
			"put",
			"put",
			"get",
		]);
		const [first, second] = base.calls.filter(({ method }) => method === "put");
		// The retry carries what the first try did: the same value, the same verified hash, the same (absent) base.
		expect(second?.args).toEqual(first?.args as unknown[]);
		expect(first?.args[3]).toBe(await hashOf(seeded()));
		expect(first?.args[4]).toBeNull();
		expect(
			toasts(opened.app).filter(
				(toast) => toast.title === "Someone changed this. Review their change",
			),
		).toEqual([]);
		expect(base.peek("vol", "plans-draft")?.etag).toBe(await hashOf(seeded()));
	}, 15_000);

	test("closing the sheet cancels what is on its way: a read still pending leaves no toast and no log entry", async () => {
		const base = fixtureConfigFor();
		let release: () => void = () => undefined;
		const config = {
			...base,
			get: (() =>
				Effect.promise(
					() =>
						new Promise<void>((resolve) => {
							release = resolve;
						}),
				).pipe(
					Effect.flatMap(() =>
						Effect.fail(
							new UiError({
								kind: "network",
								detail: {},
								reason: "late",
								retryable: false,
							}),
						),
					),
				)) as typeof base.get,
		};
		const opened = await openPane("#/vol/plans?theme=light", { config });
		mounted = opened.app;
		await settle(opened.root);
		(one("[data-test=plan-ledger-copy]") as HTMLElement).click();
		await until(
			() => one("[data-test=ledger-copy-loading]") !== null,
			"the loading line",
		);
		(one("[data-test=ledger-copy-close]") as HTMLElement).click();
		await until(
			() => one("[data-test=ledger-copy]") === null,
			"the sheet to close",
		);
		release();
		for (let turn = 0; turn < 30; turn += 1) {
			flushSync();
			await macrotask();
		}
		expect(
			toasts(opened.app).filter((toast) => toast.tone === "error"),
		).toEqual([]);
		expect(opened.log.entries()).toEqual([]);
	});
});
