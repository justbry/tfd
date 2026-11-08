<script lang="ts">
	import { type CreditUnit, type LedgerEntry, ledgerLabel, maskCode } from "$contract/data/ledger.ts";
	import { Badge } from "$lib/components/ui/badge/index.ts";
	import * as Table from "$lib/components/ui/table/index.ts";
	import BooksIcon from "../books-shared/BooksIcon.svelte";
	import { signedCount } from "../books-shared/books-text.ts";
	import { cell, link, mono, muted, paneBadge } from "../panes/styles.ts";
	import { detailsCell } from "../books-shared/styles.ts";
	import { badgeTones } from "../styles.ts";
	import { columnCount, detailsJson, entryAmount, eventColors, eventIconOf } from "./ledger-model.ts";

	/** One event of the ledger (mockup `tr.row`): its time, a badge for what happened, the member, the words, the
	 * credits and the amount. A click on the row, or on its Details button, opens the details line under it. */
	let {
		entry,
		unit,
		open,
		onToggle,
	}: { entry: LedgerEntry; unit: CreditUnit; open: boolean; onToggle: () => void } = $props();

	const { event, member, promo } = $derived(entry);
	const booking = $derived(event.labels.booking);
	const negative = $derived(entry.amountCents !== null && entry.amountCents < 0);
	const note = [mono, muted];
</script>

<Table.Row
	class={["cursor-pointer has-aria-expanded:bg-transparent hover:[&>td]:bg-secondary", entry.pending && "[&>td]:bg-secondary"]}
	data-test="ledger-row"
	data-event={event.id}
	data-pending={entry.pending ? "" : undefined}
	onclick={onToggle}
>
	<Table.Cell class={[cell, mono]} data-test="ledger-time">
		{entry.pending ? "just now" : entry.localTime.slice(11)}
	</Table.Cell>
	<Table.Cell class={[cell, "whitespace-normal"]} data-test="ledger-event">
		<Badge class={paneBadge} style={`border-color: ${eventColors[event.event_type] ?? "var(--border)"}`}>
			<BooksIcon name={eventIconOf(entry)} class="mr-[3px] size-[11px]" />{ledgerLabel(entry, unit)}
		</Badge>
		{#if entry.pending}
			{" "}<Badge class={[paneBadge, badgeTones.warning]}>pending</Badge>
		{/if}
	</Table.Cell>
	<Table.Cell class={[cell, "whitespace-normal"]} data-test="ledger-member">
		{#if member}
			<b>{member.name}</b>{" "}<span class={note}>{member.id}</span>
		{:else}
			<span class={mono}>—</span>
		{/if}
	</Table.Cell>
	<Table.Cell class={[cell, "whitespace-normal"]} data-test="ledger-what">
		{event.text}{" "}
		{#if booking}<span class={note}>{`· ${booking}`}</span>{/if}
		{#if promo}{" "}<span class={note}>{`· promo ${maskCode(promo.code)}`}</span>{/if}{" "}<span class={note}
			>{`· ${event.source}`}</span
		>{" "}<button type="button" class={link} aria-expanded={open}>Details</button>
	</Table.Cell>
	<Table.Cell class={[cell, "text-right tabular-nums"]} data-test="ledger-credits">
		{signedCount(entry.credits ?? 0)}
	</Table.Cell>
	<Table.Cell
		class={[cell, "text-right tabular-nums", negative && "text-destructive"]}
		data-test="ledger-amount"
		data-negative={negative ? "" : undefined}
	>
		{entryAmount(entry)}
	</Table.Cell>
</Table.Row>
{#if open}
	<Table.Row class="hover:bg-transparent" data-test="ledger-details">
		<Table.Cell class={[cell, detailsCell]} colspan={columnCount}>
			<span class={mono}>{event.event_type}</span>
			{" · "}
			<span class={mono}>{`source ${event.source}`}</span>
			<br />
			<span class={mono}>{detailsJson(entry)}</span>
		</Table.Cell>
	</Table.Row>
{/if}
