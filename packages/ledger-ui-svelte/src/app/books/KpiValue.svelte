<script lang="ts">
	import type { KpiDocument } from "$contract/data/kpi-document.ts";
	import Icon from "../Icon.svelte";
	import { cellAt, notComputedCell, showCell } from "./kpi-cells.ts";

	/** One document cell (protocol §3): its KPI, period and kind in `data-kpi`, `data-period` and `data-cell`, its text
	 * exactly as the contract writes it, and why it is not a plain figure in its title. A withheld cell shows the clock or
	 * the lock and its reason; a suppressed one is "—" in the muted colour; a rounded count is underlined with dots. A KPI
	 * the document lacks is `not_computed`, never 0. A cell shown a second time (the donor rows under the donor line) is
	 * not `marked` again. */
	let {
		document,
		kpi,
		period,
		test,
		marked = true,
	}: {
		document: KpiDocument;
		kpi: string;
		period: string;
		test?: string;
		marked?: boolean;
	} = $props();

	const shown = $derived(
		showCell(document, kpi, cellAt(document, kpi, period) ?? notComputedCell),
	);
</script>

<span
	data-test={marked ? test : undefined}
	data-kpi={marked ? kpi : undefined}
	data-period={marked ? period : undefined}
	data-cell={marked ? shown.kind : undefined}
	data-hid={shown.withheld ?? undefined}
	title={shown.title ?? undefined}
	class={[
		shown.look === "withheld" &&
			"inline-flex items-center gap-[3px] text-left text-[10.5px] font-medium whitespace-normal text-muted-foreground",
		shown.look === "suppressed" && "text-muted-foreground",
		shown.look === "rounded" && "cursor-help border-b border-dotted border-muted-foreground",
	]}
>
	{#if shown.withheld}
		<Icon name={shown.withheld === "embargoed" ? "clock" : "lock"} class="size-[11px]" />
	{/if}{shown.text}</span>
