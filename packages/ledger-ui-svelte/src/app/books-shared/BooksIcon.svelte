<script lang="ts">
	import { cn } from "$lib/utils.ts";
	import PaneIcon from "../PaneIcon.svelte";
	import { type BooksIconName, booksShapes, isBooksIcon } from "./books-icons.ts";

	/** `PaneIcon` for the icons of the Ledger and Reports tabs too. Decorative: the text beside it carries the name. */
	let { name, class: className = "" }: { name: BooksIconName; class?: string } = $props();
</script>

{#if isBooksIcon(name)}
	<svg class={cn("icon", className)} viewBox="0 0 24 24" aria-hidden="true">
		{#each booksShapes[name] as shape, index (index)}
			{#if shape.tag === "path"}
				<path d={shape.d} />
			{:else if shape.tag === "circle"}
				<circle cx={shape.cx} cy={shape.cy} r={shape.r} />
			{:else}
				<rect x={shape.x} y={shape.y} width={shape.width} height={shape.height} rx={shape.rx} />
			{/if}
		{/each}
	</svg>
{:else}
	<PaneIcon {name} class={className} />
{/if}
