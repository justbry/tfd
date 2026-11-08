<script lang="ts">
	import { monthAndDay } from "$contract/app/period.ts";
	import type { DonorRow, DonorsReport, ViewerAudience } from "$contract/data/ledger.ts";
	import { Badge } from "$lib/components/ui/badge/index.ts";
	import * as Table from "$lib/components/ui/table/index.ts";
	import { formatMoney } from "../books-shared/books-text.ts";
	import { cell, headCell, mono, muted, paneBadge } from "../panes/styles.ts";

	/** The identified donors table (finance and the owner): the first 15 by amount, each name with the badge that says who
	 * may see it when the donor is anonymous. Every row is the Reader's. */
	let {
		report,
		audience,
		currency,
	}: {
		report: Extract<DonorsReport, { kind: "identified" }>;
		audience: ViewerAudience;
		currency: string | null;
	} = $props();

	const topDonors = 15;
	const shown = $derived<DonorRow[]>(report.rows.slice(0, topDonors));
</script>

<Table.Root class="text-[12px]">
	<Table.Header>
		<Table.Row class="hover:bg-transparent">
			<Table.Head class={[headCell, "whitespace-normal"]}>Name</Table.Head>
			<Table.Head class={[headCell, "whitespace-normal"]}>Kind</Table.Head>
			<Table.Head class={[headCell, "whitespace-normal"]}>Id</Table.Head>
			<Table.Head class={[headCell, "text-right whitespace-normal"]}>Payments</Table.Head>
			<Table.Head class={[headCell, "text-right whitespace-normal"]}>Total</Table.Head>
			<Table.Head class={[headCell, "whitespace-normal"]}>Last</Table.Head>
		</Table.Row>
	</Table.Header>
	<Table.Body>
		{#each shown as row (row.id)}
			<Table.Row class="hover:bg-transparent" data-test="donor-row" data-id={row.id}>
				<Table.Cell class={[cell, "whitespace-normal"]} data-test="donor-name">
					<b>{row.name}</b>
					{#if row.anonymous}
						{#if audience === "owner"}
							{" "}<Badge class={paneBadge} title="Anonymous to the finance admin: only the owner sees this name">Anonymous to finance</Badge>
						{:else}
							{" "}<span class={muted}>name with the owner only</span>
						{/if}
					{/if}
				</Table.Cell>
				<Table.Cell class={[cell, "whitespace-normal"]} data-test="donor-kind">
					{row.kind === "donor" ? "Donor" : "Member"}
					{#if row.fund}{" "}<span class={muted}>{`· ${row.fund}`}</span>{/if}
				</Table.Cell>
				<Table.Cell class={[cell, mono, muted]} data-test="donor-id">{row.id}</Table.Cell>
				<Table.Cell class={[cell, "text-right tabular-nums"]} data-test="donor-payments">{row.payments}</Table.Cell>
				<Table.Cell class={[cell, "text-right tabular-nums"]} data-test="donor-total">{formatMoney(row.totalCents, currency)}</Table.Cell>
				<Table.Cell class={[cell, muted]} data-test="donor-last">{monthAndDay(row.lastPaymentOn)}</Table.Cell>
			</Table.Row>
		{/each}
	</Table.Body>
</Table.Root>
{#if report.rows.length > shown.length}
	<p class={[muted, "mt-1.5 mb-0"]} data-test="donors-more">
		{`Top ${shown.length} of ${report.rows.length} by amount. Download for the full list.`}
	</p>
{/if}
