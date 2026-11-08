<script lang="ts">
	import { shortPeriodName } from "./dashboard-model.ts";

	/** The period labels under a chart (mockup `kaxis`), as HTML so they keep their size when the chart scales; the
	 * selected one bold. */
	let { periods, selected }: { periods: readonly string[]; selected: string } =
		$props();
</script>

<div
	class="mt-[3px] grid"
	aria-hidden="true"
	style:grid-template-columns={`repeat(${periods.length}, 1fr)`}
>
	{#each periods as period (period)}
		<span
			class={[
				"rounded text-center text-[11px] leading-4",
				period === selected ? "font-semibold text-foreground" : "text-muted-foreground",
			]}>{shortPeriodName(period)}</span
		>
	{/each}
</div>
