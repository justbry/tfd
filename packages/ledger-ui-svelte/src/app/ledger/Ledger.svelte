<script lang="ts">
	import "./ledger.css";
	import { monthAndDay, parsePeriod, weekdayName } from "$contract/app/period.ts";
	import { formatRoute, type Route, withQuery } from "$contract/app/route.ts";
	import {
		audienceNames,
		csvFileNames,
		drillLabels,
		type LedgerEntry,
		type LedgerPage,
		ledgerColumns,
		maskCode,
		needsPin,
		seesIdentities,
	} from "$contract/data/ledger.ts";
	import type { School } from "$contract/data/types.ts";
	import * as Table from "$lib/components/ui/table/index.ts";
	import { read } from "../../effect/run.ts";
		import BooksIcon from "../books-shared/BooksIcon.svelte";
	import BooksLock from "../books-shared/BooksLock.svelte";
	import { ReadSlot } from "../books-shared/read-slot.svelte.ts";
	import {
		capitalise,
		csvCurrency,
		formatMoney,
		identitiesLockHeading,
		plural,
		signedCount,
	} from "../books-shared/books-text.ts";
	import DownloadButton from "../books-shared/DownloadButton.svelte";
	import PinLock from "../books/PinLock.svelte";
	import { useApp } from "../context.ts";
	import LoadFailed from "../LoadFailed.svelte";
	import { retryFor } from "../panes/retry-for.ts";
	import { chip, dayRow, headCell, muted, toolsSpacer, tools } from "../panes/styles.ts";
	import { notifySuccess } from "../panes/writes.ts";
		import type { Viewing } from "../viewing.ts";
	import { adminBooksSentence, columnCount, isDrill, typeChips, typeOf } from "./ledger-model.ts";
	import LedgerRow from "./LedgerRow.svelte";

	/** The Ledger tab (mockup `ledger()`): atm's events for the period, newest day first, filtered by type, Reports
	 * drill-down or promo. Finance admins and the owner only: any other audience gets the lock panel and no read, and a
	 * PIN-locked view the PIN prompt. The page and the promo's code are two reads, each with its own toast owner: a
	 * failed page is the pane's message in the message table's words (Retry where the table has one, never an empty
	 * table or a 0); a promo that cannot be named leaves its chip on the promo's id, with the toast and its Retry.
	 * Leaving the pane or the week lets a read go with no toast. The rows are the Reader's: nothing is summed here.
	 * `onRendered` says when the route's rows, its lock panel, the PIN prompt or its message is on screen. */
	let {
		route,
		school,
		viewing,
		navigate,
		onRendered,
	}: {
		route: Route;
		school: School;
		viewing: Viewing;
		navigate: (route: Route) => void;
		onRendered: (hash: string) => void;
	} = $props();

	const app = useApp();
	const { query } = $derived(route);
	const audience = $derived(viewing.option.audience);
	const viewedAs = $derived(viewing.option.value);
	const pinLocked = $derived(query.get("pin") === "locked" && needsPin(audience));
	const readable = $derived(seesIdentities(audience) && !pinLocked);
	const period = $derived(parsePeriod(query.get("month"), app.calendar.today));
	const type = $derived(typeOf(query.get("type")));
	const drillAsked = $derived(query.get("drill"));
	const drill = $derived(isDrill(drillAsked) ? drillAsked : null);
	const promo = $derived(query.get("promo"));
	const key = $derived(
		[school.id, period.from, period.to, type, drill, promo, readable].map(String).join("|"),
	);

	const pageRead = new ReadSlot<LedgerPage>();
	const promoRead = new ReadSlot<{ code: string | null }>();

	$effect(() => {
		if (!readable) return;
		const asked = { key, school: school.id, from: period.from, to: period.to, type, drill, promo, audience };
		const cancels = [
			pageRead.begin(app, asked.key, () =>
				read((reader) =>
					reader.ledger({
						school: asked.school,
						from: asked.from,
						to: asked.to,
						type: asked.type,
						drill: asked.drill,
						promo: asked.promo,
					}),
				),
			),
		];
		const promoId = asked.promo;
		if (promoId !== null)
			cancels.push(
				promoRead.begin(app, asked.key, () =>
					read(async (reader) => {
						const list = await reader.promos({ school: asked.school, audience: asked.audience });
						return { code: list.promos.find(({ id }) => id === promoId)?.code ?? null };
					}),
				),
			);
		// Leaving the week, the school or the pane lets the reads go: no toast, no log entry.
		return () => {
			for (const cancel of cancels) cancel();
		};
	});

	const shown = $derived(pageRead.valueFor(key));
	const failed = $derived(pageRead.failureFor(key));
	/** The promo's chip waits for the promo to be named (or for the read to fail), so that it does not change its words. */
	const promoSettled = $derived(promo === null || promoRead.settledFor(key));
	const promoCode = $derived(promoRead.valueFor(key)?.code ?? null);
	$effect(() => {
		if (!readable || (shown && promoSettled) || failed) onRendered(formatRoute(route));
	});

	let opened = $state<readonly string[]>([]);
	const toggle = (id: string): void => {
		opened = opened.includes(id) ? opened.filter((other) => other !== id) : [...opened, id];
	};
	const clearFilters = (): void =>
		navigate(withQuery(withQuery(route, "drill", null), "promo", null));
	const unlocked = (): void => {
		navigate(withQuery(route, "pin", null));
		notifySuccess(app, "Books unlocked for this session.");
	};

	// The page names them from the latest published menu; a school with none answers null, so the school's own
	// settings name them instead.
	const unit = $derived(shown?.unit ?? school.creditUnit);
	const timeZone = $derived(shown?.timeZone ?? school.timeZone);
	const currency = $derived(shown?.currency ?? school.currency);
	const entries = $derived<LedgerEntry[]>(
		shown ? [...shown.pending, ...shown.days.flatMap((day) => day.entries)] : [],
	);
	const lock = $derived({
		reason: "no_grant" as const,
		who: identitiesLockHeading,
		when: `This lists who paid what: one row per person with amounts, refunds and member ids. ${
			viewedAs === "admin" ? adminBooksSentence : `${audienceNames[audience]} sees totals in Reports and the Dashboard.`
		} Every identified read is audited.`,
	});
</script>

<!-- The shell's `text-sm` ancestor gives the pane a line height of 1.4286; the mockup's is 1.4. -->
<div class="leading-[1.4]" data-test="ledger-pane">
{#if pinLocked}
	{#key audience}
		<PinLock schoolId={school.id} levelName={audienceNames[audience]} onUnlocked={unlocked} />
	{/key}
{:else if !readable}
	<BooksLock {lock} />
{:else if failed}
	<LoadFailed error={failed} onRetry={retryFor(failed, pageRead.retry)} busy={pageRead.busy} />
{:else if shown && promoSettled}
	<div class={tools}>
		{#each typeChips as option (option.slug)}
			<button
				type="button"
				class={chip}
				aria-pressed={option.type === type}
				data-test="ledger-type"
				data-type={option.slug}
				onclick={() => navigate(withQuery(route, "type", option.type))}
			>
				{#if option.icon}<BooksIcon name={option.icon} />{/if}{option.label ?? capitalise(unit.other)}
			</button>
		{/each}
		{#if drill}
			<button type="button" class={[chip, "border-primary text-primary"]} data-test="ledger-filter" onclick={clearFilters}>
				{`Filter: ${drillLabels[drill]} ×`}
			</button>
		{/if}
		{#if promo}
			<button type="button" class={[chip, "border-primary text-primary"]} data-test="ledger-filter" onclick={clearFilters}>
				{`Promo ${maskCode(promoCode ?? promo)} ×`}
			</button>
		{/if}
		<span class={toolsSpacer}></span>
		<span class={muted} data-test="ledger-count">{`${plural(shown.count, "event")} · ${timeZone}`}</span>
		<DownloadButton
			kind="link"
			test="ledger-csv"
			title="Download the rows in this view as CSV"
			label="Download CSV"
			name={csvFileNames.ledger(shown.from, shown.to)}
			columns={ledgerColumns(csvCurrency(currency))}
			rows={entries}
			scope={school.id}
		/>
	</div>
	<Table.Root class="text-[12px]">
		<Table.Header>
			<Table.Row class="hover:bg-transparent">
				<Table.Head class={[headCell, "w-[70px] whitespace-normal"]}>Time</Table.Head>
				<Table.Head class={[headCell, "whitespace-normal"]}>Event</Table.Head>
				<Table.Head class={[headCell, "whitespace-normal"]}>Member</Table.Head>
				<Table.Head class={[headCell, "whitespace-normal"]}>What happened</Table.Head>
				<Table.Head class={[headCell, "text-right whitespace-normal"]} data-test="ledger-credit-head">{capitalise(unit.other)}</Table.Head>
				<Table.Head class={[headCell, "text-right whitespace-normal"]}>Amount</Table.Head>
			</Table.Row>
		</Table.Header>
		<Table.Body>
			{#if shown.pending.length > 0}
				<Table.Row class="hover:bg-transparent" data-test="ledger-pending">
					<Table.Cell class={[dayRow, "text-warning"]} colspan={columnCount}>
						<BooksIcon name="clock" class="mr-1 inline align-[-2px]" />
						{` Waiting to ship (${shown.pending.length}) · each ships within 5 min`}
					</Table.Cell>
				</Table.Row>
				{#each shown.pending as entry (entry.event.id)}
					<LedgerRow {entry} {unit} open={opened.includes(entry.event.id)} onToggle={() => toggle(entry.event.id)} />
				{/each}
			{/if}
			{#each shown.days as day (day.date)}
				<Table.Row class="hover:bg-transparent" data-test="ledger-day" data-day={day.date}>
					<Table.Cell class={dayRow} colspan={4} data-test="ledger-day-label">
						{`${weekdayName(day.date)} ${monthAndDay(day.date)} · ${plural(day.count, "event")}`}
					</Table.Cell>
					<Table.Cell class={[dayRow, "text-right tabular-nums"]} data-test="ledger-day-credits">
						{signedCount(day.credits)}
					</Table.Cell>
					<Table.Cell class={[dayRow, "text-right tabular-nums"]} data-test="ledger-day-amount">
						{day.amountCents === 0 ? "" : formatMoney(day.amountCents, currency)}
					</Table.Cell>
				</Table.Row>
				{#each day.entries as entry (entry.event.id)}
					<LedgerRow {entry} {unit} open={opened.includes(entry.event.id)} onToggle={() => toggle(entry.event.id)} />
				{/each}
			{/each}
		</Table.Body>
	</Table.Root>
	{#if shown.count === 0}
		<p class="py-6 text-center text-muted-foreground" data-test="ledger-empty">No events in this period.</p>
	{/if}
{/if}
</div>
