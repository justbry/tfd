<script lang="ts">
	import "./all-schools.css";
	import { type Period, periodLabel } from "$contract/app/period.ts";
	import type { School } from "$contract/data/types.ts";
	import { Badge } from "$lib/components/ui/badge/index.ts";
	import * as Table from "$lib/components/ui/table/index.ts";
	import { messageFor } from "../effect/messages.ts";
	import {
		incomeTotals,
		leavesOutNote,
		readAllSchools,
		type SchoolShown,
	} from "./all-schools-model.ts";
	import { useApp } from "./context.ts";
	import Icon from "./Icon.svelte";
	import { formatMoney } from "./money.ts";
	import { retryingRead } from "./retrying-read.ts";
	import { badgeTones, mockBadge } from "./styles.ts";

	/** The All schools pane (mockup `#all`, `portfolio()`): one row per school, a total row. Outstanding is the
	 * school's credits outstanding, held included (the Members summary), for a viewer who sees the roster; Income is
	 * the period's income (memberships and bookings less discounts, `membersIncome`) for a viewer who sees live money:
	 * the viewer's own audience at each school decides, and a figure they may not see says who may, never 0. The table
	 * is read through the app's Effect layer as one read (one toast however many schools fail the same way, its Retry
	 * reading the table again); a school whose read fails says "not available" in its cells. The Income total is per
	 * currency, summed here (owner decision 2026-11-08, S9-plan D23: no server route serves a cross-school total), and
	 * says which schools it leaves out and why. A school with no attention count (the HTTP build) shows a dash. */
	let {
		schools,
		period,
		onOpen,
		onRendered,
	}: {
		schools: School[];
		period: Period;
		onOpen: (schoolId: string) => void;
		/** The table is on screen (its figures follow as they load). */
		onRendered: () => void;
	} = $props();

	const app = useApp();
	$effect(() => {
		onRendered();
	});
	let shown = $state<Record<string, SchoolShown>>({});
	/** One read for the table (one owner, one toast however many schools fail the same way): each school's cell takes
	 * its own result, and a school that fails makes the read fail, so the toast's Retry reads the table again. */
	$effect(() => {
		const asked = { schools, period };
		for (const school of asked.schools) shown[school.id] = { state: "loading" };
		let current = true;
		const reading = retryingRead(
			app,
			() =>
				readAllSchools(asked.schools, asked.period, (schoolId, next) => {
					if (current) shown[schoolId] = next;
				}),
			{ value: () => undefined },
		);
		reading.run();
		return () => {
			current = false;
			reading.cancel();
		};
	});
	const loadedFigures = $derived(
		schools.map((school) => {
			const entry = shown[school.id];
			return entry?.state === "loaded" ? entry.figures : null;
		}),
	);
	const totals = $derived(incomeTotals(loadedFigures));
	const partialNote = $derived(leavesOutNote(totals.leavesOut, totals.totals.length > 0));
	const anyLoading = $derived(
		schools.some((school) => (shown[school.id]?.state ?? "loading") === "loading"),
	);

	const counted = $derived(
		schools.every((school) => school.attentionCount !== null),
	);
	/** Summed on the client, like the Income total: an exception to "nothing is summed or recomputed" (owner decision
	 * 2026-11-08, S9-plan D23), since no server route serves a cross-school count. */
	const attentionTotal = $derived(
		schools.reduce((total, school) => total + (school.attentionCount ?? 0), 0),
	);
	/** Headers and cells wrap as the mockup's do, so that at phone widths every column stays in view; only badges
	 * keep to one line. */
	const header =
		"h-auto border-b border-border px-2 py-1.5 text-left align-bottom text-[10.5px] font-medium whitespace-normal text-muted-foreground";
	const cell = "border-b border-border px-2 py-[7px] align-middle whitespace-normal";
	const hiddenFigure =
		"inline-flex items-center gap-[3px] text-[10.5px] font-medium text-muted-foreground";
</script>

<Table.Root class="text-[12px]" data-test="all-schools">
	<Table.Header>
		<Table.Row class="border-0 hover:bg-transparent">
			<Table.Head class={header}>School</Table.Head>
			<Table.Head class={[header, "text-right"]}>Outstanding</Table.Head>
			<Table.Head class={[header, "text-right"]} data-test="income-heading">Income · {periodLabel(period)}</Table.Head>
			<Table.Head class={[header, "text-right"]}>Needs attention</Table.Head>
			<Table.Head class={header}>Data</Table.Head>
		</Table.Row>
	</Table.Header>
	<Table.Body>
		{#each schools as school (school.id)}
			<Table.Row class="border-0 hover:bg-secondary/60" data-test="all-schools-row" data-school={school.id}>
				<Table.Cell class={cell}>
					<button
						type="button"
						class="inline-flex items-center gap-1 text-left font-bold hover:underline"
						onclick={() => onOpen(school.id)}
					>
						<Icon name="building" />{school.name}
					</button>
					<div class="font-mono text-[10.5px] leading-tight text-muted-foreground">{school.timeZone}</div>
				</Table.Cell>
				{@const entry = shown[school.id]}
				{#each ["outstanding", "income"] as const as column (column)}
					<Table.Cell class={[cell, "text-right tabular-nums"]} data-column={column}>
						{#if !entry || entry.state === "loading"}
							<span class="text-muted-foreground"
								><span aria-hidden="true">…</span><span class="sr-only">Loading</span></span
							>
						{:else if entry.state === "failed"}
							{@const message = messageFor(entry.error)}
							<span class="text-muted-foreground" title={`${message.title}. ${message.what}`}
								>Not available<span class="sr-only">: {message.title}. {message.what}</span></span
							>
						{:else}
							{@const figure = entry.figures[column]}
							{#if "hidden" in figure}
								<span class={hiddenFigure} title={figure.hidden}
									><Icon name="lock" class="size-[11px]" />{figure.hidden}</span
								>
							{:else if "count" in figure}
								{figure.count} {figure.unit}
							{:else}
								{formatMoney(figure.cents, figure.currency)}
							{/if}
						{/if}
					</Table.Cell>
				{/each}
				<Table.Cell class={[cell, "text-right tabular-nums"]}>
					{#if school.attentionCount === null}
						<span class="text-muted-foreground"
							><span aria-hidden="true" title="No source counts this yet">—</span><span class="sr-only"
								>No source counts this yet.</span
							></span
						>
					{:else if school.attentionCount > 0}
						<Badge class={[mockBadge, badgeTones.warning, "gap-0.5 whitespace-nowrap"]}>
							<Icon name="alert" class="size-[11px]" />{school.attentionCount}
						</Badge>
					{:else}
						0
					{/if}
				</Table.Cell>
				<Table.Cell class={cell}>
					<span
						class={[
							"mr-1 inline-block size-[7px] rounded-full",
							school.stale ? "bg-warning" : "bg-success",
						]}
					></span>{school.lagMinutes} min{school.stale ? " · stale" : ""}
				</Table.Cell>
			</Table.Row>
		{/each}
		<Table.Row class="border-0 font-semibold hover:bg-transparent" data-test="all-schools-total">
			<Table.Cell class={cell}>Total</Table.Cell>
			<Table.Cell class={cell} data-column="outstanding"></Table.Cell>
			<Table.Cell class={[cell, "text-right tabular-nums"]} data-column="income">
				{#if anyLoading}
					<span class="text-muted-foreground"
						><span aria-hidden="true">…</span><span class="sr-only">Loading</span></span
					>
				{:else}
					{totals.totals.map(({ currency, cents }) => formatMoney(cents, currency)).join(" + ")}
				{/if}
				{#if partialNote && !anyLoading}
					<div class="text-[10.5px] font-normal text-muted-foreground" data-test="income-partial">
						{partialNote}
					</div>
				{/if}
			</Table.Cell>
			<Table.Cell class={[cell, "text-right tabular-nums"]}>{counted ? attentionTotal : "—"}</Table.Cell>
			<Table.Cell class={cell}></Table.Cell>
		</Table.Row>
	</Table.Body>
</Table.Root>
<p class="mt-2.5 mb-0 text-muted-foreground" data-test="all-schools-note">
	Totals are never summed across currencies or units. Open a school to act on it: actions always run inside one school.
</p>
