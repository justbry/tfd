<script lang="ts">
	import { cellKind } from "$contract/data/kpi-document.ts";
	import { cellAt, numberAt } from "../books/kpi-cells.ts";
	import KpiValue from "../books/KpiValue.svelte";
	import { type Books, periodsOf, shortPeriodName } from "./dashboard-model.ts";
	import { bar, figure, track } from "./styles.ts";

	/** One row per period of a KPI at its own grain (`meta.every`) over the selected period's year, every year for a
	 * yearly KPI (mockup `dashAgg` `series`). A period inside its delay is hatched; the selected one is bold. */
	let { books, kpi }: { books: Books; kpi: string } = $props();

	const every = $derived(books.document.meta[kpi]?.every ?? books.document.grain);
	const periods = $derived(periodsOf(books.document, books.selected, every));
	const values = $derived(
		periods.map((period) => numberAt(books.document, kpi, period)),
	);
	const largest = $derived(
		Math.max(1, ...values.filter((value) => value !== null)),
	);
</script>

{#each periods as period, index (period)}
	{@const value = values[index] ?? null}
	{@const cell = cellAt(books.document, kpi, period)}
	{@const waiting = value === null && cell !== undefined && cellKind(cell) === "embargoed"}
	{@const selected = value !== null && period === books.selected.period}
	<div
		class={[
			"my-[7px] grid grid-cols-[minmax(78px,max-content)_1fr_minmax(104px,max-content)] items-center gap-2",
			waiting && "hatch-wait -mx-1 rounded px-1 py-px",
		]}
		data-waiting={waiting ? "" : undefined}
	>
		<span class={selected ? "font-semibold text-foreground" : undefined}>{shortPeriodName(period)}</span>
		<div class={[track, waiting && "bg-transparent"]}>
			{#if value !== null}
				<i
					class={bar}
					style:width={`${(Math.max(0, value) / largest) * 100}%`}
					style:background="var(--chart-1)"
				></i>
			{/if}
		</div>
		<b class={figure}><KpiValue document={books.document} {kpi} {period} /></b>
	</div>
{/each}
