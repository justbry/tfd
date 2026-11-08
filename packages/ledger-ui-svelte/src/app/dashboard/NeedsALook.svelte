<script lang="ts">
	import KpiValue from "../books/KpiValue.svelte";
	import DashboardBox from "./DashboardBox.svelte";
	import { type Books, flagsOf, shortPeriodName } from "./dashboard-model.ts";
	import { link } from "./styles.ts";

	/** "Needs a look" (mockup Risk): the months with a refund rate over 10% or 3 disputes or more, each with Show ›,
	 * which opens that month. */
	let { books }: { books: Books } = $props();
	const flags = $derived(flagsOf(books.document, books.selected));
</script>

<DashboardBox heading="Needs a look" full>
	{#each flags as flag (flag.period)}
		<div
			class="flex items-center gap-2 border-t border-border py-1.5 first-of-type:border-t-0"
			data-test="dash-flag"
		>
			<span
				class={["size-[7px] flex-none rounded-full", flag.severe ? "bg-destructive" : "bg-warning"]}
				aria-hidden="true"
			></span>
			<span>{shortPeriodName(flag.period)}</span>
			<span class="text-muted-foreground">
				{#if flag.highRate}Refund rate <KpiValue document={books.document} kpi="refund_rate" period={flag.period} />{/if}{#if flag.highRate && flag.manyDisputes}{" · "}{/if}{#if flag.manyDisputes}<KpiValue
						document={books.document}
						kpi="disputes_opened"
						period={flag.period}
					/> disputes{/if}
			</span>
			<span class="ml-auto">
				<button
					type="button"
					class={link}
					aria-label={`Show ${shortPeriodName(flag.period)}`}
					onclick={() => books.choose(flag.period)}>Show ›</button
				>
			</span>
		</div>
	{:else}
		<div class="text-muted-foreground">Nothing unusual in {books.selected.period.slice(0, 4)}.</div>
	{/each}
</DashboardBox>
