<script lang="ts">
	import { Button } from "$lib/components/ui/button/index.ts";
	import { Input } from "$lib/components/ui/input/index.ts";
	import type { ConfigEditor } from "../config/config-editor.svelte.ts";
	import ConfigConflict from "../config/ConfigConflict.svelte";
	import ConfigStepUp from "../config/ConfigStepUp.svelte";
	import { useApp } from "../context.ts";
	import Icon from "../Icon.svelte";
	import { notifySuccess } from "../panes/writes.ts";
	import InlineError from "../toasts/InlineError.svelte";
	import ConfigStatus from "./ConfigStatus.svelte";
	import SectionState from "./SectionState.svelte";
	import { control, fieldLabel, heading, hint, muted, sectionNote, selectControl } from "./styles.ts";

	/** Booking rules (Reports' "Rules in force"): the `booking-rules` object of the ledger's config, the hours before a
	 * booking inside which it cannot be cancelled free and what a no-show and a late cancel do to the credits held. Owners
	 * change them (verify, then PUT, with the PIN's step-up); an admin reads them. Each field shows the Worker's problem
	 * for it, in its words. */
	let {
		editor,
		unit,
		writeOff,
	}: {
		editor: ConfigEditor<"booking-rules">;
		/** What the school calls a held credit: "credit" or "session". */
		unit: string;
		writeOff: { disabled: boolean; title: string | undefined; describedby: string | undefined };
	} = $props();

	const app = useApp();
	const ids = $props.id();
	const problemsAt = (path: string) => editor.problems.filter((problem) => problem.path === path);
	const known = ["cancelCutoffHours", "noShow", "lateCancel"];
	const elsewhere = $derived(editor.problems.filter((problem) => !known.includes(problem.path)));
	const outcomeFields = [
		["noShow", "A no-show"],
		["lateCancel", "A late cancel"],
	] as const;
	const outcomes = $derived([
		["spend", `Spend the ${unit}`],
		["release", `Release the ${unit}`],
	] as const);
	const save = async (): Promise<void> => {
		if ((await editor.save({ flush: true })) !== "saved") return;
		notifySuccess(
			app,
			editor.lastChanged === false
				? "Nothing to change: the ledger already holds these rules."
				: "Booking rules saved. They apply to bookings from now on.",
		);
	};
	// svelte-ignore state_referenced_locally
	editor.onFirstProblem(() => document.querySelector<HTMLElement>("[data-test=rules-field][aria-invalid=true]")?.focus());
</script>

<h5 class={heading} data-test="settings-rules-section">
	<Icon name="clock" /> Booking rules <span class={[muted, sectionNote]}>cancel and no-show</span>
</h5>
<SectionState {editor} reading="the booking rules" test="settings-rules">
	{#snippet children(value)}
		<div class="grid grid-cols-3 gap-1.5 max-[600px]:grid-cols-1">
			<div>
				<label class={fieldLabel} for="{ids}-cutoff">Free cancel until (hours before)</label>
				<Input
					id="{ids}-cutoff"
					type="number"
					min="0"
					class={control}
					data-test="rules-field"
					data-field="cancelCutoffHours"
					value={value.cancelCutoffHours}
					aria-invalid={problemsAt("cancelCutoffHours").length > 0}
					aria-describedby={writeOff.describedby ?? `${ids}-cutoff-problem`}
					disabled={writeOff.disabled}
					title={writeOff.title}
					oninput={(event) =>
						editor.edit((current) => ({
							...current,
							cancelCutoffHours: event.currentTarget.value === "" ? Number.NaN : Number(event.currentTarget.value),
						}))}
				/>
				<InlineError id="{ids}-cutoff-problem" problems={problemsAt("cancelCutoffHours")} />
			</div>
			{#each outcomeFields as [field, label] (field)}
				<div>
					<label class={fieldLabel} for="{ids}-{field}">{label}</label>
					<select
						id="{ids}-{field}"
						class={selectControl}
						data-test="rules-field"
						data-field={field}
						aria-invalid={problemsAt(field).length > 0}
						aria-describedby={writeOff.describedby ?? `${ids}-${field}-problem`}
						disabled={writeOff.disabled}
						title={writeOff.title}
						oninput={(event) => {
							const outcome = event.currentTarget.value === "release" ? "release" : "spend";
							editor.edit((current) => ({ ...current, [field]: outcome }));
						}}
					>
						{#each outcomes as [outcome, text] (outcome)}
							<option value={outcome} selected={value[field] === outcome}>{text}</option>
						{/each}
					</select>
					<InlineError id="{ids}-{field}-problem" problems={problemsAt(field)} />
				</div>
			{/each}
		</div>
		{#if elsewhere.length > 0}
			<InlineError id="{ids}-other" problems={elsewhere.map((problem) => ({ ...problem, message: `${problem.path}: ${problem.message}` }))} />
		{/if}
		<div class="mt-1.5 flex items-center gap-1.5">
			<Button
				variant="primary"
				size="tool"
				data-test="rules-save"
				disabled={writeOff.disabled || editor.flushReason !== null}
				title={writeOff.title ?? (editor.flushReason ?? undefined)}
				aria-busy={editor.saving ? "true" : undefined}
				aria-describedby={writeOff.describedby}
				onclick={save}>Save rules</Button
			>
			<span class={hint}>Applies to bookings made or changed from now on.</span>
		</div>
		<ConfigConflict {editor} prefix="settings-rules" />
		<ConfigStepUp {editor} prefix="settings-rules" flush />
		<ConfigStatus {editor} test="settings-rules" />
	{/snippet}
</SectionState>
