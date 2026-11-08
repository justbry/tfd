<script lang="ts">
	import { monthAndDay, type Period, periodLabel } from "$contract/app/period.ts";
	import type { CreditUnit, IncomeStatement, LedgerDrill } from "$contract/data/ledger.ts";
	import { Badge } from "$lib/components/ui/badge/index.ts";
	import * as Card from "$lib/components/ui/card/index.ts";
	import BooksIcon from "../books-shared/BooksIcon.svelte";
	import { formatMoney } from "../books-shared/books-text.ts";
	import { card, kpis as kpiGrid, okLine, okText, stat, statNote, statValue } from "../books-shared/styles.ts";
	import { muted, paneBadge } from "../panes/styles.ts";
	import { changeText, drillTitle, kpis, notAvailableText } from "./reports-model.ts";
	import Spark from "./Spark.svelte";

	/** The finance admin's and the owner's top of Reports (mockup `reports()`): whether the statement matches Stripe and
	 * its basis, the sparkline, and the tiles. Every figure is the Reader's, formatted, with the server's change for the
	 * compare line; nothing is subtracted or summed here. A tile opens the Ledger at its drill-down; the gift tile opens
	 * Promos. */
	let {
		statement,
		period,
		currency,
		unit,
		onDrill,
		onPromos,
	}: {
		statement: IncomeStatement;
		period: Period;
		currency: string | null;
		unit: CreditUnit;
		onDrill: (drill: LedgerDrill) => void;
		onPromos: () => void;
	} = $props();

	const { amounts, previous, giftsOutstanding, counts } = $derived(statement);
	const money = (cents: number): string => formatMoney(cents, currency);
	const gifts = $derived(
		giftsOutstanding
			? `${money(giftsOutstanding.amountCents)}${
					giftsOutstanding.credits > 0
						? ` + ${giftsOutstanding.credits} ${giftsOutstanding.credits === 1 ? unit.one : unit.other}`
						: ""
				}`
			: notAvailableText,
	);
</script>

<p class={okLine} data-test="report-status">
	{#if statement.matchesStripe === null}
		<span class={muted} data-test="report-stripe-unchecked">Not checked against Stripe yet.</span>
	{:else if statement.matchesStripe}
		<span class={okText}><BooksIcon name="check" class="mr-1 inline align-[-2px]" /> Matches Stripe</span>{` · ${counts.payments} payment${counts.payments === 1 ? "" : "s"}, ${counts.refunds} refund${counts.refunds === 1 ? "" : "s"}, ${counts.payouts} payout${counts.payouts === 1 ? "" : "s"}`}
	{:else}
		<span class={muted}>
			Partial month: summed from daily totals. The hledger report and the Stripe match run on whole months.
		</span>
	{/if}{" "}
	<Badge class={paneBadge}>
		<BooksIcon name="scale" class="mr-[3px] size-[11px]" />{statement.basis.kind === "cash"
			? "Cash basis"
			: `Deferred from ${monthAndDay(statement.basis.from)}`}
	</Badge>
</p>
<Card.Root class={[card, "mb-2.5"]} data-test="report-spark">
	<Spark series={statement.income} previous={previous?.income ?? null} from={period.from} {currency} />
</Card.Root>
<div class={kpiGrid}>
	{#each kpis as { item, label, icon, drill, field } (item)}
		<button type="button" class={stat} data-test="report-kpi" data-item={item} title={drillTitle} onclick={() => onDrill(drill)}>
			<small class={statNote}><BooksIcon name={icon} class="mr-1 inline align-[-2px]" />{" "}<span data-test="report-kpi-label">{label}</span></small>
			<b class={statValue} data-negative={amounts[field] < 0 ? "" : undefined} data-test="report-kpi-value">{money(amounts[field])}</b>
			{#if previous}
				<i class={statNote} data-test="report-kpi-change">
					{changeText(previous.changes[field], currency, periodLabel({ from: previous.from, to: previous.to }))}
				</i>
			{/if}
		</button>
	{/each}
	<button type="button" class={stat} data-test="report-kpi" data-item="gifts" title="Open promos" onclick={onPromos}>
		<small class={statNote}><BooksIcon name="gift" class="mr-1 inline align-[-2px]" />{" "}<span data-test="report-kpi-label">Gift certificates outstanding</span></small>
		<b class={statValue} data-test="report-kpi-value">{gifts}</b>
		<i class={statNote} data-test="report-kpi-change">
			{giftsOutstanding
				? `${giftsOutstanding.count} unredeemed gift${giftsOutstanding.count === 1 ? "" : "s"} (a liability)`
				: "Not available yet"}
		</i>
	</button>
</div>
