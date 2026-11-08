<script lang="ts">
	import { type AudienceReport, audienceNames } from "$contract/data/ledger.ts";
	import * as Table from "$lib/components/ui/table/index.ts";
	import BooksIcon from "../books-shared/BooksIcon.svelte";
	import { formatMoney } from "../books-shared/books-text.ts";
	import { cell, headCell } from "../panes/styles.ts";
	import Figure from "./Figure.svelte";
	import { documentLines, grainWords } from "./reports-model.ts";

	/** The audience document's statement (mockup `stmt` below finance): the document's cells line by line, with a tier
	 * line for each plan, and a note that says how the money is rounded and that a figure inside its delay shows when it
	 * publishes. The arrows to the rows behind a figure are finance admins' only: off here. */
	let {
		document,
		currency,
	}: { document: AudienceReport; currency: string | null } = $props();

	const whole = $derived(document.rounding !== null);
	const lines = $derived(documentLines(document));
	const roundingText = $derived(
		document.rounding
			? `money rounded to ${formatMoney(document.rounding.unitCents, currency, true)} (${document.rounding.size} school)`
			: "exact",
	);
</script>

<Table.Root class="text-[12px]">
	<Table.Body>
		<Table.Row class="hover:bg-transparent">
			<Table.Head class={[headCell, "whitespace-normal"]} colspan={3} data-test="report-statement-title">
				{`Income statement · ${document.periodLabel} · ${audienceNames[document.audience]} document`}
			</Table.Head>
		</Table.Row>
		{#each lines as { line, label, cell: figure, indented, bold }, index (`${line}${label}${index}`)}
			<Table.Row class="hover:bg-transparent" data-test="report-line" data-line={line}>
				<Table.Cell class={[cell, "whitespace-normal", indented && "pl-5 text-muted-foreground"]} data-test="report-line-label">
					{#if bold}<b>{label}</b>{:else}{label}{/if}
				</Table.Cell>
				<Table.Cell class={[cell, "text-right tabular-nums whitespace-normal"]} data-test="report-line-amount">
					{#if bold && line === "net"}<b><Figure cell={figure} money {currency} {whole} noun="payers" /></b>{:else}<Figure cell={figure} money {currency} {whole} noun="payers" />{/if}
				</Table.Cell>
				<Table.Cell class={[cell, "w-5 text-right"]}>
					<button
						type="button"
						class="inline-flex items-center border-0 bg-transparent p-0 text-[11px] text-primary opacity-40 disabled:cursor-not-allowed"
						disabled
						title="Finance admins only"
						aria-label={`Rows behind ${label}`}>›</button
					>
				</Table.Cell>
			</Table.Row>
		{/each}
		<Table.Row class="hover:bg-transparent">
			<Table.Cell class={[cell, "pt-2.5 whitespace-normal text-muted-foreground"]} colspan={3} data-test="report-doc-note">
				<BooksIcon name="info" class="mr-1 inline align-[-2px]" />
				{` Figures from the ${audienceNames[document.audience]} document: ${grainWords[document.grain]}, ${roundingText}. A figure inside its delay shows when it publishes.`}
			</Table.Cell>
		</Table.Row>
	</Table.Body>
</Table.Root>
