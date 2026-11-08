<script lang="ts">
	import { type Period, periodLabel } from "$contract/app/period.ts";
	import type { IncomeStatement, LedgerDrill } from "$contract/data/ledger.ts";
	import * as Table from "$lib/components/ui/table/index.ts";
	import { formatMoney } from "../books-shared/books-text.ts";
	import { drillButton, drillRow } from "../books-shared/styles.ts";
	import { cell, headCell } from "../panes/styles.ts";
	import { drillTitle, statementAmount, statementRows } from "./reports-model.ts";

	/** The income statement (mockup `stmt`): each line is the Reader's amount, and a line with a drill-down opens the
	 * Ledger at it from a real button (the row itself is not a tab stop). Net opens nothing. The gift line is not income
	 * and says so; a sold amount the source does not record yet reads "not available yet", never 0. */
	let {
		statement,
		period,
		currency,
		onDrill,
	}: {
		statement: IncomeStatement;
		period: Period;
		currency: string | null;
		onDrill: (drill: LedgerDrill) => void;
	} = $props();
	const { amounts } = $derived(statement);
	const arrow = "[&>td:last-child]:after:text-muted-foreground [&>td:last-child]:after:content-['_›']";
</script>

<Table.Root class="text-[12px]">
	<Table.Body>
		<Table.Row class="hover:bg-transparent">
			<Table.Head class={[headCell, "whitespace-normal"]} colspan={2} data-test="report-statement-title">
				{`Income statement · ${periodLabel(period)}`}
			</Table.Head>
		</Table.Row>
		{#each statementRows as row (row.line)}
			{@const drill = row.drill}
			<Table.Row
				class={["hover:bg-transparent", drill !== null && [drillRow, arrow]]}
				data-test="report-line"
				data-line={row.line}
				data-dd={drill ?? undefined}
				title={drill !== null ? drillTitle : undefined}
				onclick={() => {
					if (drill) onDrill(drill);
				}}
			>
				<Table.Cell
					class={[cell, "whitespace-normal", row.indented && "pl-5 text-muted-foreground"]}
					data-test="report-line-label"
				>
					{#if drill !== null}
						<button type="button" class={drillButton}>{#if row.bold}<b>{row.label}</b>{:else}{row.label}{/if}</button>
					{:else if row.bold}<b>{row.label}</b>{:else}{row.label}{/if}
				</Table.Cell>
				<Table.Cell
					class={[cell, "text-right tabular-nums whitespace-normal", row.negative && "text-destructive"]}
					data-test="report-line-amount"
				>
					{#if row.bold && row.line === "net"}<b>{statementAmount(amounts[row.field], currency)}</b>{:else}{statementAmount(amounts[row.field], currency)}{/if}
				</Table.Cell>
			</Table.Row>
		{/each}
		<Table.Row
			class={["hover:bg-transparent", drillRow, arrow]}
			data-test="report-line"
			data-line="gifts"
			data-dd="gift"
			title={drillTitle}
			onclick={() => onDrill("gift")}
		>
			<Table.Cell class={[cell, "pt-2.5 whitespace-normal text-muted-foreground"]} colspan={2}>
				<button type="button" class={drillButton}>
					{amounts.giftsSold === null
						? "Not income: gift certificates sold: not available yet"
						: `Not income: gift certificates sold ${formatMoney(amounts.giftsSold, currency)} (held as a liability until redeemed)`}
				</button>
			</Table.Cell>
		</Table.Row>
	</Table.Body>
</Table.Root>
