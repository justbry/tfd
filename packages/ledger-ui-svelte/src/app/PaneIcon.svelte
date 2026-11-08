<script lang="ts">
	import { cn } from "$lib/utils.ts";
	import Icon from "./Icon.svelte";
	import { isPaneIcon, type PaneIconName, paneShapes } from "./pane-icons.ts";

	/** `Icon` for the icons of the Bookings and Members panes too (pane-icons.ts). Decorative: the button or text
	 * beside it carries the name. */
	let { name, class: className = "" }: { name: PaneIconName; class?: string } = $props();
</script>

{#if isPaneIcon(name)}
	<svg
		class={cn("icon", name === "more" && "fill-current", className)}
		viewBox="0 0 24 24"
		aria-hidden="true"
	>
		{#each paneShapes[name] as shape, index (index)}
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
	<Icon {name} class={className} />
{/if}
