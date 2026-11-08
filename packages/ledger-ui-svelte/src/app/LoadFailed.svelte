<script lang="ts">
	import { Button } from "$lib/components/ui/button/index.ts";
	import { messageFor } from "../effect/messages.ts";
	import type { UiError } from "../effect/ui-error.ts";
	import Icon from "./Icon.svelte";

	/** A read that failed, in place of what it would have shown (never an empty table): the message table's text,
	 * the same as the toast's, and Retry when the screen offers it. While a retry is on its way (`busy`) the message
	 * stays and Retry says so: aria-disabled rather than disabled, so that the focus on it stays. */
	let {
		error,
		onRetry,
		busy = false,
	}: { error: UiError; onRetry?: (() => void) | undefined; busy?: boolean } = $props();
	const message = $derived(messageFor(error));
</script>

<div
	class="m-3.5 flex items-start gap-2 rounded-xl border border-destructive p-3 text-foreground"
	data-test="load-failed"
	data-kind={error.kind}
>
	<Icon name="alert" class="mt-px text-destructive" />
	<div class="flex flex-col gap-0.5">
		<b>{message.title}</b>
		<span>{message.what}</span>
		<span class="text-muted-foreground">{message.doThis}</span>
		{#if onRetry}
			<Button
				variant="tool"
				size="tool-small"
				class="mt-1 self-start aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
				data-test="load-retry"
				aria-disabled={busy ? "true" : undefined}
				onclick={() => {
					// While the retry is on its way the button keeps focus and says so, but does nothing.
					if (!busy) onRetry?.();
				}}
			>
				{busy ? "Retrying…" : "Retry"}
			</Button>
		{/if}
	</div>
</div>
