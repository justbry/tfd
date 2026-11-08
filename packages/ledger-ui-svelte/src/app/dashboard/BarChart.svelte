<script lang="ts">
	import { numberAt } from "../books/kpi-cells.ts";
	import ChartAxis from "./ChartAxis.svelte";
	import ChartColumn from "./ChartColumn.svelte";
	import {
		type Books,
		type ChartSeries,
		namesList,
		periodsOf,
	} from "./dashboard-model.ts";

	/** Grouped bars per month of the selected year (mockup `kbars`), scaled to the largest number shown. A cell that
	 * is no number draws no bar: never a 0 bar. */
	let { books, series }: { books: Books; series: readonly ChartSeries[] } =
		$props();

	const chartWidth = 600;
	const height = 110;
	const periods = $derived(periodsOf(books.document, books.selected, "month"));
	const columnWidth = $derived(chartWidth / Math.max(1, periods.length));
	const barWidth = $derived((columnWidth * 0.72) / series.length);
	const values = $derived(
		series.map(({ kpi }) =>
			periods.map((period) => numberAt(books.document, kpi, period)),
		),
	);
	const largest = $derived(
		Math.max(1, ...values.flat().filter((value) => value !== null)),
	);
</script>

<svg
	class="block h-auto w-full overflow-visible"
	viewBox={`0 0 ${chartWidth} ${height}`}
	role="img"
	aria-label={namesList(series.map(({ name }) => name))}
>
	{#each periods as period, index (period)}
		<g>
			<ChartColumn {books} {period} position={index} width={columnWidth} {height} {series} />
			{#each series as { kpi, color }, position (kpi)}
				{@const value = values[position]?.[index] ?? null}
				{#if value !== null}
					{@const barHeight = (Math.max(0, value) / largest) * height}
					<rect
						x={index * columnWidth + columnWidth * 0.14 + position * barWidth}
						y={height - barHeight}
						width={Math.max(1, barWidth - 1)}
						height={barHeight}
						rx={2}
						fill={color}
						pointer-events="none"
					/>
				{/if}
			{/each}
		</g>
	{/each}
</svg>
<ChartAxis {periods} selected={books.selected.period} />
