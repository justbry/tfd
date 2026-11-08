import { Effect } from "effect";
import type { PlansDraftConfig } from "$worker-config/types.ts";
import {
	type ConfigApi,
	ConfigClient,
	type ConfigDiffEntry,
} from "../../effect/config-client.ts";
import { putOnce, recoverFrom } from "../../effect/config-save.ts";
import { messageFor } from "../../effect/messages.ts";
import { write } from "../../effect/run.ts";
import { reportFailure } from "../../effect/report.ts";
import { withRetry } from "../../effect/retry.ts";
import { UiError, type FieldProblem } from "../../effect/ui-error.ts";
import { type AppContext, perform } from "../context.ts";
import { retryingRead, type RetryingRead } from "../retrying-read.ts";

const verifyPauseMilliseconds = 400;
export const objectName = "plans-draft" as const;

/** The other side of a conflict: what the stored copy would become with this one saved, path by path. */
export type Conflict = {
	diff: readonly ConfigDiffEntry[];
	/** The stored copy's ETag now. */
	etag: string | null;
};

type Loaded =
	| { found: true; value: PlansDraftConfig; etag: string }
	| { found: false };

const copyOf = (value: PlansDraftConfig): PlansDraftConfig =>
	JSON.parse(JSON.stringify(value)) as PlansDraftConfig;

/** The Plans tab's copy in the ledger (S9-plan D18, D22): the `plans-draft` config object (draft copy, tier order, tier
 * audience; no prices), edited here and written through the Worker's config routes. Every pause in editing verifies the
 * value (debounced; a newer edit lets an older verify go with no toast and no log); Save is on only for a value the
 * Worker verified, over the ETag this copy was read at; Save sends the PUT. A 412 shows the difference and offers Reload;
 * a 403 `step_up_required` offers "Confirm it is you" (the family PIN, then a new ledger token). The PUT has no
 * Idempotency-Key: it is idempotent by its verified hash and If-Match (`putOnce`), which is how a retry stays one write. */
export class LedgerCopy {
	phase: "loading" | "ready" | "failed" = $state("loading");
	failure: UiError | null = $state.raw(null);
	loadBusy = $state(false);
	/** The copy as edited. */
	value: PlansDraftConfig | null = $state.raw(null);
	/** The stored copy this one was read at (`etag` null: nothing stored yet, so the first Save is a create). */
	base: { value: PlansDraftConfig; etag: string | null } | null = $state.raw(null);
	/** The verdict for exactly the value on screen; null while it is edited, unverified or has problems. */
	verified: { hash: string; baseEtag: string | null } | null = $state.raw(null);
	verifying = $state(false);
	problems: readonly FieldProblem[] = $state.raw([]);
	saving = $state(false);
	saved = $state(false);
	conflict: Conflict | null = $state.raw(null);
	/** The 403 `step_up_required` asked for the family PIN. */
	stepUp = $state(false);
	/** A change since the copy was read or saved. */
	changed = $state(false);

	readonly #app: AppContext;
	readonly #client: ConfigApi;
	readonly #school: string;
	readonly #seed: () => PlansDraftConfig;
	readonly #owner: string;
	#loading: RetryingRead | null = null;
	#timer: ReturnType<typeof setTimeout> | null = null;
	#verifyRun: AbortController | null = null;
	#problemsToast: string | null = null;
	#verifyNumber = 0;
	#actions = 0;
	#focusFirstProblem: () => void = () => undefined;

	constructor(options: {
		app: AppContext;
		school: string;
		/** The copy of the draft menu, for a school with nothing stored yet. */
		seed: () => PlansDraftConfig;
	}) {
		this.#app = options.app;
		this.#client = options.app.runtime.runSync(
			ConfigClient.useSync((client) => client),
		);
		this.#school = options.school;
		this.#seed = options.seed;
		this.#owner = `ledger-copy-${options.school}`;
	}

	onFirstProblem(focus: () => void): void {
		this.#focusFirstProblem = focus;
	}

	/** Reads the stored copy (a school with none yet starts from the draft menu). */
	load(): void {
		this.#loading?.cancel();
		const config = (): Effect.Effect<Loaded, UiError> =>
			recoverFrom(
				this.#client.get(this.#school, objectName).pipe(
					Effect.map(
						(read): Loaded => ({ found: true, value: read.value, etag: read.etag }),
					),
				),
				// Nothing stored yet is not a failure: the copy starts from the draft menu.
				(error) => error.kind === "not_found",
				() => Effect.succeed<Loaded>({ found: false }),
			);
		const reading = retryingRead(this.#app, config, {
			value: (loaded) => {
				const value = loaded.found ? loaded.value : this.#seed();
				this.base = {
					value: copyOf(value),
					etag: loaded.found ? loaded.etag : null,
				};
				this.value = copyOf(value);
				this.verified = null;
				this.problems = [];
				this.conflict = null;
				this.changed = false;
				this.saved = false;
				this.phase = "ready";
				this.failure = null;
				// A copy with nothing stored is verified at once: its first Save is a create.
				if (!loaded.found) this.#verify();
			},
			failure: (error) => {
				this.failure = error;
				this.phase = "failed";
			},
			busy: (busy) => {
				this.loadBusy = busy;
			},
		});
		this.#loading = reading;
		void reading.run();
	}

	retryLoad(): void {
		void this.#loading?.run();
	}

	/** Reload: drops this copy for the stored one (the 412's way out). */
	reload(): void {
		this.#abortVerify();
		this.#clearTimer();
		this.#dismissProblems();
		this.load();
	}

	/** An edit: the value is now unverified, and a verify follows the pause. */
	edit(update: (value: PlansDraftConfig) => PlansDraftConfig): void {
		if (!this.value) return;
		this.value = update(copyOf(this.value));
		this.verified = null;
		this.saved = false;
		this.changed = true;
		this.#clearTimer();
		this.#timer = setTimeout(() => this.#verify(), verifyPauseMilliseconds);
	}

	/** Whether Save is on, and if not why (for its title). */
	get saveReason(): string | null {
		if (this.saving) return "Saving…";
		if (this.verifying || this.#timer !== null) return "Checking the copy…";
		if (this.problems.length > 0) return "Fix the fields marked first";
		if (this.conflict) return "Someone changed this: reload first";
		if (!this.verified) return this.changed ? "Checking the copy…" : "Nothing to save";
		return null;
	}

	#clearTimer(): void {
		if (this.#timer !== null) clearTimeout(this.#timer);
		this.#timer = null;
	}

	#abortVerify(): void {
		this.#verifyRun?.abort();
		this.#verifyRun = null;
		this.verifying = false;
	}

	#dismissProblems(): void {
		if (this.#problemsToast !== null) this.#app.toasts.dismiss(this.#problemsToast);
		this.#problemsToast = null;
	}

	/** Verifies the value on screen. A newer verify (or a reload, or leaving) lets this one go: no toast, no log. */
	#verify(): void {
		this.#clearTimer();
		const value = this.value;
		const base = this.base;
		if (!value || !base) return;
		this.#abortVerify();
		const controller = new AbortController();
		this.#verifyRun = controller;
		this.verifying = true;
		this.#verifyNumber += 1;
		const mine = this.#verifyNumber;
		void perform(
			this.#app,
			withRetry(
				this.#client.verify(this.#school, objectName, value),
				{ kind: "read" },
				{ owner: `${this.#owner}-verify` },
			),
			{
				owner: `${this.#owner}-verify`,
				signal: controller.signal,
				handlers: { retry: () => this.#verify() },
			},
		).then(async (outcome) => {
			if (mine !== this.#verifyNumber) return;
			this.verifying = false;
			this.#verifyRun = null;
			if (!outcome.ok) return;
			const verdict = outcome.value;
			if (!verdict.ok || verdict.verifiedHash === null) {
				this.verified = null;
				this.problems = verdict.problems;
				await this.#summarise(verdict.problems);
				return;
			}
			this.problems = [];
			this.#dismissProblems();
			this.verified = { hash: verdict.verifiedHash, baseEtag: verdict.baseEtag };
			this.conflict =
				verdict.baseEtag === base.etag
					? null
					: { diff: verdict.diff, etag: verdict.baseEtag };
		});
	}

	/** The summary toast of a value with problems: the message table's "Some fields need a change", its action jumping
	 * to the first marked field. The fields carry the detail. */
	async #summarise(problems: readonly FieldProblem[]): Promise<void> {
		this.#dismissProblems();
		const error = new UiError({
			kind: "bad_request",
			detail: { status: 422, code: "invalid_config", problems },
			reason: "The value has problems.",
			retryable: false,
		});
		this.#problemsToast = await this.#app.runtime.runPromise(
			reportFailure(
				error,
				{ show_problems: () => this.#focusFirstProblem() },
				`${this.#owner}-problems`,
			),
		);
	}

	/** Save: the PUT of the verified value over the ETag it was read at. */
	async save(): Promise<void> {
		const { value, base, verified } = this;
		if (this.saving || !value || !base || !verified || this.saveReason !== null)
			return;
		this.saving = true;
		this.#actions += 1;
		const owner = `${this.#owner}-save`;
		const outcome = await perform(
			this.#app,
			withRetry(
				putOnce(
					this.#client,
					this.#school,
					objectName,
					value,
					verified.hash,
					base.etag,
				),
				// The PUT has no Idempotency-Key: the verified hash plus If-Match is what makes the retry one write.
				{ kind: "write", idempotencyKey: verified.hash },
				{ owner },
			),
			{
				owner,
				handlers: {
					retry: () => void this.save(),
					reload: () => this.reload(),
					show_problems: () => this.#focusFirstProblem(),
					confirm_identity: () => {
						this.stepUp = true;
					},
				},
			},
		);
		this.saving = false;
		if (outcome.ok) {
			this.base = { value: copyOf(value), etag: verified.hash };
			this.verified = { hash: verified.hash, baseEtag: verified.hash };
			this.changed = false;
			this.saved = true;
			this.stepUp = false;
			this.conflict = null;
			return;
		}
		if (outcome.interrupted) return;
		const { code } = outcome.error.detail;
		if (code === "stale_etag") this.#verify();
		else if (code === "step_up_required") this.stepUp = true;
		else if (code === "invalid_config" && outcome.error.detail.problems) {
			this.verified = null;
			this.problems = outcome.error.detail.problems;
		}
	}

	/** "Confirm it is you": the family PIN opens the session, a new ledger token carries the step-up, and the save runs
	 * again. Answers the refusal's words for the PIN field, or null when it worked. */
	async confirm(pin: string): Promise<string | null> {
		const owner = `${this.#owner}-confirm`;
		const unlocked = await perform(
			this.#app,
			write((writer) => writer.unlockBooks(this.#school, pin)),
			{ owner },
		);
		if (!unlocked.ok) {
			if (unlocked.interrupted) return null;
			const message = messageFor(unlocked.error);
			return `${message.title}. ${message.doThis}`;
		}
		if (!unlocked.value.unlocked)
			return unlocked.value.reason === "pin_locked"
				? "Too many PIN tries. Wait a few minutes, then try again."
				: "That PIN is not right. Check it and type it again.";
		const refreshed = await perform(this.#app, this.#client.refreshSession(), {
			owner: `${this.#owner}-session`,
		});
		if (!refreshed.ok) return null;
		this.stepUp = false;
		await this.save();
		return null;
	}

	/** Leaving the pane or the school: nothing in flight reports, and the problems toast goes. */
	dispose(): void {
		this.#loading?.cancel();
		this.#abortVerify();
		this.#clearTimer();
		this.#verifyNumber += 1;
		this.#dismissProblems();
	}
}
