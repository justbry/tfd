<script lang="ts">
	import type { ReportCell } from "$contract/data/ledger.ts";
	import BooksIcon from "../books-shared/BooksIcon.svelte";
	import { cellText, smallCount } from "../books-shared/books-text.ts";
	import { approximate, hidden as hiddenLook } from "../books-shared/styles.ts";

	/** One figure of an audience's document (mockup `kFigHtml`): a number as money or a count, `under $100` or `<10` for a
	 * figure the cell rules round, and for one that is not shown the reason with its clock or lock, never a 0. The text
	 * is `cellText`'s, the one reading of a cell that the page and the CSV both use. */
	let {
		cell,
		money,
		currency,
		whole,
		noun,
	}: {
		cell: ReportCell;
		money: boolean;
		currency: string | null;
		whole: boolean;
		/** What a count under the minimum counts, for its title. */
		noun: string;
	} = $props();

	const text = $derived(cellText(cell, money, currency, whole));
</script>

{#if typeof cell === "number"}{text.value}{:else if "lt" in cell}{#if money}{text.value}{:else}<span
			class={approximate}
			data-figure="approx"
			title={`Rounded to the nearest 10: fewer than ${smallCount} ${noun}`}>{text.value}</span
		>{/if}{:else if "approx" in cell}<span class={approximate} data-figure="approx" title={cell.why}>{text.value}</span
	>{:else if "until" in cell}<span class={hiddenLook} data-hid="embargoed" title={text.hidden}
		><BooksIcon name="clock" class="size-[11px] flex-none" />{text.hidden}</span
	>{:else if "who" in cell}<span class={hiddenLook} data-hid={cell.hidden} title={text.hidden}
		><BooksIcon name="lock" class="size-[11px] flex-none" />{text.hidden}</span
	>{:else if cell.hidden === "suppressed"}<span class="text-muted-foreground" data-figure="suppressed" title={cell.text}
		>{text.value}</span
	>{:else}<span class={hiddenLook} data-hid={cell.hidden} title={cell.text}
		><BooksIcon name={cell.hidden === "embargoed" ? "clock" : "lock"} class="size-[11px] flex-none" />{text.hidden}</span
	>{/if}
