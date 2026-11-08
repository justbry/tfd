<script lang="ts">
	import { cellAt, cellText } from "../books/kpi-cells.ts";
	import {
		type Books,
		type ChartSeries,
		shortPeriodName,
	} from "./dashboard-model.ts";

	/** A column per period behind a chart's marks, its cells in the tooltip ("not shown yet" for a cell that is no
	 * number, never 0); the selected period's column is shaded. */
	let {
		books,
		period,
		position,
		width,
		height,
		series,
	}: {
		books: Books;
		period: string;
		position: number;
		width: number;
		height: number;
		series: readonly ChartSeries[];
	} = $props();

	const title = $derived(
		`${shortPeriodName(period)}: ${series
			.map(({ kpi, name }) => {
				const cell = cellAt(books.document, kpi, period);
				return `${name} ${typeof cell === "number" ? cellText(books.document, kpi, cell) : "not shown yet"}`;
			})
			.join(" · ")}`,
	);
	const selected = $derived(period === books.selected.period);
</script>

<rect
	class={selected ? "fill-border opacity-55" : "fill-transparent hover:fill-border hover:opacity-40"}
	x={position * width}
	y={0}
	{width}
	{height}><title>{title}</title></rect
>
