<script lang="ts">
	import { monthAndDay } from "$contract/app/period.ts";
	import type { IncomeSeries } from "$contract/data/ledger.ts";
	import { formatMoney } from "../books-shared/books-text.ts";
	import { sparkAxis, sparkHead } from "../books-shared/styles.ts";
	import { muted } from "../panes/styles.ts";
	import { sparkHeight, sparkLabel, sparkShape, sparkWidth } from "./reports-model.ts";

	/** The sparkline of the period's income (mockup `spark`): the Reader's points as an area, a line and one hover column
	 * per point, with the previous period dashed behind it when compared. A period with no points says so, and draws
	 * none. */
	let {
		series,
		previous,
		from,
		currency,
	}: {
		series: IncomeSeries;
		previous: IncomeSeries | null;
		from: string;
		currency: string | null;
	} = $props();

	const shape = $derived(sparkShape(series, previous));
</script>

{#if series.points.length === 0}
	<div class={sparkHead}>
		<h5 class="m-0 text-[11px] font-semibold tracking-[.05em] text-muted-foreground uppercase" data-test="report-spark-title">Daily income</h5>
	</div>
	<p class={[muted, "m-0"]}>No data yet for this period.</p>
{:else}
	<div class={sparkHead}>
		<h5 class="m-0 text-[11px] font-semibold tracking-[.05em] text-muted-foreground uppercase" data-test="report-spark-title">{shape.title}</h5>
		<span class={muted} data-test="report-spark-summary">
			{`${formatMoney(series.totalCents, currency)}${
				series.peak
					? ` · peak ${formatMoney(series.peak.amountCents, currency)} (${sparkLabel(series, series.peak.start)})`
					: ""
			}`}
		</span>
	</div>
	<svg
		class="block h-14 w-full"
		viewBox={`0 0 ${sparkWidth} ${sparkHeight}`}
		preserveAspectRatio="none"
		role="img"
		aria-label={`${shape.title} for the period`}
	>
		<polygon points={shape.area} fill="var(--primary)" opacity=".15" />
		{#if shape.previous}
			<polyline
				points={shape.previous}
				fill="none"
				stroke="var(--muted-foreground)"
				stroke-width="1.5"
				stroke-dasharray="4 3"
				vector-effect="non-scaling-stroke"
			/>
		{/if}
		<polyline points={shape.income} fill="none" stroke="var(--primary)" stroke-width="2" vector-effect="non-scaling-stroke" />
		{#each shape.columns as column (column.start)}
			<rect data-test="report-spark-point" x={column.x} y="0" width={shape.slot} height={sparkHeight} fill="transparent">
				<title>{`${column.label}: ${formatMoney(column.amountCents, currency)}`}</title>
			</rect>
		{/each}
	</svg>
	<div class={sparkAxis} data-test="report-spark-axis">
		<span>{monthAndDay(from)}</span>
		{#if previous}<span>dashed: previous period</span>{/if}
		<span>{monthAndDay(series.through)}</span>
	</div>
{/if}
