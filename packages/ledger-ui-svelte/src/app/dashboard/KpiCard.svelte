<script lang="ts">
	import type { Snippet } from "svelte";
	import * as Card from "$lib/components/ui/card/index.ts";
	import { cellAt } from "../books/kpi-cells.ts";
	import KpiValue from "../books/KpiValue.svelte";
	import { type Books, type Tone, withheldLine } from "./dashboard-model.ts";

	/** A card (mockup `kcard`): its label, one value cell and a sub-line. A withheld figure dashes the card and its
	 * reason takes the place of the sub-line, once; a tone colours the figure (the mockup's ok, warn, bad). */
	let {
		books,
		label,
		kpi,
		tone = "",
		children,
	}: {
		books: Books;
		label: string;
		kpi: string;
		tone?: Tone;
		children?: Snippet;
	} = $props();

	const withheld = $derived(
		withheldLine(cellAt(books.document, kpi, books.selected.period)),
	);
	const toneClass: Record<Tone, string> = {
		ok: "text-success",
		warn: "text-warning",
		bad: "text-destructive",
		"": "",
	};
</script>

<Card.Root
	class={[
		"block gap-0 overflow-visible rounded-xl border border-border px-[11px] py-[9px] text-[12px] ring-0",
		withheld !== null && "border-dashed",
	]}
	data-test="kpi-card"
	data-k={kpi}
>
	<small class="block text-[10.5px] text-muted-foreground" data-test="kpi-label">{label}</small>
	<b
		class={[
			"my-px block text-[19px] leading-tight font-bold tabular-nums [&_[data-hid]]:text-[11px]",
			withheld === null ? toneClass[tone] : "text-muted-foreground",
		]}
	>
		<KpiValue document={books.document} {kpi} period={books.selected.period} test="kpi-value" />
	</b>
	<i class="text-[10.5px] text-muted-foreground not-italic">
		{#if withheld !== null}{withheld}{:else}{@render children?.()}{/if}
	</i>
</Card.Root>
