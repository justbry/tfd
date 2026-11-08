<script lang="ts">
	import { cn } from "$lib/utils.ts";
	import { type IconName, shapesNamed } from "./icons.ts";

	/** Decorative: the button or text beside it carries the name. */
	let { name, class: className = "" }: { name: IconName; class?: string } =
		$props();
</script>

<svg class={cn("icon", className)} viewBox="0 0 24 24" aria-hidden="true">
	{#each shapesNamed(name) as shape, index (index)}
		{#if shape.tag === "path"}
			<path d={shape.d} />
		{:else if shape.tag === "circle"}
			<circle cx={shape.cx} cy={shape.cy} r={shape.r} />
		{:else}
			<rect
				x={shape.x}
				y={shape.y}
				width={shape.width}
				height={shape.height}
				rx={shape.rx}
			/>
		{/if}
	{/each}
</svg>
