<script lang="ts">
	import type { Snippet } from "svelte";
	import * as Card from "$lib/components/ui/card/index.ts";

	/** A box of the Dashboard's grid (mockup `kbox`): an uppercase heading with an optional legend at its end, then the
	 * chart or rows. `full` spans the grid's width. */
	let {
		heading,
		legend,
		full = false,
		children,
	}: {
		heading: string;
		legend?: Snippet;
		full?: boolean;
		children: Snippet;
	} = $props();
</script>

<Card.Root
	class={[
		"block min-w-0 gap-0 overflow-visible rounded-xl border border-border px-3 py-2.5 text-[12px] ring-0",
		full && "col-span-full",
	]}
>
	<h3
		class="m-0 mb-1.5 flex justify-between gap-2 text-[10.5px] font-semibold tracking-[.05em] text-muted-foreground uppercase"
	>
		<span>{heading}</span>{@render legend?.()}
	</h3>
	{@render children()}
</Card.Root>
