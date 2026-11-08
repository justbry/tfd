<script lang="ts">
	import type { LockPanel } from "$contract/data/disclosure.ts";
	import Icon from "../Icon.svelte";
	import { cellAt, figureText, grainOf, numberAt } from "../books/kpi-cells.ts";
	import KpiValue from "../books/KpiValue.svelte";
	import BreakdownRows from "./BreakdownRows.svelte";
	import DashboardBox from "./DashboardBox.svelte";
	import {
		type Books,
		type DashboardView,
		quartersKpi,
		seriesHeading,
		seriesStartingWith,
	} from "./dashboard-model.ts";
	import KpiCard from "./KpiCard.svelte";
	import SeriesRows from "./SeriesRows.svelte";
	import { boxGrid, cardsGrid, figure, footnote, row, track } from "./styles.ts";

	/** Public and Member (mockup `dashAgg`): the period's cards, then each KPI's series at its own grain. Below
	 * Governance the plan breakdown is the row's lock panel ("By plan or fund"). Every figure is a document cell. */
	let {
		books,
		view,
		creditsName,
		planLock,
		fewerThan,
	}: {
		books: Books;
		view: DashboardView;
		creditsName: string;
		planLock: LockPanel | undefined;
		fewerThan: number | null;
	} = $props();

	const document = $derived(books.document);
	const label = $derived(books.selected.label);
	const rate = $derived(numberAt(document, "refund_rate", books.selected.period));
	const kinds = $derived(
		seriesStartingWith(document, grainOf(books.selected.period), "revenue_by_kind:"),
	);
	const year = $derived(books.selected.period.slice(0, 4));
	const yearTotal = $derived(
		document.grain === "quarter" && (document.tables.year?.periods.includes(year) ?? false),
	);
	const yearNote = $derived(
		yearTotal && typeof cellAt(document, quartersKpi, year) === "number",
	);
</script>

{#if view === "money"}
	<div class={cardsGrid}>
		<KpiCard {books} label="Gross collected" kpi="gross_collected"
			>{document.roundTo > 0
				? `${label}, rounded to ${figureText(document.roundTo, "money0", document.symbol)}`
				: label}</KpiCard
		>
		<KpiCard {books} label="Refunds" kpi="refunds"
			><KpiValue {document} kpi="refund_rate" period={books.selected.period} />{rate === null
				? ""
				: " of gross"}</KpiCard
		>
		<KpiCard {books} label="Payment fees" kpi="stripe_fees">in {label}</KpiCard>
		<KpiCard {books} label="Net income" kpi="net_income" tone="ok">Rounded on its own</KpiCard>
		<KpiCard {books} label="Paid out" kpi="payouts">Lands the month after</KpiCard>
	</div>
	<div class={boxGrid}>
		<DashboardBox heading={seriesHeading(document, "gross_collected", "Gross")}>
			<SeriesRows {books} kpi="gross_collected" />
			{#if yearTotal}
				<div class={[row, "border-t border-dashed border-border pt-1"]} data-year={year}>
					<span><b>{year} total</b></span>
					<div class={track}></div>
					<b class={figure}><KpiValue {document} kpi="gross_collected" period={year} /></b>
				</div>
				{#if yearNote}
					<p class="m-0 text-[10.5px] text-muted-foreground" data-test="year-note">
						The four rounded quarters add up to <KpiValue {document} kpi={quartersKpi} period={year} />; the year
						is rounded from its own events.
					</p>
				{/if}
			{/if}
			{#if !yearNote}
				<div class={footnote}>
					Each period is rounded on its own, so a year is not the sum of its rounded quarters.
				</div>
			{/if}
		</DashboardBox>
		<DashboardBox heading={`Income by kind, ${label}`}>
			{#if kinds.length > 0}
				<BreakdownRows {books} kpis={kinds} />
			{:else}
				<div class="text-muted-foreground">No income in this period.</div>
			{/if}
			{#if planLock}
				<div
					class={row}
					data-test="lock-panel"
					data-surface="dashboard-plan"
					data-lock={planLock.reason}
				>
					<span>By plan or fund</span>
					<div class={track}></div>
					<b class={figure}>
						<span
							class="inline-flex items-center gap-[3px] text-left text-[10.5px] font-medium whitespace-nowrap text-muted-foreground"
							data-hid={planLock.reason}
							title={planLock.who}
						>
							<Icon name="lock" class="size-[11px]" /><span data-test="lock-who">{planLock.who}</span>
						</span>
					</b>
				</div>
			{/if}
			<div class={footnote}>Names show to finance admins and the owner only.</div>
		</DashboardBox>
	</div>
{:else if view === "members"}
	<div class={cardsGrid}>
		<KpiCard {books} label="Paying members" kpi="paying_members">most in one month of {label}</KpiCard>
		<KpiCard {books} label="New paying" kpi="new_paying_members">first payment in {label}</KpiCard>
		<KpiCard {books} label="Avg per paying member" kpi="arpa">in {label}</KpiCard>
		<KpiCard {books} label={`${creditsName} used`} kpi="credits_consumed"
			><KpiValue {document} kpi="credits_granted" period={books.selected.period} /> granted ·
			<KpiValue {document} kpi="credits_expired" period={books.selected.period} /> expired</KpiCard
		>
	</div>
	<div class={boxGrid}>
		<DashboardBox heading={seriesHeading(document, "paying_members", "Paying members")}>
			<SeriesRows {books} kpi="paying_members" />
			<div class={footnote}>
				Counts of people.{#if fewerThan !== null}{` Under ${fewerThan} payers a count shows as <10 or to the nearest 10, never 0.`}{/if}
			</div>
		</DashboardBox>
		<DashboardBox heading={seriesHeading(document, "credits_consumed", `${creditsName} used`)}>
			<SeriesRows {books} kpi="credits_consumed" />
		</DashboardBox>
	</div>
{:else}
	<div class={cardsGrid}>
		<KpiCard {books} label="Refund rate" kpi="refund_rate"
			><KpiValue {document} kpi="refunds" period={books.selected.period} /> refunded</KpiCard
		>
		<KpiCard {books} label="Disputes opened" kpi="disputes_opened">in {label}</KpiCard>
		<KpiCard {books} label="Dispute cost" kpi="dispute_cost">lost + fees</KpiCard>
		<KpiCard {books} label="Net income" kpi="net_income">after refunds and fees</KpiCard>
	</div>
	<div class={boxGrid}>
		<DashboardBox heading={seriesHeading(document, "refunds", "Refunds")}>
			<SeriesRows {books} kpi="refunds" />
		</DashboardBox>
		<DashboardBox
			heading={`${seriesHeading(document, "gross_collected", "Gross")} (the base for refund and dispute rates)`}
		>
			<SeriesRows {books} kpi="gross_collected" />
		</DashboardBox>
	</div>
{/if}
