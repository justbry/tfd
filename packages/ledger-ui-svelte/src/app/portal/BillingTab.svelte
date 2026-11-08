<script lang="ts">
	import { monthAndYear } from "$contract/app/period.ts";
	import type { Plan } from "$contract/app/portal-format.ts";
	import {
		type HistoryPeriod,
		historyPeriods,
		historyRowsIn,
		historyShortRows,
		type MemberPortal,
		type PortalHistoryRow,
		paymentStatusLabels,
	} from "$contract/data/portal.ts";
	import type { Clock, School } from "$contract/data/types.ts";
	import { formatMoney } from "../books-shared/books-text.ts";
	import PaneIcon from "../PaneIcon.svelte";
	import ActionButton from "./ActionButton.svelte";
	import { dayText, type Handlers, type HistoryControls, pillTone } from "./portal-model.ts";
	import {
		actionsInline,
		bodyCell,
		bodyCellRight,
		buttonClass,
		card,
		cardTitle,
		groupHeading,
		headCell,
		headCellRight,
		muted,
		pillClass,
		rowBetween,
		rowWrap,
		select,
	} from "./styles.ts";

	/** The Billing tab of the member's view (mockup `mpBill`): the next invoice, the payment method (Stripe's), and the
	 * history of invoices and payments, newest first, by period, five rows until "Show all history". The amounts are the
	 * ledger's: a viewer without the finance grant sees "Finance only" in their place, never a figure made up. */
	let {
		school,
		clock,
		portal,
		plan,
		preview,
		handlers,
		controls,
	}: {
		school: School;
		clock: Clock;
		portal: MemberPortal;
		plan: Plan;
		preview: boolean;
		handlers: Handlers;
		controls: HistoryControls;
	} = $props();

	const selected = $derived(historyRowsIn(portal.history, controls.period, clock));
	const shown = $derived(controls.expanded ? selected : selected.slice(0, historyShortRows));
	const family = $derived(portal.scope === "family");
	const nameOf = (profileId: string): string =>
		portal.people.find((person) => person.profileId === profileId)?.name ?? "";
	/** The shown rows with a heading before the first of each month. */
	const groups = $derived.by(() => {
		const out: Array<{ heading: string; rows: PortalHistoryRow[] }> = [];
		for (const row of shown) {
			const heading = monthAndYear(row.date);
			const last = out.at(-1);
			if (last && last.heading === heading) last.rows.push(row);
			else out.push({ heading, rows: [row] });
		}
		return out;
	});
	const tones = { paid: pillClass("ok"), failed: pillClass("warn"), other: pillClass("neutral") } as const;
	const selectId = $props.id();
</script>

<div class={card} data-test="portal-next-invoice">
	<div class={rowBetween}>
		<div>
			<h4 class={cardTitle}>Next invoice</h4>
			<div class={muted}>
				{plan.ended ? `None. Your membership ends ${plan.endsOn}.` : `${plan.endsOn} · ${formatMoney(plan.priceCents, school.currency)}`}
			</div>
		</div>
	</div>
</div>
<div class={card} data-test="portal-payment-method">
	<div class={rowBetween}>
		<div>
			<h4 class={cardTitle}>Payment method</h4>
			<div class={muted}>Card details stay with Stripe.</div>
		</div>
		<ActionButton action="card" icon="card" label="Update" {preview} onclick={handlers.onCard} />
	</div>
</div>
<div class={card} data-test="history-card">
	<div class={rowWrap}>
		<div>
			<h4 class={cardTitle}>Invoices and payments</h4>
			<div class={muted} data-test="history-count">
				{selected.length > 0 ? `Showing ${shown.length} of ${selected.length}, newest first` : "Nothing in this period"}
			</div>
		</div>
		<div class={actionsInline}>
			<select
				id={selectId}
				class={select}
				aria-label="History period"
				data-test="history-period"
				oninput={(event) => controls.onPeriod(event.currentTarget.value as HistoryPeriod)}
			>
				{#each historyPeriods as { id, label } (id)}
					<option value={id} selected={id === controls.period}>{label}</option>
				{/each}
			</select>
			<button
				type="button"
				class={buttonClass()}
				data-test="history-download"
				title={controls.finance ? "Download this history as CSV" : "Finance admins only"}
				disabled={!controls.finance || selected.length === 0}
				onclick={() => controls.onDownload(selected)}
			>
				<PaneIcon name="download" />Download CSV
			</button>
		</div>
	</div>
	{#if selected.length > 0}
		<table class="w-full border-collapse max-[520px]:block">
			<thead class="max-[520px]:sr-only">
				<tr>
					<th scope="col" class={headCell}>Date</th>
					<th scope="col" class={headCell}>Description</th>
					<th scope="col" class={headCellRight}>Amount</th>
					<th scope="col" class={headCell}>Status</th>
				</tr>
			</thead>
			<tbody class="max-[520px]:block">
				{#each groups as group (group.heading)}
					<tr class="max-[520px]:block">
						<th colspan="4" scope="colgroup" class={groupHeading} data-test="history-group">{group.heading}</th>
					</tr>
					{#each group.rows as row (`${row.profileId}-${row.invoiceId}-${row.paymentId}-${row.amountCents}`)}
						<tr
							class="max-[520px]:grid max-[520px]:grid-cols-[minmax(0,1fr)_auto] max-[520px]:gap-x-2.5 max-[520px]:gap-y-0.5 max-[520px]:border-b max-[520px]:border-(--mp-border) max-[520px]:py-[9px]"
							data-test="history-row"
							data-profile={row.profileId}
						>
							<td class="{bodyCell} max-[520px]:col-start-1 max-[520px]:row-start-2 max-[520px]:text-[11.5px] max-[520px]:text-(--mp-muted)" data-test="history-date">{dayText(row.date)}</td>
							<td class="{bodyCell} max-[520px]:col-start-1 max-[520px]:row-start-1 max-[520px]:[overflow-wrap:anywhere]">
								<span data-test="history-description">{row.description}</span>
								{#if row.refundPending}{" "}<span class={pillClass("warn")}>refund pending</span>{/if}
								{#if family}<div class={muted} data-test="history-member">{nameOf(row.profileId)}</div>{/if}
							</td>
							<td
								class="{bodyCellRight} max-[520px]:col-start-2 max-[520px]:row-start-1 max-[520px]:whitespace-nowrap {row.amountCents < 0 && controls.finance ? 'text-(--mp-warn)' : ''}"
								data-test="history-amount"
								data-negative={row.amountCents < 0 && controls.finance ? "" : undefined}
							>
								{#if controls.finance}
									{formatMoney(row.amountCents, row.currency)}
								{:else}
									<span
										class="inline-flex items-center gap-[3px] text-left text-[10.5px] font-medium whitespace-normal text-(--mp-muted)"
										data-hid="no_grant"
										title="Finance admins and the owner see money per person; the member sees their own"
									>Finance only</span>
								{/if}
							</td>
							<td class="{bodyCell} max-[520px]:col-start-2 max-[520px]:row-start-2 max-[520px]:text-right">
								<span class={tones[pillTone(row.status)]} data-test="history-status">{paymentStatusLabels[row.status]}</span>
							</td>
						</tr>
					{/each}
				{/each}
			</tbody>
		</table>
		{#if selected.length > historyShortRows}
			<div class="mt-2.5 flex justify-center">
				<button type="button" class={buttonClass()} data-test="history-more" aria-expanded={controls.expanded} onclick={controls.onExpand}>
					{controls.expanded ? `Show latest ${historyShortRows}` : `Show all history (${selected.length})`}
				</button>
			</div>
		{/if}
	{:else}
		<div class={[muted, "mt-2"]}>No invoices or payments in this period.</div>
	{/if}
</div>
