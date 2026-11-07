<script lang="ts">
	import { type Period, periodLabel } from "$contract/app/period.ts";
	import type { School } from "$contract/data/types.ts";
	import { Badge } from "$lib/components/ui/badge/index.ts";
	import * as Table from "$lib/components/ui/table/index.ts";
	import Icon from "./Icon.svelte";
	import { badgeTones, mockBadge } from "./styles.ts";

	/** The All schools pane (mockup `#all`, `portfolio()`): one row per school, a total row. Outstanding and Income
	 * come from the Dashboard's documents in S9.1; until then they are a dash, never 0. A school with no attention
	 * count (the HTTP build) shows a dash too. */
	let {
		schools,
		period,
		onOpen,
	}: { schools: School[]; period: Period; onOpen: (schoolId: string) => void } =
		$props();

	const counted = $derived(
		schools.every((school) => school.attentionCount !== null),
	);
	const attentionTotal = $derived(
		schools.reduce((total, school) => total + (school.attentionCount ?? 0), 0),
	);
	/** Headers and cells wrap as the mockup's do, so that at phone widths every column stays in view; only badges
	 * keep to one line. */
	const header =
		"h-auto border-b border-border px-2 py-1.5 text-left align-bottom text-[10.5px] font-medium whitespace-normal text-muted-foreground";
	const cell = "border-b border-border px-2 py-[7px] align-middle whitespace-normal";
	const pending = "Not shown yet: it arrives with the Dashboard (S9.1).";
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
				{#each ["outstanding", "income"] as column (column)}
					<Table.Cell class={[cell, "text-right tabular-nums text-muted-foreground"]}>
						<span aria-hidden="true" title={pending}>—</span><span class="sr-only">{pending}</span>
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
			<Table.Cell class={cell}></Table.Cell>
			<Table.Cell class={cell}></Table.Cell>
			<Table.Cell class={[cell, "text-right tabular-nums"]}>{counted ? attentionTotal : "—"}</Table.Cell>
			<Table.Cell class={cell}></Table.Cell>
		</Table.Row>
	</Table.Body>
</Table.Root>
<p class="mt-2.5 mb-0 text-muted-foreground" data-test="all-schools-note">
	Totals are never summed across currencies or units. Open a school to act on it: actions always run inside one school.
</p>
