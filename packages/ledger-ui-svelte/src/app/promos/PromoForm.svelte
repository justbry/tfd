<script lang="ts">
	import type { CreditUnit, PromoType } from "$contract/data/ledger.ts";
	import { Button } from "$lib/components/ui/button/index.ts";
	import * as Dialog from "$lib/components/ui/dialog/index.ts";
	import { Input } from "$lib/components/ui/input/index.ts";
	import { Textarea } from "$lib/components/ui/textarea/index.ts";
	import {
		control,
		field,
		fieldLabel,
		footer,
		modal,
		muted,
		preview as previewBox,
		selectControl,
	} from "../plans/styles.ts";
	import { capitalise, defaultValue, minimumNoteLength, previewLine } from "./promos-model.ts";

	/** Create promo (mockup `ACT.code`): the type, the value, the expiry and the note the audit keeps. `create` resolves
	 * true once the Writer has answered, false (after telling the person) if it failed. */
	let {
		schoolName,
		unit,
		currency,
		defaultExpires,
		create,
		onCancel,
	}: {
		schoolName: string;
		unit: CreditUnit;
		currency: string;
		defaultExpires: string;
		create: (type: PromoType, value: number, expires: string, note: string) => Promise<boolean>;
		onCancel: () => void;
	} = $props();

	const ids = $props.id();
	let type = $state<PromoType>("member");
	let value = $state(defaultValue);
	// svelte-ignore state_referenced_locally
	let expires = $state(defaultExpires);
	let note = $state("");
	let busy = $state(false);
	const shown = $derived(previewLine(type, value, expires, unit, currency));
	const send = async (): Promise<void> => {
		busy = true;
		const amount = Number(value);
		const created = await create(type, type === "dollar" ? Math.round(amount * 100) : amount, expires, note.trim());
		if (!created) busy = false;
	};
</script>

<Dialog.Root open onOpenChange={(open) => !open && onCancel()}>
	<Dialog.Content showCloseButton={false} class={[modal, "top-10 translate-y-0"]} overlayClass="bg-black/50 supports-backdrop-filter:backdrop-blur-none" data-test="dialog">
		<Dialog.Title>
			{#snippet child({ props })}
				<h3 {...props} class="m-0 text-[14px] font-semibold" data-test="dialog-title">Create promo · {schoolName}</h3>
			{/snippet}
		</Dialog.Title>
		<Dialog.Description class={[muted, "text-[12px]"]}>New promo</Dialog.Description>
		<div class={field}>
			<label class={fieldLabel} for={`${ids}-type`}>Type</label>
			<select
				id={`${ids}-type`}
				class={selectControl}
				data-test="promo-type-input"
				oninput={(event) => {
					const chosen = event.currentTarget.value;
					if (chosen === "member" || chosen === "dollar" || chosen === "session") type = chosen;
				}}
			>
				<option value="member" selected={type === "member"}>Member % off</option>
				<option value="dollar" selected={type === "dollar"}>Dollar gift certificate</option>
				<option value="session" selected={type === "session"}>{`${capitalise(unit.one)} gift certificate`}</option>
			</select>
		</div>
		<div class={field}>
			<label class={fieldLabel} for={`${ids}-value`}>{`Value (% off, dollars or ${unit.other})`}</label>
			<Input id={`${ids}-value`} type="number" step="0.01" class={control} data-test="promo-value-input" bind:value />
		</div>
		<div class={field}>
			<label class={fieldLabel} for={`${ids}-expires`}>Expires</label>
			<Input id={`${ids}-expires`} type="date" class={control} data-test="promo-expires-input" bind:value={expires} />
		</div>
		<div class={field}>
			<label class={fieldLabel} for={`${ids}-note`}>Note (required)</label>
			<Textarea id={`${ids}-note`} placeholder="Why, and who asked" class={[control, "min-h-11 resize-y"]} data-test="promo-note-input" bind:value={note} />
		</div>
		<div class={previewBox} data-test="promo-preview">
			{#if shown.error}<b class="text-destructive">{shown.strong}</b>{:else}{shown.before}<b>{shown.strong}</b>{shown.after}{/if}
		</div>
		<div class={footer}>
			<Button variant="tool" size="tool" data-test="dialog-cancel" onclick={onCancel}>Cancel</Button>
			<Button
				variant="primary"
				size="tool"
				data-test="dialog-confirm"
				aria-busy={busy}
				disabled={busy || shown.error || note.trim().length < minimumNoteLength}
				onclick={send}>Create promo</Button
			>
		</div>
	</Dialog.Content>
</Dialog.Root>
