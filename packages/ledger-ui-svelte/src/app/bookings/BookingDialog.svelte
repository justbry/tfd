<script lang="ts">
	import type { ConsequenceLine } from "$contract/app/booking-text.ts";
	import { Button } from "$lib/components/ui/button/index.ts";
	import AppDialog from "../panes/AppDialog.svelte";
	import { checkLabel, modalFooter, muted, preview } from "../panes/styles.ts";

	/** The mockup's modal for No-show and for Release hold inside the cutoff: a title, the booking line, the waive
	 * box where it applies, Cancel and the action. Focus starts on Cancel. */
	let {
		title,
		detail,
		confirmLabel,
		waiveLabel,
		consequence,
		busy = false,
		onConfirm,
		onCancel,
	}: {
		/** "Mark no-show · Vibes of Light". */
		title: string;
		/** The booking line: item, booking id, member and member key. */
		detail: string;
		confirmLabel: string;
		/** The label of the "Waive the late-cancel forfeit" box, for a release inside the cutoff; without it, no box. */
		waiveLabel?: string | undefined;
		/** What the action does to the member's credits, from the Waive box; null leaves the line out. */
		consequence?: (waive: boolean) => ConsequenceLine | null;
		/** A write is on its way: the confirm button waits and Escape leaves the dialog open. */
		busy?: boolean;
		onConfirm: (waiveCutoff: boolean) => void;
		onCancel: () => void;
	} = $props();

	let waive = $state(false);
	const line = $derived(consequence?.(waive));
</script>

<AppDialog hooks="dialog" {busy} onClose={onCancel}>
	{#snippet heading()}{title}{/snippet}
	<div class={muted}>{detail}</div>
	{#if waiveLabel}
		<label class={checkLabel}>
			<input type="checkbox" data-test="waive-cutoff" checked={waive} onchange={(event) => (waive = event.currentTarget.checked)} />
			{waiveLabel}
		</label>
	{/if}
	{#if line}
		<div class={preview} aria-live="polite">
			{line.before}{#if line.strong}<b>{line.strong}</b>{/if}{line.after}
		</div>
	{/if}
	<div class={modalFooter}>
		<Button variant="tool" size="tool" data-test="dialog-cancel" data-autofocus onclick={onCancel}>Cancel</Button>
		<Button
			variant="primary"
			size="tool"
			data-test="dialog-confirm"
			disabled={busy}
			aria-busy={busy ? "true" : undefined}
			onclick={() => onConfirm(waive)}
		>
			{confirmLabel}
		</Button>
	</div>
</AppDialog>
