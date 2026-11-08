<script lang="ts">
	import Icon from "../../../../app/Icon.svelte";
	import { cn, type WithElementRef } from "$lib/utils.js";
	import type { HTMLSelectAttributes } from "svelte/elements";

	type NativeSelectProps = Omit<
		WithElementRef<HTMLSelectAttributes, HTMLSelectElement>,
		"size" | "children" | "value"
	> & {
		size?: "sm" | "default";
		/** The chosen option's value. The select reports a pick through `oninput`; it does not bind. */
		value: string;
		/** The options, rather than option children: a select that renders snippet children needs Svelte's
		 * customizable-select runtime in the first page load (the panes loaded on demand share the entry's runtime). */
		options: ReadonlyArray<{ value: string | number; label: string }>;
	};

	let {
		ref = $bindable(null),
		value,
		options,
		class: className,
		size = "default",
		...restProps
	}: NativeSelectProps = $props();

	// The chosen option is set from the value, not marked in each option: a `selected` attribute needs Svelte's
	// option runtime in the first page load (the panes loaded on demand share the entry's runtime).
	$effect(() => {
		if (ref) ref.value = value;
	});
</script>

<div
	class={cn(
		"group/native-select relative w-full has-[select:disabled]:opacity-50",
		className
	)}
	data-slot="native-select-wrapper"
	data-size={size}
>
	<select
		bind:this={ref}
		data-slot="native-select"
		data-size={size}
		class="h-auto w-full min-w-0 appearance-none rounded-md border border-border bg-card py-1 pr-7 pl-2 text-[12px] text-foreground outline-none select-none focus-visible:border-ring disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50"
		{...restProps}
	>
		{#each options as option (option.value)}
			<option {...{ value: option.value }}>{option.label}</option>
		{/each}
	</select>
	<Icon name="chevronDown" class="text-muted-foreground top-1/2 right-2.5 size-3.5 -translate-y-1/2 pointer-events-none absolute select-none" />
</div>
