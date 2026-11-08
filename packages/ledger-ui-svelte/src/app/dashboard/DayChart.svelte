<script lang="ts">
	import { monthName } from "$contract/app/period.ts";
	import { cellKind } from "$contract/data/kpi-document.ts";
	import { cellText } from "../books/kpi-cells.ts";
	import type { Books } from "./dashboard-model.ts";

	/** Gross per day of the selected month (mockup `kdays`): a day that is no number (not yet, or hidden) is a low grey
	 * stub, never a 0 bar. Each day carries its cell's kind in `data-cell` and, for a number, its value in
	 * `data-value`. */
	let { books }: { books: Books } = $props();

	const chartWidth = 1200;
	const height = 64;
	const labelEvery = 5;
	const month = $derived(monthName(books.selected.from));
	const days = $derived.by(() => {
		const table = books.document.tables.day;
		if (!table) return [];
		return table.periods.flatMap((day, index) => {
			const cell = table.series.gross_collected?.[index];
			return day.startsWith(`${books.selected.period}-`) && cell !== undefined
				? [{ day, cell }]
				: [];
		});
	});
	const columnWidth = $derived(chartWidth / Math.max(1, days.length));
	const largest = $derived(
		Math.max(
			1,
			...days.flatMap(({ cell }) => (typeof cell === "number" ? [cell] : [])),
		),
	);
</script>

<svg
	class="block h-auto w-full overflow-visible"
	viewBox={`0 0 ${chartWidth} ${height}`}
	role="img"
	aria-label={`Gross by day, ${books.selected.label}`}
>
	{#each days as { day, cell }, position (day)}
		{@const label = `${month} ${Number(day.slice(8))}`}
		{#if typeof cell === "number"}
			{@const barHeight = (cell / largest) * height}
			<rect
				data-kpi="gross_collected"
				data-day={day}
				data-cell={cellKind(cell)}
				data-value={cell}
				x={position * columnWidth + 1}
				width={columnWidth - 2}
				rx={2}
				y={height - barHeight}
				height={barHeight}
				fill="var(--chart-1)"><title>{`${label}: ${cellText(books.document, "gross_collected", cell)}`}</title></rect
			>
		{:else}
			<rect
				data-kpi="gross_collected"
				data-day={day}
				data-cell={cellKind(cell)}
				x={position * columnWidth + 1}
				width={columnWidth - 2}
				rx={2}
				y={height - 10}
				height={10}
				fill="var(--border)"
				opacity={0.4}><title>{`${label}: not yet`}</title></rect
			>
		{/if}
	{/each}
</svg>
<div class="relative mt-[3px] h-4" aria-hidden="true">
	{#each days as { day }, position (day)}
		{#if position % labelEvery === 0 || position === days.length - 1}
			<span
				class="absolute -translate-x-1/2 text-[11px] leading-4 text-muted-foreground"
				style:left={`${(((position + 0.5) * columnWidth) / chartWidth) * 100}%`}>{Number(day.slice(8))}</span
			>
		{/if}
	{/each}
</div>
