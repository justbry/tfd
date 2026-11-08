<script lang="ts">
	import { cellAt } from "../books/kpi-cells.ts";
	import KpiValue from "../books/KpiValue.svelte";
	import BreakdownRows from "./BreakdownRows.svelte";
	import { type Books, seriesStartingWith } from "./dashboard-model.ts";

	/** How donors give (mockup `bkDistHtml`): the donor count, each size bucket and the median gift, as cells, then the
	 * buckets' rows. A count the rules hide is the line alone; no donor yet says so, never "0 donors". */
	let { books }: { books: Books } = $props();
	const document = $derived(books.document);
	const period = $derived(books.selected.period);
	const donors = $derived(cellAt(document, "donors_count", period));
	const buckets = $derived(seriesStartingWith(document, "month", "donors_by_size:"));
</script>

{#if donors === 0}
	<div class="text-muted-foreground">No donations recorded in {period.slice(0, 4)} yet.</div>
{:else if typeof donors !== "number"}
	<div class="mt-0.5 mb-2 text-[12.5px]" data-test="donor-line">
		<KpiValue {document} kpi="donors_count" {period} /> donors
	</div>
{:else}
	<div class="mt-0.5 mb-2 text-[12.5px]" data-test="donor-line">
		<b><KpiValue {document} kpi="donors_count" {period} /> donors</b>:
		{#each buckets as kpi, index (kpi)}{#if index > 0}{", "}{/if}<KpiValue {document} {kpi} {period} />
			{document.meta[kpi]?.title}{/each}; median gift <KpiValue {document} kpi="donors_median_gift" {period} />
	</div>
	<BreakdownRows {books} kpis={buckets} marked={false} />
{/if}
