<script lang="ts">
	import { Input } from "$lib/components/ui/input/index.ts";
	import { NativeSelect } from "$lib/components/ui/native-select/index.ts";
	import { useApp } from "../context.ts";
	import LoadFailed from "../LoadFailed.svelte";
	import { errorText, field as fieldClass, muted } from "../panes/styles.ts";
	import Field from "./Field.svelte";
	import ModalFrame from "./ModalFrame.svelte";
	import type { ModalContext } from "./modal-context.ts";
	import { Submitter } from "./modal-submit.svelte.ts";
	import { sendInvoice } from "./members-writes.ts";

	/** "Send invoice…" (brief C3 `invoices`): one published add-on and an optional memo. Credits come only when it is
	 * paid, so there is no pending ledger event. When the add-ons could not be read the modal says so. */
	let { context }: { context: ModalContext } = $props();
	const app = useApp();
	const submitter = new Submitter(app, () => context);
	// svelte-ignore state_referenced_locally
	const { write, member } = context;
	/** The add-ons: null while they are being read (the modal says so, it does not offer an empty choice), the error when
	 * they could not be. */
	const items = $derived(Array.isArray(context.invoiceItems) ? context.invoiceItems : []);
	const loading = $derived(context.invoiceItems === null);
	const unreadable = $derived(
		context.invoiceItems === null || Array.isArray(context.invoiceItems) ? null : context.invoiceItems,
	);
	let chosen = $state("");
	const addonId = $derived(chosen !== "" ? chosen : (items[0]?.addonId ?? ""));
	let memo = $state("");
	const item = $derived(items.find((candidate) => candidate.addonId === addonId));
</script>

<ModalFrame
	returnTo={context.returnTo}
	subtitle={`${write.person.name} · ${write.person.id}`}
	confirm={unreadable
		? undefined
		: {
				label: "Send invoice",
				tone: "primary",
				disabled: loading || !item || member === null,
				onConfirm: () => {
					if (item && member)
						submitter.run((withWriter) =>
							sendInvoice(withWriter, member, { addonId: item.addonId, memo: memo.trim() }),
						);
				},
			}}
	busy={submitter.busy}
	onCancel={context.onCancel}
>
	{#snippet heading()}Send invoice · {write.schoolName}{/snippet}
	{#snippet preview()}
		{#if unreadable}
			<span class={errorText}>The invoice items could not be read.</span>
		{:else if loading}
			<span class={muted} data-test="modal-loading">Loading the items…</span>
		{:else if item}
			Stripe emails {write.person.name} an invoice for <b>{item.label}</b>. Credits are granted <b>only when it is paid</b>.
		{:else}
			<b class={errorText}>There is nothing to invoice.</b>
		{/if}
	{/snippet}
	{#if unreadable}
		<LoadFailed error={unreadable} />
	{:else if !loading}
		<Field field="item">
			{#snippet label()}Item{/snippet}
			{#snippet children(id)}
				<NativeSelect {id} data-test="modal-field" data-field="item" value={addonId} options={items.map((candidate) => ({ value: candidate.addonId, label: candidate.label }))} oninput={(event) => (chosen = event.currentTarget.value)} />
			{/snippet}
		</Field>
		<Field field="memo">
			{#snippet label()}Memo (optional){/snippet}
			{#snippet children(id)}
				<Input {id} type="text" autocomplete="off" class={fieldClass} data-test="modal-field" data-field="memo" value={memo} oninput={(event) => (memo = event.currentTarget.value)} />
			{/snippet}
		</Field>
	{/if}
</ModalFrame>
