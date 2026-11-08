<script lang="ts">
	import { monthName } from "$contract/app/period.ts";
	import Icon from "../Icon.svelte";
	import { numberAt } from "../books/kpi-cells.ts";
	import KpiValue from "../books/KpiValue.svelte";
	import BarChart from "./BarChart.svelte";
	import BreakdownRows from "./BreakdownRows.svelte";
	import ChartLegend from "./ChartLegend.svelte";
	import DashboardBox from "./DashboardBox.svelte";
	import DayChart from "./DayChart.svelte";
	import DonorSpread from "./DonorSpread.svelte";
	import {
		type Books,
		changeText,
		chartColors,
		type DashboardView,
		disputeCostTone,
		disputeTone,
		grossColor,
		periodsOf,
		refundCardTone,
		refundRateBad,
		refundTone,
		seriesStartingWith,
	} from "./dashboard-model.ts";
	import KpiCard from "./KpiCard.svelte";
	import LineChart from "./LineChart.svelte";
	import NeedsALook from "./NeedsALook.svelte";
	import { boxGrid, caption, cardsGrid, footnote, link } from "./styles.ts";

	/** Governance, Finance admin and Owner (mockup `dashFull`): the month's cards, charts, breakdowns and spreads. A
	 * sub-line that compares months reads the change the document carries; the live audiences' Money adds the month's
	 * days. */
	let {
		books,
		view,
		creditsName,
		identities,
		onOpenReports,
	}: {
		books: Books;
		view: DashboardView;
		creditsName: string;
		identities: boolean;
		onOpenReports: () => void;
	} = $props();

	const [firstColor, secondColor, thirdColor, , fifthColor] = chartColors;
	const document = $derived(books.document);
	const selected = $derived(books.selected);
	const month = $derived(monthName(selected.from));
	const year = $derived(selected.period.slice(0, 4));
	const index = $derived(document.tables.month?.periods.indexOf(selected.period) ?? -1);
	const rate = $derived(numberAt(document, "refund_rate", selected.period));
	const plans = $derived(
		document.tables.month?.order?.revenue_by_tier?.[index] ??
			seriesStartingWith(document, "month", "revenue_by_tier:"),
	);
	const funds = $derived(document.tables.month?.order?.donations_by_fund?.[index] ?? []);
	const hasDays = $derived(
		document.tables.day?.periods.some((day) => day.startsWith(`${selected.period}-`)) ?? false,
	);
	const hasDonors = $derived("donors_count" in (document.tables.month?.series ?? {}));
	const anyDisputes = $derived(
		periodsOf(document, selected, "month").some(
			(period) => (numberAt(document, "disputes_opened", period) ?? 0) > 0,
		),
	);
</script>

{#snippet change(kpi: string)}{changeText(document, selected, kpi) ?? ""}{/snippet}

{#if view === "money"}
	<div class={cardsGrid}>
		<KpiCard {books} label="Gross collected" kpi="gross_collected">{@render change("gross_collected")}</KpiCard>
		<KpiCard {books} label="Refunds" kpi="refunds" tone={refundCardTone(rate)}
			><KpiValue {document} kpi="refund_rate" period={selected.period} />{rate === null ? "" : " of gross"}</KpiCard
		>
		<KpiCard {books} label="Payment fees" kpi="stripe_fees">{@render change("stripe_fees")}</KpiCard>
		<KpiCard {books} label="Net income" kpi="net_income" tone="ok">{@render change("net_income")}</KpiCard>
		<KpiCard {books} label="Paid out" kpi="payouts">Lands the month after</KpiCard>
	</div>
	<div class={boxGrid}>
		<DashboardBox heading={`Gross vs net, ${year}`}>
			{#snippet legend()}<ChartLegend items={[["Gross", grossColor], ["Net", firstColor]]} />{/snippet}
			<BarChart
				{books}
				series={[
					{ kpi: "gross_collected", name: "Gross", color: grossColor },
					{ kpi: "net_income", name: "Net", color: firstColor },
				]}
			/>
		</DashboardBox>
		<DashboardBox heading={`Gross by plan, ${month}`}>
			{#if plans.length > 0}
				<BreakdownRows {books} kpis={plans} />
			{:else}
				<div class="text-muted-foreground">No plans yet.</div>
			{/if}
			<div class={footnote}>
				Memberships only. Add-ons and bookings appear here when the school sells them.
			</div>
		</DashboardBox>
		{#if funds.length > 0}
			<DashboardBox heading={`Donations by fund, ${year} to ${month}`}>
				<BreakdownRows {books} kpis={funds} />
			</DashboardBox>
		{/if}
		{#if document.live && hasDays}
			<DashboardBox heading={`Gross by day, ${month}`} full>
				{#snippet legend()}<ChartLegend
						items={[[selected.open ? "Days so far (live)" : "Day", firstColor]]}
					/>{/snippet}
				<DayChart {books} />
			</DashboardBox>
		{/if}
	</div>
{:else if view === "members"}
	<div class={cardsGrid}>
		<KpiCard {books} label="Paying members" kpi="paying_members">{@render change("paying_members")}</KpiCard>
		<KpiCard {books} label="New paying" kpi="new_paying_members">first payment this month</KpiCard>
		<KpiCard {books} label="Avg per paying member" kpi="arpa">in {month}</KpiCard>
		<KpiCard {books} label={`${creditsName} used`} kpi="credits_consumed"
			><KpiValue {document} kpi="credits_granted" period={selected.period} /> granted ·
			<KpiValue {document} kpi="credits_expired" period={selected.period} /> expired</KpiCard
		>
	</div>
	<div class={boxGrid}>
		<DashboardBox heading="Paying members">
			{#snippet legend()}<ChartLegend items={[["Members who paid in the month", secondColor]]} />{/snippet}
			<LineChart {books} kpi="paying_members" name="Paying members" color={secondColor} smallestTop={5} />
		</DashboardBox>
		<DashboardBox heading={creditsName}>
			{#snippet legend()}<ChartLegend
					items={[["Granted", firstColor], ["Used", secondColor], ["Expired", thirdColor]]}
				/>{/snippet}
			<BarChart
				{books}
				series={[
					{ kpi: "credits_granted", name: "Granted", color: firstColor },
					{ kpi: "credits_consumed", name: "Used", color: secondColor },
					{ kpi: "credits_expired", name: "Expired", color: thirdColor },
				]}
			/>
		</DashboardBox>
		{#if hasDonors}
			<DashboardBox heading={`How donors give, ${year} to ${month}`} full>
				{#snippet legend()}<ChartLegend
						items={[
							[identities ? "Spread only here; names are in Reports" : "No names, no rows", thirdColor],
						]}
					/>{/snippet}
				<DonorSpread {books} />
			</DashboardBox>
		{/if}
	</div>
	{#if identities}
		<div class={[caption, "mt-2.5"]}>
			<Icon name="info" />
			<span
				>Names and amounts: <button type="button" class={link} onclick={onOpenReports}>Donors and payers</button> in
				Reports. Every identified read is audited.</span
			>
		</div>
	{/if}
{:else}
	<div class={cardsGrid}>
		<KpiCard {books} label="Refund rate" kpi="refund_rate" tone={refundTone(rate)}
			><KpiValue {document} kpi="refunds" period={selected.period} /> refunded</KpiCard
		>
		<KpiCard
			{books}
			label="Disputes opened"
			kpi="disputes_opened"
			tone={disputeTone(numberAt(document, "disputes_opened", selected.period))}>in {month}</KpiCard
		>
		<KpiCard
			{books}
			label="Dispute cost"
			kpi="dispute_cost"
			tone={disputeCostTone(numberAt(document, "dispute_cost", selected.period))}
			>lost <KpiValue {document} kpi="disputes_lost" period={selected.period} /> + fees
			<KpiValue {document} kpi="dispute_fees" period={selected.period} /></KpiCard
		>
		<KpiCard {books} label="Net income" kpi="net_income">{@render change("net_income")}</KpiCard>
	</div>
	<div class={boxGrid}>
		<DashboardBox heading="Refund rate">
			{#snippet legend()}<ChartLegend items={[["Share of gross refunded", fifthColor]]} />{/snippet}
			<LineChart
				{books}
				kpi="refund_rate"
				name="Refund rate"
				color={fifthColor}
				smallestTop={0.12}
				threshold={refundRateBad}
			/>
		</DashboardBox>
		<DashboardBox heading="Dispute cost">
			{#snippet legend()}<ChartLegend items={[["Lost + fees", fifthColor]]} />{/snippet}
			{#if anyDisputes}
				<BarChart {books} series={[{ kpi: "dispute_cost", name: "Cost", color: fifthColor }]} />
			{:else}
				<div class="grid h-[126px] place-items-center text-muted-foreground">No disputes in {year}</div>
			{/if}
		</DashboardBox>
		<NeedsALook {books} />
	</div>
{/if}
