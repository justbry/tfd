import { Effect } from "effect";
import type { AppServices } from "../../effect/app-layer.ts";
import {
	type ConfigApi,
	ConfigClient,
	type ConfigDiffEntry,
	type ConfigName,
	type ConfigValues,
} from "../../effect/config-client.ts";
import { putOnce, recoverFrom } from "../../effect/config-save.ts";
import { messageFor } from "../../effect/messages.ts";
import { reportFailure } from "../../effect/report.ts";
import { withRetry } from "../../effect/retry.ts";
import { write } from "../../effect/run.ts";
import { type FieldProblem, UiError } from "../../effect/ui-error.ts";
import { type AppContext, perform } from "../context.ts";
import { type RetryingRead, retryingRead } from "../retrying-read.ts";

const verifyPauseMilliseconds = 400;

/** The other side of a conflict: what the stored copy would become with this one saved, path by path. */
export type Conflict = {
	diff: readonly ConfigDiffEntry[];
	/** The stored copy's ETag now. */
	etag: string | null;
};

/** A stored object (`etag` is its ETag) or the seed of a school with none stored yet (`etag` null). */
type Loaded<Value> = { value: Value; etag: string | null };

const copyOf = <Value>(value: Value): Value =>
	JSON.parse(JSON.stringify(value)) as Value;

/** What `save` ends with: stored, refused or failed (its toast says why), or let go (nobody wants the answer). */
export type SaveResult = "saved" | "failed" | "interrupted" | "skipped";

export type ConfigEditorOptions<Name extends ConfigName> = {
	app: AppContext;
	school: string;
	/** The config object this editor reads, verifies and puts. */
	name: Name;
	/** The value for a school with nothing stored yet: a value (`value`), or a read that makes one (`read`; its failure
	 * is the editor's load failure, retried and toasted like any read). */
	seed:
		| { value: () => ConfigValues[Name] }
		| { read: () => Effect.Effect<ConfigValues[Name], UiError, AppServices> };
	/** Names the editor's toasts (its screen's own), so that another editor's identical failure never merges. */
	owner: string;
	/** Whether a seed is verified at once, so that the first Save is a create (the copy in the ledger); a screen whose
	 * Save checks first (`save({ flush: true })`) leaves it, and an admin, who may not verify, has no use for it.
	 * Default: yes. */
	verifySeed?: boolean;
};

/** One config object edited in the ledger (S9-plan D18, D22), the flow of S9.3's copy in the ledger for any object: the
 * object is read with its ETag (a school with none stored yet starts from a seed), edited here and written through the
 * Worker's config routes. Every pause in editing verifies the value (debounced; a newer edit lets an older verify go
 * with no toast and no log); Save is on only for a value the Worker verified, over the ETag this copy was read at; Save
 * sends the PUT. A 412 shows the difference and offers Reload; a 403 `step_up_required` offers "Confirm it is you" (the
 * family PIN, then a new ledger token). The PUT has no Idempotency-Key: it is idempotent by its verified hash and
 * If-Match (`putOnce`), which is how a retry stays one write. */
export class ConfigEditor<Name extends ConfigName> {
	phase: "loading" | "ready" | "failed" = $state("loading");
	failure: UiError | null = $state.raw(null);
	loadBusy = $state(false);
	/** The copy as edited. */
	value: ConfigValues[Name] | null = $state.raw(null);
	/** The stored copy this one was read at (`etag` null: nothing stored yet, so the first Save is a create). */
	base: { value: ConfigValues[Name]; etag: string | null } | null =
		$state.raw(null);
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
	/** Whether the last save changed what was stored (false: the ledger already held this value); null before one. */
	lastChanged: boolean | null = $state(null);

	readonly name: Name;
	readonly #app: AppContext;
	readonly #client: ConfigApi;
	readonly #school: string;
	readonly #seed: ConfigEditorOptions<Name>["seed"];
	readonly #owner: string;
	readonly #verifySeed: boolean;
	#loading: RetryingRead | null = null;
	#timer: ReturnType<typeof setTimeout> | null = null;
	#verifyRun: AbortController | null = null;
	#problemsToast: string | null = null;
	/** The toasts of a failed verify and of a failed save: a later success takes them down. */
	#verifyToast: string | null = null;
	#saveToast: string | null = null;
	#saveRun: AbortController | null = null;
	#verifyNumber = 0;
	#focusFirstProblem: () => void = () => undefined;

	constructor(options: ConfigEditorOptions<Name>) {
		this.#app = options.app;
		this.#client = options.app.runtime.runSync(
			ConfigClient.useSync((client) => client),
		);
		this.name = options.name;
		this.#school = options.school;
		this.#seed = options.seed;
		this.#owner = options.owner;
		this.#verifySeed = options.verifySeed ?? true;
	}

	onFirstProblem(focus: () => void): void {
		this.#focusFirstProblem = focus;
	}

	/** Reads the stored copy (a school with none yet starts from the seed). */
	load(): void {
		this.#loading?.cancel();
		const seeded = (): Effect.Effect<
			Loaded<ConfigValues[Name]>,
			UiError,
			AppServices
		> => {
			const made =
				"read" in this.#seed
					? this.#seed.read()
					: Effect.succeed(this.#seed.value());
			return Effect.map(
				made,
				(seed): Loaded<ConfigValues[Name]> => ({ value: seed, etag: null }),
			);
		};
		const config = (): Effect.Effect<
			Loaded<ConfigValues[Name]>,
			UiError,
			AppServices
		> =>
			recoverFrom(
				this.#client.get(this.#school, this.name).pipe(
					Effect.map(
						(read): Loaded<ConfigValues[Name]> => ({
							value: read.value,
							etag: read.etag,
						}),
					),
				),
				// Nothing stored yet is not a failure: the copy starts from the seed.
				(error) => error.kind === "not_found",
				seeded,
			);
		const reading = retryingRead(this.#app, config, {
			value: (loaded) => {
				this.base = {
					value: copyOf(loaded.value),
					etag: loaded.etag,
				};
				this.value = copyOf(loaded.value);
				this.verified = null;
				this.problems = [];
				this.conflict = null;
				this.changed = false;
				this.saved = false;
				this.phase = "ready";
				this.failure = null;
				// A copy with nothing stored is verified at once: its first Save is a create.
				if (loaded.etag === null && this.#verifySeed) void this.#verify();
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
	edit(update: (value: ConfigValues[Name]) => ConfigValues[Name]): void {
		if (!this.value) return;
		// A verify on its way is for the value before this edit: its answer is of no use, and nobody hears of it.
		this.#abortVerify();
		this.#verifyNumber += 1;
		this.value = update(copyOf(this.value));
		this.verified = null;
		// The marks and the summary toast were for the value before this keystroke: they come back with the next verdict.
		this.problems = [];
		this.#dismissProblems();
		this.saved = false;
		this.changed = true;
		this.#clearTimer();
		this.#timer = setTimeout(
			() => void this.#verify(),
			verifyPauseMilliseconds,
		);
	}

	/** Drops the edits for the copy read (a Reset): nothing is changed, so nothing is verified. */
	discard(): void {
		if (!this.base) return;
		this.#abortVerify();
		this.#clearTimer();
		this.#verifyNumber += 1;
		this.#dismissProblems();
		this.value = copyOf(this.base.value);
		this.verified = null;
		this.problems = [];
		this.saved = false;
		this.changed = false;
	}

	/** Where the copy stands, in one ladder: the status line, and why Save is off (null: it is on). */
	get state(): { status: string; reason: string | null } {
		const { problems } = this;
		if (this.saving) return { status: "Saving…", reason: "Saving…" };
		if (
			this.verifying ||
			this.#timer !== null ||
			(!this.verified && this.changed && problems.length === 0)
		)
			return { status: "Checking the copy…", reason: "Checking the copy…" };
		if (problems.length > 0)
			return {
				status: `${problems.length} problem${problems.length === 1 ? "" : "s"}: fix the ones shown`,
				reason: "Fix the problems shown first",
			};
		if (this.conflict)
			return {
				status: "Someone changed this since you opened it",
				reason: "Someone changed this: reload first",
			};
		if (this.saved)
			return { status: "Saved to the ledger", reason: "Nothing to save" };
		if (this.verified)
			return { status: "Verified: ready to save", reason: null };
		return { status: "No changes yet", reason: "Nothing to save" };
	}

	/** Why Save is off, or null when it is on. */
	get saveReason(): string | null {
		return this.state.reason;
	}

	/** Why a Save that verifies first is off, or null when it is on: no problem is marked, nobody else changed the copy
	 * and a save is not on its way. A change not yet verified is fine: the Save checks it (and stops on a problem) before
	 * it sends the PUT; a Save with nothing changed sends the same value, which the Worker answers as unchanged. */
	get flushReason(): string | null {
		if (this.saving) return "Saving…";
		if (this.problems.length > 0) return "Fix the problems shown first";
		if (this.conflict) return "Someone changed this: reload first";
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
		if (this.#problemsToast !== null)
			this.#app.toasts.dismiss(this.#problemsToast);
		this.#problemsToast = null;
	}

	/** Verifies the value on screen. A newer verify (or a reload, or leaving) lets this one go: no toast, no log. The
	 * promise ends with the verdict (or with the let-go). */
	#verify(): Promise<void> {
		this.#clearTimer();
		const value = this.value;
		const base = this.base;
		if (!value || !base) return Promise.resolve();
		this.#abortVerify();
		const controller = new AbortController();
		this.#verifyRun = controller;
		this.verifying = true;
		this.#verifyNumber += 1;
		const mine = this.#verifyNumber;
		return perform(
			this.#app,
			withRetry(
				this.#client.verify(this.#school, this.name, value),
				{ kind: "read" },
				{ owner: `${this.#owner}-verify` },
			),
			{
				owner: `${this.#owner}-verify`,
				signal: controller.signal,
				handlers: { retry: () => void this.#verify() },
			},
		).then(async (outcome) => {
			if (mine !== this.#verifyNumber) return;
			this.verifying = false;
			this.#verifyRun = null;
			if (!outcome.ok) {
				if (!outcome.interrupted) this.#verifyToast = outcome.toastId;
				return;
			}
			if (this.#verifyToast !== null)
				this.#app.toasts.dismiss(this.#verifyToast);
			this.#verifyToast = null;
			const verdict = outcome.value;
			if (!verdict.ok || verdict.verifiedHash === null) {
				this.verified = null;
				this.problems = verdict.problems;
				await this.#summarise(verdict.problems);
				return;
			}
			this.problems = [];
			this.#dismissProblems();
			this.verified = {
				hash: verdict.verifiedHash,
				baseEtag: verdict.baseEtag,
			};
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

	/** Save: the PUT of the verified value over the ETag it was read at. The value saved is the one on screen when Save
	 * was clicked; an edit made while the PUT was on its way is a newer value that the saved hash says nothing about.
	 * With `flush`, a change the pause has not verified yet is verified now, and the PUT follows only a clean verdict. */
	async save(options: { flush?: boolean } = {}): Promise<SaveResult> {
		if (this.saving) return "skipped";
		if (options.flush === true) {
			if (this.flushReason !== null) return "skipped";
			if (!this.verified || this.#timer !== null || this.verifying)
				await this.#verify();
			if (
				this.problems.length > 0 ||
				this.conflict ||
				!this.verified ||
				!this.value
			)
				return this.problems.length > 0 || this.conflict ? "skipped" : "failed";
		}
		const { value, base, verified } = this;
		if (
			!value ||
			!base ||
			!verified ||
			(options.flush !== true && this.saveReason !== null)
		)
			return "skipped";
		this.saving = true;
		const owner = `${this.#owner}-save`;
		const controller = new AbortController();
		this.#saveRun = controller;
		const outcome = await perform(
			this.#app,
			withRetry(
				putOnce(
					this.#client,
					this.#school,
					this.name,
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
				signal: controller.signal,
				handlers: {
					retry: () => void this.save(options),
					reload: () => this.reload(),
					show_problems: () => this.#focusFirstProblem(),
					confirm_identity: () => {
						this.stepUp = true;
					},
				},
			},
		);
		if (this.#saveRun === controller) this.#saveRun = null;
		this.saving = false;
		if (outcome.ok) {
			if (this.#saveToast !== null) this.#app.toasts.dismiss(this.#saveToast);
			this.#saveToast = null;
			this.lastChanged = outcome.value.changed;
			this.base = { value: copyOf(value), etag: verified.hash };
			this.stepUp = false;
			this.conflict = null;
			if (this.value === value) {
				this.verified = { hash: verified.hash, baseEtag: verified.hash };
				this.changed = false;
				this.saved = true;
			} else {
				// Edited meanwhile: the stored copy is the one saved, the screen's is newer and wants its own verdict
				// (an answer that came while the PUT was on its way was over the old base).
				this.verified = null;
				this.saved = false;
				this.changed = true;
				this.#clearTimer();
				void this.#verify();
			}
			return "saved";
		}
		if (outcome.interrupted) return "interrupted";
		this.#saveToast = outcome.toastId;
		const { code } = outcome.error.detail;
		if (code === "stale_etag") void this.#verify();
		else if (code === "step_up_required") this.stepUp = true;
		else if (code === "invalid_config" && outcome.error.detail.problems) {
			this.verified = null;
			this.problems = outcome.error.detail.problems;
		}
		return "failed";
	}

	/** "Confirm it is you": the family PIN opens the session, a new ledger token carries the step-up, and the save runs
	 * again. Answers the refusal's words for the PIN field (null when the PIN worked) and whether the value was then
	 * stored. */
	async confirmAndSave(
		pin: string,
		options: { flush?: boolean } = {},
	): Promise<{ problem: string | null; saved: boolean }> {
		const owner = `${this.#owner}-confirm`;
		const unlocked = await perform(
			this.#app,
			write((writer) => writer.unlockBooks(this.#school, pin)),
			{ owner },
		);
		if (!unlocked.ok) {
			if (unlocked.interrupted) return { problem: null, saved: false };
			const message = messageFor(unlocked.error);
			return {
				problem: `${message.title}. ${message.doThis}`,
				saved: false,
			};
		}
		if (!unlocked.value.unlocked)
			return {
				problem:
					unlocked.value.reason === "pin_locked"
						? "Too many PIN tries. Wait a few minutes, then try again."
						: "That PIN is not right. Check it and type it again.",
				saved: false,
			};
		const refreshed = await perform(this.#app, this.#client.refreshSession(), {
			owner: `${this.#owner}-session`,
		});
		if (!refreshed.ok) return { problem: null, saved: false };
		this.stepUp = false;
		return { problem: null, saved: (await this.save(options)) === "saved" };
	}

	/** `confirmAndSave`, for the copy in the ledger's sheet: the PIN field's words, or null when it worked. */
	async confirm(pin: string): Promise<string | null> {
		return (await this.confirmAndSave(pin)).problem;
	}

	/** Leaving the pane or the school: nothing in flight reports (a verify, a load and a save on its way are let go),
	 * and the toasts of this copy go. */
	dispose(): void {
		this.#loading?.cancel();
		this.#abortVerify();
		this.#saveRun?.abort();
		this.#saveRun = null;
		this.#clearTimer();
		this.#verifyNumber += 1;
		this.#dismissProblems();
		for (const toast of [this.#verifyToast, this.#saveToast])
			if (toast !== null) this.#app.toasts.dismiss(toast);
		this.#verifyToast = null;
		this.#saveToast = null;
	}
}
