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
		expect(save().title).toBe("Fix the problems shown first");
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
		// The words match what the sheet asks for: the PIN (the Worker's step-up), not only a mailed link.
		expect(toast?.doThis).toContain("PIN");
		await until(
			() => document.activeElement === one("[data-test=ledger-copy-pin]"),
			"the PIN field to take focus",
		);
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

/** A put that waits for `release()` before it reaches the store, so that a test can edit while the PUT is on its way. */
function gatedPut(base: ReturnType<typeof fixtureConfigFor>) {
	let release: () => void = () => undefined;
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	let started = 0;
	const put = ((...args: Parameters<typeof base.put>) =>
		Effect.suspend(() => {
			started += 1;
			// Only the first put waits.
			return started === 1
				? Effect.promise(() => gate).pipe(
						Effect.flatMap(() => base.put(...args)),
					)
				: base.put(...args);
		})) as typeof base.put;
	return { put, release: () => release(), started: () => started };
}

describe("an edit made while the PUT is on its way", () => {
	const puts = (base: ReturnType<typeof fixtureConfigFor>) =>
		base.calls.filter(({ method }) => method === "put");

	test("its verdict settles first: Save is not on for the new text with the old hash, the status is not 'Saved', and the next Save sends the new hash", async () => {
		const base = fixtureConfigFor();
		const held = gatedPut(base);
		const opened = await openCopy("#/vol/plans?theme=light", {
			config: { ...base, put: held.put },
		});
		await until(() => !save().disabled, "the first verify");
		const oldHash = await hashOf(seeded());
		save().click();
		await until(
			() =>
				held.started() === 1 &&
				(one(nameField("glow")) as HTMLInputElement).disabled,
			"the PUT on its way, the fields off",
		);
		type(nameField("glow"), "Glow Two");
		// The verify of the new text answers (400 ms pause) before the PUT does.
		await until(
			() => base.calls.filter(({ method }) => method === "verify").length === 2,
			"the verify of the new text",
			1500,
		);
		await pause(50);
		expect(save().disabled).toBe(true);
		expect(save().title).toBe("Saving…");
		held.release();
		await until(
			() =>
				puts(base).length === 1 &&
				text("[data-test=ledger-copy-status]") !== "Saving…",
			"the PUT to answer",
		);
		await until(() => !save().disabled, "Save for the new text", 1500);
		expect(text("[data-test=ledger-copy-status]")).toBe(
			"Verified: ready to save",
		);
		expect(one("[data-test=ledger-copy-conflict]")).toBeNull();
		save().click();
		await until(
			() => text("[data-test=ledger-copy-status]") === "Saved to the ledger",
			"the second save",
		);
		const [first, second] = puts(base);
		expect(first?.args[3]).toBe(oldHash);
		const newValue = {
			...seeded(),
			tiers: seeded().tiers.map((tier) =>
				tier.id === "glow" ? { ...tier, name: "Glow Two" } : tier,
			),
		};
		expect(second?.args[3]).toBe(await hashOf(newValue));
		expect(base.peek("vol", "plans-draft")?.etag).toBe(await hashOf(newValue));
		expect(
			opened.app.toasts.state.visible.filter((toast) => toast.tone === "error"),
		).toEqual([]);
	}, 15_000);

	test("its verdict settles after: no false 'Someone changed this' from the old base, and Save then sends the right hash", async () => {
		const base = fixtureConfigFor();
		const held = gatedPut(base);
		let verifies = 0;
		let releaseVerify: () => void = () => undefined;
		const slowVerify = new Promise<void>((resolve) => {
			releaseVerify = resolve;
		});
		const config = {
			...base,
			put: held.put,
			verify: ((...args: Parameters<typeof base.verify>) => {
				verifies += 1;
				// The verify of the edit made during the PUT is slow: it answers after the PUT has landed.
				return verifies === 2
					? Effect.promise(() => slowVerify).pipe(
							Effect.flatMap(() => base.verify(...args)),
						)
					: base.verify(...args);
			}) as typeof base.verify,
		};
		await openCopy("#/vol/plans?theme=light", { config });
		await until(() => !save().disabled, "the first verify");
		save().click();
		await until(() => held.started() === 1, "the PUT on its way");
		type(nameField("glow"), "Glow Two");
		await until(() => verifies === 2, "the slow verify to start", 1500);
		held.release();
		await until(
			() => puts(base).length === 1 && base.peek("vol", "plans-draft") !== null,
			"the PUT to land",
		);
		releaseVerify();
		await until(
			() => verifies === 3 && !save().disabled,
			"the verify made after the PUT",
			1500,
		);
		expect(one("[data-test=ledger-copy-conflict]")).toBeNull();
		expect(text("[data-test=ledger-copy-status]")).toBe(
			"Verified: ready to save",
		);
		save().click();
		await until(
			() => text("[data-test=ledger-copy-status]") === "Saved to the ledger",
			"the second save",
		);
		const newValue = {
			...seeded(),
			tiers: seeded().tiers.map((tier) =>
				tier.id === "glow" ? { ...tier, name: "Glow Two" } : tier,
			),
		};
		expect(puts(base)[1]?.args[3]).toBe(await hashOf(newValue));
	}, 15_000);
});

describe("another school", () => {
	test("changing the hash to another school closes the sheet, drops its save and its toasts: no PUT reaches the school left", async () => {
		const base = fixtureConfigFor();
		const held = gatedPut(base);
		const opened = await openCopy("#/vol/plans?theme=light", {
			config: { ...base, put: held.put },
		});
		await until(() => !save().disabled, "the first verify");
		save().click();
		await until(() => held.started() === 1, "the PUT on its way");
		window.location.hash = "#/map/plans?theme=light";
		await until(
			() => one("[data-test=ledger-copy]") === null,
			"the sheet to close",
		);
		await settle(opened.root);
		held.release();
		for (let turn = 0; turn < 30; turn += 1) {
			flushSync();
			await macrotask();
		}
		// The save was let go before it reached the store, and nothing speaks for it.
		expect(base.peek("vol", "plans-draft")).toBeNull();
		expect(
			base.calls.filter(
				({ method, args }) => method === "put" && args[0] !== "vol",
			),
		).toEqual([]);
		expect(
			toasts(opened.app).filter((toast) =>
				toast.owner?.startsWith("ledger-copy-vol"),
			),
		).toEqual([]);
		expect(opened.log.entries()).toEqual([]);
		// And the other school's Plans is its own: opening its sheet reads its own object.
		(one("[data-test=plan-ledger-copy]") as HTMLElement).click();
		await until(
			() => one("[data-test=ledger-copy-tier]") !== null,
			"the other school's copy",
		);
		expect(
			base.calls.some(
				({ method, args }) => method === "get" && args[0] === "map",
			),
		).toBe(true);
		expect(text("[data-test=ledger-copy]")).toContain("Maple Pilates");
	}, 15_000);

	test("a review dialog and a plan drawer left open do not follow to the next school", async () => {
		const opened = await openPane("#/vol/plans?theme=light");
		mounted = opened.app;
		await settle(opened.root);
		(
			one(
				"[data-test=plan-row][data-plan=glow] [data-test=plan-edit]",
			) as HTMLElement
		).click();
		await until(() => one("[data-test=plan-drawer]") !== null, "the drawer");
		window.location.hash = "#/map/plans?theme=light";
		await until(
			() => one("[data-test=plan-drawer]") === null,
			"the drawer to close",
		);
		await settle(opened.root);
		expect(one("[data-test=plan-publish-dialog]")).toBeNull();
	});
});

describe("a failed save or verify, and the toasts of a copy", () => {
	test("the toast of a failed verify and of a failed save go when a later one succeeds", async () => {
		const base = fixtureConfigFor();
		let verifies = 0;
		let puts = 0;
		const config = {
			...base,
			verify: ((...args: Parameters<typeof base.verify>) => {
				verifies += 1;
				return verifies === 2
					? Effect.fail(
							new UiError({
								kind: "server",
								detail: { status: 500 },
								reason: "boom",
								retryable: false,
							}),
						)
					: base.verify(...args);
			}) as typeof base.verify,
			put: ((...args: Parameters<typeof base.put>) => {
				puts += 1;
				return puts === 1
					? Effect.fail(
							new UiError({
								kind: "server",
								detail: { status: 500 },
								reason: "boom",
								retryable: false,
							}),
						)
					: base.put(...args);
			}) as typeof base.put,
		};
		const opened = await openCopy("#/vol/plans?theme=light", { config });
		await until(() => !save().disabled, "the first verify");
		type(nameField("glow"), "Glow Two");
		await until(
			() =>
				toasts(opened.app).some((toast) => toast.title === "The server failed"),
			"the verify's toast",
			1500,
		);
		type(nameField("glow"), "Glow Three");
		await until(() => !save().disabled, "a good verify", 1500);
		expect(
			toasts(opened.app).filter((toast) => toast.title === "The server failed"),
		).toEqual([]);
		save().click();
		await until(
			() =>
				toasts(opened.app).some((toast) => toast.title === "The server failed"),
			"the save's toast",
		);
		await until(() => !save().disabled, "Save to be on again");
		save().click();
		await until(
			() => text("[data-test=ledger-copy-status]") === "Saved to the ledger",
			"the second save",
		);
		expect(
			toasts(opened.app).filter((toast) => toast.title === "The server failed"),
		).toEqual([]);
	}, 15_000);

	test("three lost answers where the first PUT landed: the person's own Retry finds its write already in, it is saved, not a conflict", async () => {
		const base = fixtureConfigFor();
		let attempts = 0;
		const lost = () =>
			new UiError({
				kind: "network",
				detail: {},
				reason: "no answer",
				retryable: true,
			});
		const config = {
			...base,
			put: ((...args: Parameters<typeof base.put>) =>
				Effect.suspend(() => {
					attempts += 1;
					if (attempts === 1)
						return base
							.put(...args)
							.pipe(Effect.flatMap(() => Effect.fail(lost())));
					if (attempts <= 3) return Effect.fail(lost());
					return base.put(...args);
				})) as typeof base.put,
		};
		const opened = await openCopy("#/vol/plans?theme=light", { config });
		await until(() => !save().disabled, "the first verify");
		save().click();
		await until(
			() =>
				toasts(opened.app).some(
					(toast) =>
						toast.title === "No connection" &&
						toast.action?.label === "Retry" &&
						toast.detail !== undefined,
				),
			"the third failure",
			3000,
		);
		expect(attempts).toBe(3);
		expect(base.peek("vol", "plans-draft")).not.toBeNull();
		await until(
			() =>
				!toasts(opened.app).find((toast) => toast.title === "No connection")
					?.busy,
			"the toast to rest",
		);
		toasts(opened.app)
			.find((toast) => toast.title === "No connection")
			?.action?.run();
		await until(
			() => text("[data-test=ledger-copy-status]") === "Saved to the ledger",
			"the manual retry",
		);
		expect(one("[data-test=ledger-copy-conflict]")).toBeNull();
		expect(
			toasts(opened.app).filter(
				(toast) => toast.title === "Someone changed this. Review their change",
			),
		).toEqual([]);
	}, 15_000);

	test("no ledger token is signed out, not an empty store: the sheet shows the failure, never a seeded editor", async () => {
		const base = fixtureConfigFor();
		const config = {
			...base,
			get: (() =>
				Effect.fail(
					new UiError({
						kind: "unauthenticated",
						detail: { code: "token_missing" },
						reason: "no ledger token",
						retryable: false,
					}),
				)) as typeof base.get,
		};
		const opened = await openPane("#/vol/plans?theme=light", { config });
		mounted = opened.app;
		await settle(opened.root);
		(one("[data-test=plan-ledger-copy]") as HTMLElement).click();
		await until(
			() => one("[data-test=ledger-copy] [data-test=load-failed]") !== null,
			"the failure",
		);
		expect(one("[data-test=load-failed]")?.dataset.kind).toBe(
			"unauthenticated",
		);
		expect(all("[data-test=ledger-copy-tier]").length).toBe(0);
		expect(base.calls.some(({ method }) => method === "verify")).toBe(false);
	});
});

describe("problems and the marks", () => {
	test("an edit clears the marks and the summary toast of the value before it, until the next verdict", async () => {
		const { app } = await openCopy();
		await until(() => !save().disabled, "the first verify");
		type(nameField("glow"), "");
		await until(
			() =>
				toasts(app).some(
					(toast) => toast.title === "Some fields need a change",
				),
			"the summary",
		);
		expect(all("[aria-invalid=true]").length).toBe(1);
		type(nameField("glow"), "G");
		expect(all("[aria-invalid=true]").length).toBe(0);
		expect(
			toasts(app).filter(
				(toast) => toast.title === "Some fields need a change",
			),
		).toEqual([]);
		await until(() => !save().disabled, "the verdict");
	});

	test("a problem at no field (an id, the tiers list) is listed under the fields, and the summary's action goes to it", async () => {
		const base = fixtureConfigFor();
		const config = {
			...base,
			verify: ((...args: Parameters<typeof base.verify>) =>
				Effect.map(base.verify(...args), (verdict) =>
					(args[2] as PlansDraftConfig).tiers[0]?.name === "Sparkle!"
						? {
								...verdict,
								ok: false,
								verifiedHash: null,
								problems: [
									{
										path: "tiers[0].id",
										message: "must be 1 to 40 letters",
										hint: "Use letters.",
									},
								],
							}
						: verdict,
				)) as typeof base.verify,
		};
		const opened = await openCopy("#/vol/plans?theme=light", { config });
		await until(() => !save().disabled, "the first verify");
		type(nameField("sparkle"), "Sparkle!");
		await until(
			() => one("[data-test=ledger-copy-other-problems]") !== null,
			"the listed problem",
		);
		expect(text("[data-test=ledger-copy-other-problems]")).toContain(
			"tiers[0].id: must be 1 to 40 letters",
		);
		expect(all("[aria-invalid=true]").length).toBe(0);
		const summary = toasts(opened.app).find(
			(toast) => toast.title === "Some fields need a change",
		);
		summary?.action?.run();
		expect(document.activeElement).toBe(
			one("[data-test=ledger-copy-other-problems]"),
		);
	});

	test("the audience select and the on-sale box point at their problem line", async () => {
		await openCopy();
		const select = one(
			"[data-test=ledger-copy-tier][data-tier=glow] [data-field=audience]",
		) as HTMLSelectElement;
		const box = one(
			"[data-test=ledger-copy-tier][data-tier=glow] [data-field=public]",
		) as HTMLInputElement;
		for (const control of [select, box]) {
			const id = control.getAttribute("aria-describedby");
			expect(id).not.toBeNull();
			expect(document.getElementById(id ?? "")).not.toBeNull();
		}
	});
});
