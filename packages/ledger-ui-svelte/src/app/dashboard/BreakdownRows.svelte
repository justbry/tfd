<script lang="ts">
	import { numberAt } from "../books/kpi-cells.ts";
	import KpiValue from "../books/KpiValue.svelte";
	import { type Books, chartColors } from "./dashboard-model.ts";
	import ReasonLine from "./ReasonLine.svelte";
	import { bar, figure, row, track } from "./styles.ts";

	/** Rows of one period's breakdown (plans, funds, kinds of income, donor sizes): a bar for a figure, an empty track
	 * for a cell that is no number; then the reason of every row the rules hid. */
	let {
		books,
		kpis,
		marked = true,
	}: { books: Books; kpis: readonly string[]; marked?: boolean } = $props();

	const values = $derived(
		kpis.map((kpi) => numberAt(books.document, kpi, books.selected.period)),
	);
	const largest = $derived(
		Math.max(1, ...values.filter((value) => value !== null)),
	);
</script>

{#each kpis as kpi, index (kpi)}
	{@const title = books.document.meta[kpi]?.title ?? kpi}
	{@const value = values[index] ?? null}
	<div class={row}>
		<span class="truncate" {title}>{title}</span>
		<div class={track}>
			{#if value !== null}
				<i
					class={bar}
					style:width={`${(Math.max(0, value) / largest) * 100}%`}
					style:background={chartColors[index % chartColors.length]}
				></i>
			{/if}
		</div>
		<b class={figure}>
			<KpiValue document={books.document} {kpi} period={books.selected.period} {marked} />
		</b>
	</div>
{/each}
<ReasonLine {books} {kpis} />
