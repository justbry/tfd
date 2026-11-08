<script lang="ts">
	import { cellText, numberAt } from "../books/kpi-cells.ts";
	import { type Books, periodsOf } from "./dashboard-model.ts";
	import ChartAxis from "./ChartAxis.svelte";
	import ChartColumn from "./ChartColumn.svelte";

	/** A line through the months' numbers (mockup `kline`), with an optional dashed threshold and its label. A month
	 * that is no number has no point: the line skips it rather than dropping to 0. */
	let {
		books,
		kpi,
		name,
		color,
		smallestTop,
		threshold,
	}: {
		books: Books;
		kpi: string;
		name: string;
		color: string;
		smallestTop: number;
		threshold?: number;
	} = $props();

	const chartWidth = 600;
	const height = 100;
	const periods = $derived(periodsOf(books.document, books.selected, "month"));
	const columnWidth = $derived(chartWidth / Math.max(1, periods.length));
	const values = $derived(
		periods.map((period) => numberAt(books.document, kpi, period)),
	);
	const top = $derived(
		Math.max(
			smallestTop,
			threshold ?? 0,
			...values.filter((value) => value !== null),
		),
	);
	const x = (index: number): number => index * columnWidth + columnWidth / 2;
	const y = (value: number): number =>
		height - (value / top) * (height - 10) - 2;
	const points = $derived(
		values
			.flatMap((value, index) =>
				value === null ? [] : [`${x(index)},${y(value)}`],
			)
			.join(" "),
	);
	const series = $derived([{ kpi, name, color }]);
</script>

<div class="relative">
	<svg
		class="block h-auto w-full overflow-visible"
		viewBox={`0 0 ${chartWidth} ${height}`}
		role="img"
		aria-label={name}
	>
		{#each periods as period, index (period)}
			<ChartColumn {books} {period} position={index} width={columnWidth} {height} {series} />
		{/each}
		{#if threshold !== undefined}
			<line
				x1={0}
				x2={chartWidth}
				y1={y(threshold)}
				y2={y(threshold)}
				stroke="var(--warning)"
				stroke-dasharray="4 3"
			/>
		{/if}
		<polyline fill="none" stroke={color} stroke-width={2} {points} pointer-events="none" />
		{#each values as value, index (periods[index])}
			{#if value !== null}
				{@const selected = periods[index] === books.selected.period}
				<circle
					cx={x(index)}
					cy={y(value)}
					r={selected ? 4.5 : 2.5}
					fill={selected ? "var(--foreground)" : color}
					pointer-events="none"
				/>
			{/if}
		{/each}
	</svg>
	{#if threshold !== undefined}
		<span
			class="absolute right-0.5 -translate-y-full text-[11px] leading-[1.2] text-warning"
			style:top={`${(y(threshold) / height) * 100}%`}>{cellText(books.document, kpi, threshold)}</span
		>
	{/if}
</div>
<ChartAxis {periods} selected={books.selected.period} />
