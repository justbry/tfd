<script lang="ts">
	import { Button } from "$lib/components/ui/button/index.ts";
	import Icon from "../Icon.svelte";
	import PaneIcon from "../PaneIcon.svelte";
	import { muted } from "./styles.ts";

	/** A read nothing provides yet (the contract's "not available": a gap, never a 0 or fixture data), in place of what it
	 * would have shown: what is missing and why, what to do (the actionable line), and a way to look again. The toast
	 * for the same failure is the message table's; this is the pane's own, worded for its screen. */
	let {
		title,
		what,
		doThis,
		onCheck,
		busy = false,
		test,
	}: {
		title: string;
		what: string;
		doThis: string;
		onCheck?: () => void;
		busy?: boolean;
		test: string;
	} = $props();
</script>

<div
	class="mt-2 flex items-start gap-2 rounded-xl border border-dashed border-border bg-card p-3 text-foreground"
	data-test={test}
	data-kind="not_available"
>
	<Icon name="info" class="mt-px text-muted-foreground" />
	<div class="flex flex-col gap-0.5">
		<b>{title}</b>
		<span>{what}</span>
		<span class={muted}>{doThis}</span>
		{#if onCheck}
			<Button
				variant="tool"
				size="tool-small"
				class="mt-1 self-start aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
				data-test="not-available-check"
				aria-disabled={busy ? "true" : undefined}
				onclick={() => {
					if (!busy) onCheck?.();
				}}><PaneIcon name="undo" />{busy ? "Checking…" : "Check again"}</Button
			>
		{/if}
	</div>
</div>
