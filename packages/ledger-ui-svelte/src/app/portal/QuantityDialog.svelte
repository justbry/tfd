<script lang="ts">
	import type { PortalMember } from "$contract/data/portal.ts";
	import type { School } from "$contract/data/types.ts";
	import type { Plan } from "$contract/app/portal-format.ts";
	import { Button } from "$lib/components/ui/button/index.ts";
	import { formatMoney } from "../books-shared/books-text.ts";
	import PaneIcon from "../PaneIcon.svelte";
	import { field, fieldBox, fieldLabel, preview as previewClass } from "../panes/styles.ts";
	import PortalDialog from "./PortalDialog.svelte";

	/** Change amount (mockup `vAct('qty')`): the amounts the plan is sold in, and what choosing one does. A decrease waits
	 * for the renewal; the price of an increase and what it grants now are the server's, so the preview names only the
	 * price from the renewal on. */
	let {
		school,
		viewed,
		plan,
		onClose,
		onConfirm,
	}: {
		school: School;
		viewed: PortalMember;
		plan: Plan;
		onClose: () => void;
		onConfirm: (quantity: number) => void;
	} = $props();

	// svelte-ignore state_referenced_locally
	let chosen = $state(plan.quantity);
	const selectId = $props.id();
	const options = $derived(viewed.quantityOptions ?? []);
	const price = $derived(
		formatMoney(
			options.find((option) => option.quantity === chosen)?.priceCents ?? plan.priceCents,
			school.currency,
		),
	);
	const unit = $derived(school.creditUnit.other);
</script>

<PortalDialog detail={`${viewed.tierName} · now ×${plan.quantity}`} {onClose}>
	{#snippet heading()}<PaneIcon name="sliders" class="mr-1 inline" /> Change amount · {viewed.name}{/snippet}
	<div class={fieldBox}>
		<label for={selectId} class={fieldLabel}>New amount</label>
		<select
			id={selectId}
			class={field}
			data-test="quantity-select"
			oninput={(event) => (chosen = Number(event.currentTarget.value))}
		>
			{#each options as { quantity } (quantity)}
				<option value={quantity} selected={quantity === chosen}>{quantity}{quantity === plan.quantity ? " (current)" : ""}</option>
			{/each}
		</select>
	</div>
	<div class={previewClass} data-test="dialog-preview">
		{#if chosen < plan.quantity}
			From {plan.endsOn}: <b>{price}</b> / month with fewer {unit} each month. <b>No refund</b>, and {unit} now are unchanged until then.
		{:else if chosen > plan.quantity}
			The difference is charged now, prorated by the school's billing. From {plan.endsOn}: <b>{price}</b> / month.
		{:else}
			No change.
		{/if}
	</div>
	{#snippet footer()}
		<Button variant="tool" size="tool" data-test="dialog-cancel" data-autofocus onclick={onClose}>Cancel</Button>
		<Button variant="primary" size="tool" data-test="dialog-confirm" disabled={chosen === plan.quantity} onclick={() => onConfirm(chosen)}>Confirm</Button>
	{/snippet}
</PortalDialog>
