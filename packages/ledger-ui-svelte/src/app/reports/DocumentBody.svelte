<script lang="ts">
	import { type AudienceReport, audienceNames } from "$contract/data/ledger.ts";
	import * as Card from "$lib/components/ui/card/index.ts";
	import BooksIcon from "../books-shared/BooksIcon.svelte";
	import { card, barRow, barTrack, hidden, kpis as kpiGrid, okLine, sparkHead, stat, statNote, statValue } from "../books-shared/styles.ts";
	import { muted } from "../panes/styles.ts";
	import Figure from "./Figure.svelte";
	import { financeOnlyTitle, grainWords, kpis, whoSees } from "./reports-model.ts";

	/** The audience's document at the top of Reports (Public, Member, Governance): its payments, income by the audience's
	 * grain (a period inside its delay says when it publishes), and the five tiles, which open nothing. Every figure is
	 * the document's cell, rounded as it says. */
	let {
		document,
		currency,
	}: { document: AudienceReport; currency: string | null } = $props();

	const whole = $derived(document.rounding !== null);
	const numbers = $derived(
		document.periods.flatMap(({ income }) => (typeof income === "number" ? [income] : [])),
	);
	const highest = $derived(Math.max(1, ...numbers));
</script>

<p class={okLine} data-test="report-status">
	<span class={muted}>{`${audienceNames[document.audience]} document · ${document.periodLabel}:`}</span>{" "}
	<Figure cell={document.payments} money={false} {currency} whole={false} noun="payers" />
	{" payments · Reconciliation with Stripe: "}
	<span class={hidden} data-hid="no_grant" title="Finance admins only"
		><BooksIcon name="lock" class="size-[11px] flex-none" />Finance admins and the owner see this</span
	>
</p>
<Card.Root class={[card, "mb-2.5"]} data-test="report-spark">
	<div class={sparkHead}>
		<h5 class="m-0 text-[11px] font-semibold tracking-[.05em] text-muted-foreground uppercase" data-test="report-grain">{`Income by ${document.grain}`}</h5>
		<span class={muted} data-test="report-grain-note">
			{`${whoSees[document.audience]} ${grainWords[document.grain]}. Days show to finance admins and the owner.`}
		</span>
	</div>
	<div>
	{#each document.periods as { label, income } (label)}
		{@const waiting = typeof income === "object" && "hidden" in income && income.hidden === "embargoed"}
		<div
			class={[barRow, "group grid-cols-[minmax(78px,max-content)_1fr_minmax(104px,max-content)]", label === document.periodLabel && "[&>span]:font-semibold [&>span]:text-foreground"]}
			data-test="report-period"
			data-waiting={waiting ? "" : undefined}
			data-current={label === document.periodLabel ? "" : undefined}
		>
			<span>{label}</span>
			<div class={barTrack}>
				{#if typeof income === "number"}
					<i class="block h-full rounded-sm bg-primary" style={`width: ${(income / highest) * 100}%`}></i>
				{/if}
			</div>
			<b class="text-right font-medium tabular-nums"><Figure cell={income} money {currency} {whole} noun="payers" /></b>
		</div>
	{/each}
	</div>
</Card.Root>
<div class={kpiGrid}>
	{#each kpis as { item, label, icon, field } (item)}
		<button type="button" class={stat} disabled data-test="report-kpi" data-item={item} title={financeOnlyTitle}>
			<small class={statNote}><BooksIcon name={icon} class="mr-1 inline align-[-2px]" />{" "}<span data-test="report-kpi-label">{label}</span></small>
			<b class={statValue} data-test="report-kpi-value"><Figure cell={document.figures[field]} money {currency} {whole} noun="payers" /></b>
		</button>
	{/each}
	<button type="button" class={stat} disabled data-test="report-kpi" data-item="gifts" title="Finance admins only">
		<small class={statNote}><BooksIcon name="gift" class="mr-1 inline align-[-2px]" />{" "}<span data-test="report-kpi-label">Gift certificates outstanding</span></small>
		<b class={statValue} data-test="report-kpi-value"><Figure cell={document.figures.giftsOutstanding} money {currency} {whole} noun="payers" /></b>
		<i class={statNote}>a liability</i>
	</button>
</div>
