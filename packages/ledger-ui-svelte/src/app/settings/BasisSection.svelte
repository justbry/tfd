<script lang="ts">
	import { monthAndDay } from "$contract/app/period.ts";
	import { basisExample } from "$contract/data/settings.ts";
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
	import { control, heading, muted, row, sectionNote, segment, segmentButton } from "./styles.ts";

	/** Accounting basis (mockup `#bsave`): cash or deferred, and the day the saved basis applies from. It is the `settings`
	 * object of the ledger's config, so Save is the Worker's verify then PUT (owner only, the family PIN's step-up): the
	 * toast says it was saved, and the stored copy's ETag below says which copy now holds it. */
	let {
		editor,
		money,
		writeOff,
	}: {
		editor: ConfigEditor<"settings">;
		money: (minorUnits: number) => string;
		writeOff: { disabled: boolean; title: string | undefined; describedby: string | undefined };
	} = $props();

	const bases = ["cash", "deferred"] as const;
	const app = useApp();
	const fromId = $props.id();
	const problemsAt = (path: string) => editor.problems.filter((problem) => problem.path === path);
	const elsewhere = $derived(editor.problems.filter((problem) => problem.path !== "basis" && problem.path !== "basisFrom"));
	const save = async (): Promise<void> => {
		const { value } = editor;
		if (!value) return;
		// What the toast says is what was sent: the basis and the day at the click.
		const text = `Accounting basis saved: ${value.basis} from ${monthAndDay(value.basisFrom)}. Logged as a policy change.`;
		if ((await editor.save({ flush: true })) !== "saved") return;
		notifySuccess(
			app,
			editor.lastChanged === false ? "Nothing to change: the ledger already holds this basis." : text,
		);
	};
	// svelte-ignore state_referenced_locally
	editor.onFirstProblem(() => document.querySelector<HTMLElement>("[data-test=basis-from][aria-invalid=true]")?.focus());
</script>

<h5 class={heading} data-test="settings-section" data-section="basis">
	<Icon name="scale" /> Accounting basis
</h5>
<SectionState {editor} reading="the school's settings" test="settings-basis">
	{#snippet children(value)}
		{@const cash = value.basis === "cash"}
		<div class={[segment, "self-start"]} role="group" aria-label="Accounting basis">
			{#each bases as basis (basis)}
				<button
					type="button"
					class={segmentButton}
					aria-pressed={value.basis === basis}
					data-test="basis-option"
					data-basis={basis}
					disabled={writeOff.disabled}
					title={writeOff.title}
					aria-describedby={writeOff.describedby}
					onclick={() => editor.edit((current) => ({ ...current, basis }))}
				>
					{basis === "cash" ? "Cash" : "Deferred"}
				</button>
			{/each}
		</div>
		<InlineError id="{fromId}-basis" problems={problemsAt("basis")} />
		<p class={[muted, "my-2"]} data-test="basis-note">
			{cash
				? "Income counts when the money arrives."
				: "Income counts as the service is given. Gifts are a liability until redeemed."}{" "}
			A {money(basisExample.yearly)} yearly plan counts
			<b>{cash ? ` ${money(basisExample.yearly)} at once` : ` ${money(basisExample.monthly)} a month`}</b>.
		</p>
		<div class={row}>
			<label class={muted} for={fromId}>From</label>
			<Input
				id={fromId}
				type="date"
				class="h-auto w-auto rounded-md border border-border bg-card px-2 py-1 text-[12px] md:text-[12px]"
				data-test="basis-from"
				value={value.basisFrom}
				aria-invalid={problemsAt("basisFrom").length > 0}
				aria-describedby={writeOff.describedby ?? `${fromId}-problem`}
				disabled={writeOff.disabled}
				title={writeOff.title}
				oninput={(event) => editor.edit((current) => ({ ...current, basisFrom: event.currentTarget.value }))}
			/>
			<Button
				variant="primary"
				size="tool"
				data-test="basis-save"
				disabled={writeOff.disabled || editor.flushReason !== null}
				title={writeOff.title ?? (editor.flushReason ?? undefined)}
				aria-busy={editor.saving ? "true" : undefined}
				aria-describedby={writeOff.describedby}
				onclick={save}>Save</Button
			>
		</div>
		<InlineError id="{fromId}-problem" problems={problemsAt("basisFrom")} />
		{#if elsewhere.length > 0}
			<InlineError
				id="{fromId}-other"
				problems={elsewhere.map((problem) => ({ ...problem, message: `${problem.path}: ${problem.message}` }))}
			/>
		{/if}
		<ConfigConflict {editor} prefix="settings-basis" />
		<ConfigStepUp {editor} prefix="settings-basis" flush />
		<ConfigStatus {editor} test="settings-basis" />
	{/snippet}
</SectionState>
