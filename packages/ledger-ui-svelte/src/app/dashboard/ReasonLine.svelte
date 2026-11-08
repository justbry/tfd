<script lang="ts">
	import Icon from "../Icon.svelte";
	import { type Books, reasonsOf } from "./dashboard-model.ts";

	/** The reason line under a breakdown (mockup `kwhyHtml`): "<row>: <why>" for every row the cell rules hid or
	 * rounded; nothing when none did. */
	let { books, kpis }: { books: Books; kpis: readonly string[] } = $props();
	const reasons = $derived(reasonsOf(books.document, books.selected, kpis));
</script>

{#if reasons.length > 0}
	<div class="mt-1.5 flex items-start gap-[5px] text-[10.5px] text-muted-foreground" data-test="kpi-why">
		<Icon name="lock" class="mt-px size-3" />
		<span>{reasons.join(" · ")}</span>
	</div>
{/if}
