<script lang="ts">
	/** A chart's legend (mockup `kleg`): a swatch and a name per series. */
	let { items }: { items: ReadonlyArray<readonly [name: string, color: string]> } =
		$props();
</script>

<span
	class="flex flex-wrap justify-end gap-2.5 text-[10.5px] font-normal tracking-normal text-muted-foreground normal-case"
>
	{#each items as [name, color] (name)}
		<span class="inline-flex items-center"
			><i class="mr-1 inline-block size-2 rounded-[2px]" style:background={color}></i>{name}</span
		>
	{/each}
</span>
