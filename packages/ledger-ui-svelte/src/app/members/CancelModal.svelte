<script lang="ts">
	import { onDestroy } from "svelte";
	import { Badge } from "$lib/components/ui/badge/index.ts";
	import { useApp } from "../context.ts";
	import PaneIcon from "../PaneIcon.svelte";
	import { checkLabel, field as fieldClass, paneBadge } from "../panes/styles.ts";
		import Field from "./Field.svelte";
	import ModalFrame from "./ModalFrame.svelte";
	import type { ModalContext } from "./modal-context.ts";
	import { Submitter } from "./modal-submit.svelte.ts";
	import { countOf, project } from "./members-model.ts";
	import { cancelMembership } from "./members-writes.ts";

	/** "Cancel membership…" (not built in buzz-school yet): at the end of the period, or right now with a reason of 3
	 * or more characters; the preview says what stays usable or is forfeited. */
	let { context }: { context: ModalContext } = $props();
	const app = useApp();
	const submitter = new Submitter(app, () => context);
	onDestroy(() => submitter.cancel());
	const noteLength = 3;
	// svelte-ignore state_referenced_locally
	const { write, member, changes } = context;
	let at = $state<"period_end" | "now">("period_end");
	let reason = $state("");
	const balance = member?.balances[0];
	const available = balance ? project(balance, write.person.id, changes).available : 0;
	const now = $derived(at === "now");
</script>

{#snippet choice(value: "period_end" | "now", text: string, withBadge: boolean)}
	<label class={checkLabel} data-test="modal-field-label" data-field="when" data-value={value}>
		<input type="radio" name="when" {...{ value }} data-test="modal-field" data-field="when" checked={at === value} onchange={() => (at = value)} />
		<span>{text}{#if withBadge}{" "}<Badge class={paneBadge}>Admin</Badge>{/if}</span>
	</label>
{/snippet}

<ModalFrame
	subtitle={member ? `${member.tierName} ×${member.quantity}` : undefined}
	cancelLabel="Keep membership"
	confirm={{
		label: "Cancel membership",
		tone: "destructive",
		disabled: (now && reason.trim().length < noteLength) || member === null,
		onConfirm: () => {
			if (member)
				submitter.run((withWriter) =>
					cancelMembership(withWriter, member, { at, reason: reason.trim(), available }),
				);
		},
	}}
	busy={submitter.busy}
	onCancel={context.onCancel}
>
	{#snippet heading()}<PaneIcon name="ban" class="mr-1 inline" /> Cancel membership · {write.person.name}{/snippet}
	{#snippet preview()}
		{#if now}
			Ends today. <b>{countOf(available, write.unit)}</b> unused are forfeited. No refund is issued automatically: use Refund on an invoice if one is owed.
		{:else}
			{`Stays active until ${write.renewal}. ${countOf(available, write.unit)} can still be used until then. No further charges.`}
		{/if}
	{/snippet}
	{@render choice("period_end", `At the end of this period (${write.renewal})`, false)}
	{@render choice("now", "Right now", true)}
	<Field field="reason">
		{#snippet label()}Reason (optional; required to cancel right now){/snippet}
		{#snippet children(id)}
			<textarea {id} class={[fieldClass, "min-h-11 resize-y"]} data-test="modal-field" data-field="reason" oninput={(event) => (reason = event.currentTarget.value)}></textarea>
		{/snippet}
	</Field>
</ModalFrame>
