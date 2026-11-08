<script lang="ts">
	import { cn } from "$lib/utils.ts";
	import { type PaneIconName, shapesOf } from "./late-icons.ts";

	/** An icon of a pane loaded on demand: the shell's own and the late ones (late-icons.ts). Decorative: the button or
	 * text beside it carries the name. */
	let { name, class: className = "" }: { name: PaneIconName; class?: string } =
		$props();
</script>

<svg class={cn("icon", className)} viewBox="0 0 24 24" aria-hidden="true">
	{#each shapesOf(name) as shape, index (index)}
		{#if shape.tag === "path"}
			<path d={shape.d} />
		{:else if shape.tag === "circle"}
			<circle cx={shape.cx} cy={shape.cy} r={shape.r} />
		{:else}
			<rect x={shape.x} y={shape.y} width={shape.width} height={shape.height} rx={shape.rx} />
		{/if}
	{/each}
</svg>
