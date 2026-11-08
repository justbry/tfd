<script lang="ts">
	import type { MemberBalance } from "$contract/data/members.ts";
	import { barOf, type Projection } from "./members-model.ts";

	/** Used, held for bookings and available, out of what was granted (mockup `bar3`). The widths are the model's
	 * percentages of the whole bar; the segments carry their counts. */
	let { balance, projection }: { balance: MemberBalance; projection: Projection } = $props();
	const bar = $derived(barOf(balance, projection));
	const segments = [
		{ name: "used", tone: "bg-muted-foreground opacity-55" },
		{ name: "held", tone: "bg-[repeating-linear-gradient(135deg,var(--warning)_0_3px,transparent_3px_6px)]" },
		{ name: "available", tone: "bg-primary group-data-[low]/bar:bg-warning" },
	] as const;
</script>

<div
	class="group/bar flex h-[7px] min-w-[90px] overflow-hidden rounded bg-secondary"
	data-test="balance-bar"
	data-low={bar.low ? "" : undefined}
	title={`used ${projection.used} · held ${projection.held} · available ${projection.available}`}
>
	{#each segments as segment (segment.name)}
		<i
			class={["block h-full", segment.tone]}
			data-test="bar-segment"
			data-segment={segment.name}
			data-count={projection[segment.name]}
			style:width={bar.percents[segment.name]}
		></i>
	{/each}
</div>
