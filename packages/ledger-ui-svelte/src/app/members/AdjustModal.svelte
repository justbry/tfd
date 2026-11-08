<script lang="ts">
	import { Input } from "$lib/components/ui/input/index.ts";
	import { NativeSelect } from "$lib/components/ui/native-select/index.ts";
	import { useApp } from "../context.ts";
	import { errorText, field as fieldClass } from "../panes/styles.ts";
	import Field from "./Field.svelte";
	import ModalFrame from "./ModalFrame.svelte";
	import type { ModalContext } from "./modal-context.ts";
	import { Submitter } from "./modal-submit.svelte.ts";
	import { capitalized, project } from "./members-model.ts";
	import { adjustCredits } from "./members-writes.ts";
	import NoteField from "./NoteField.svelte";

	/** "Adjust <credits>…" (brief C2 `credits/adjust`): a type, a signed whole number and a note; the preview shows the
	 * balance before and after, or the problem. The pending change shows as a ledger event and in the balance. */
	let { context }: { context: ModalContext } = $props();
	const app = useApp();
	const submitter = new Submitter(app, () => context);

	const kinds = [
		["goodwill", "Goodwill"],
		["gift", "Gift"],
		["correction", "Correction"],
	] as const;
	const noteLength = 3;
	let kind = $state<(typeof kinds)[number][0]>("goodwill");
	let delta = $state("2");
	let note = $state("");
	// svelte-ignore state_referenced_locally
	const { write, member } = context;
	/** What is available now, a pending change included (the balance the roster and the drawer show). */
	const available = $derived.by(() => {
		const balance = member?.balances[0];
		return balance ? project(balance, write.person.id, context.changes).available : 0;
	});
	const amount = $derived(Number(delta));
	const problem = $derived(
		!Number.isInteger(amount) || amount === 0
			? "Enter a whole number other than 0."
			: kind === "gift" && amount < 0
				? "A gift must be positive."
				: available + amount < 0
					? `Would go below zero (${available} available).`
					: null,
	);
	const { person, unit } = write;
</script>

<ModalFrame
	returnTo={context.returnTo}
	subtitle={`${person.name} · ${person.id}`}
	confirm={{
		label: "Apply",
		tone: "primary",
		disabled: problem !== null || note.trim().length < noteLength || member === null,
		onConfirm: () => {
			if (member)
				submitter.run((withWriter) =>
					adjustCredits(withWriter, member, { kind, amount, note: note.trim() }),
				);
		},
	}}
	busy={submitter.busy}
	onCancel={context.onCancel}
>
	{#snippet heading()}Adjust {unit.other} · {write.schoolName}{/snippet}
	{#snippet preview()}
		{#if problem === null}
			{person.name}: <b>{available} → {available + amount}</b> available.{kind === "gift" ? ` Gift ${unit.other} expire after 6 months.` : ""}
		{:else}
			<b class={errorText}>{problem}</b>
		{/if}
	{/snippet}
	<Field field="type">
		{#snippet label()}Type{/snippet}
		{#snippet children(id)}
			<NativeSelect
				{id}
				data-test="modal-field"
				data-field="type"
				value={kind}
				options={kinds.map(([value, label]) => ({ value, label }))}
				oninput={(event) => {
					const chosen = kinds.find(([value]) => value === event.currentTarget.value);
					if (chosen) kind = chosen[0];
				}}
			/>
		{/snippet}
	</Field>
	<Field field="delta">
		{#snippet label()}{capitalized(unit.other)} (negative to remove){/snippet}
		{#snippet children(id)}
			<Input
				{id}
				type="number"
				step="1"
				class={fieldClass}
				data-test="modal-field"
				data-field="delta"
				defaultValue="2"
				value={delta}
				oninput={(event) => (delta = event.currentTarget.value)}
			/>
		{/snippet}
	</Field>
	<NoteField onInput={(next) => (note = next)} />
</ModalFrame>
