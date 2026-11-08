<script lang="ts">
	import { count, type Plan } from "$contract/app/portal-format.ts";
	import type { PortalMember } from "$contract/data/portal.ts";
	import { Button } from "$lib/components/ui/button/index.ts";
	import PaneIcon from "../PaneIcon.svelte";
	import { checkLabel, field, fieldBox, fieldLabel, preview as previewClass } from "../panes/styles.ts";
	import PortalDialog from "./PortalDialog.svelte";

	/** Cancel membership (mockup `vAct('cancel')`): a member cancels at the end of the period only; the reason is optional
	 * and travels only when it has text. */
	let {
		viewed,
		plan,
		onClose,
		onConfirm,
	}: {
		viewed: PortalMember;
		plan: Plan;
		onClose: () => void;
		onConfirm: (reason: string) => void;
	} = $props();

	let reason = $state("");
	const reasonId = $props.id();
	const left = $derived(viewed.balances.map((balance) => count(balance.available, balance.unit)).join(" and "));
</script>

<PortalDialog detail={plan.label} {onClose}>
	{#snippet heading()}<PaneIcon name="ban" class="mr-1 inline" /> Cancel membership · {viewed.name}{/snippet}
	<div class={fieldBox}>
		<label class={checkLabel}>
			<input type="radio" name="cancel-when" checked /> At the end of this period ({plan.endsOn})
		</label>
	</div>
	<div class={fieldBox}>
		<label for={reasonId} class={fieldLabel}>Reason (optional; required to cancel right now)</label>
		<textarea
			id={reasonId}
			class={[field, "min-h-11 resize-y"]}
			data-test="cancel-reason"
			bind:value={reason}
		></textarea>
	</div>
	<div class={previewClass} data-test="dialog-preview">
		Stays active until {plan.endsOn}. {left} can still be used until then. No further charges.
	</div>
	{#snippet footer()}
		<Button variant="tool" size="tool" data-test="dialog-cancel" data-autofocus onclick={onClose}>Keep membership</Button>
		<Button variant="tool" size="tool" class="border-destructive text-destructive" data-test="dialog-confirm" onclick={() => onConfirm(reason.trim())}>
			Cancel membership
		</Button>
	{/snippet}
</PortalDialog>
