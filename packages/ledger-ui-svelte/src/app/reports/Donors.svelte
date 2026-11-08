<script lang="ts">
	import { monthAndDay } from "$contract/app/period.ts";
	import {
		audienceNames,
		csvFileNames,
		type DonorsReport,
		donorsColumns,
		type ViewerAudience,
	} from "$contract/data/ledger.ts";
	import BooksIcon from "../books-shared/BooksIcon.svelte";
	import BooksLock from "../books-shared/BooksLock.svelte";
	import { csvCurrency, identitiesLockHeading } from "../books-shared/books-text.ts";
	import DownloadButton from "../books-shared/DownloadButton.svelte";
	import { heading } from "../books-shared/styles.ts";
	import { muted } from "../panes/styles.ts";
	import DonorSpread from "./DonorSpread.svelte";
	import DonorTable from "./DonorTable.svelte";

	/** The Donors and payers card: the identified table for finance and the owner (every identified read is audited), how
	 * gifts spread for governance, and a lock panel below. The CSV is the Reader's rows as they stand at the click. */
	let {
		report,
		audience,
		currency,
		today,
		scope,
	}: {
		report: DonorsReport;
		audience: ViewerAudience;
		currency: string | null;
		today: string;
		/** The school the report is for. */
		scope: string;
	} = $props();
	const unscaled = "font-normal normal-case";
</script>

{#if report.kind === "none"}
	<h5 class={heading} data-test="donors-title"><BooksIcon name="users" class="inline size-3.5 align-[-2px]" /> Donors and payers</h5>
	<BooksLock
		lock={{
			reason: "no_grant",
			who: identitiesLockHeading,
			when: `Names and per-person amounts. Governance sees how gifts spread. ${audienceNames[audience]} sees totals and categories only.`,
		}}
	/>
{:else if report.kind === "spread"}
	<h5 class={heading} data-test="donors-title">
		<BooksIcon name="users" class="inline size-3.5 align-[-2px]" /> How donors give{" "}<span class={[muted, unscaled]}>spread, no names</span>
	</h5>
	<DonorSpread {report} {currency} />
	<p class={[muted, "mt-2 mb-0"]}>
		<BooksIcon name="info" class="mr-1 inline align-[-2px]" />
		{` ${report.through.slice(0, 4)} to the end of ${monthAndDay(`${report.through}-01`).slice(0, 3)} (closed months). Names, emails and per-person rows show to finance admins and the owner only.`}
	</p>
{:else}
	<h5 class={heading}>
		<span data-test="donors-title">
			<BooksIcon name="users" class="inline size-3.5 align-[-2px]" /> Donors and payers{" "}<span class={[muted, unscaled]}
				>{`${report.year} to date · ${report.donorCount} donor${report.donorCount === 1 ? "" : "s"}, ${report.payerCount} member payer${report.payerCount === 1 ? "" : "s"}`}</span
			>
		</span>
		<span class="normal-case">
			<DownloadButton
				kind="link"
				test="donors-csv"
				title="Download donors and payers as CSV"
				label="Download CSV"
				name={csvFileNames.donors(today)}
				columns={donorsColumns(csvCurrency(currency))}
				rows={report.rows}
				{scope}
			/>
		</span>
	</h5>
	{#if report.rows.length > 0}
		<DonorTable {report} {audience} {currency} />
	{:else}
		<div class={muted} data-test="donors-empty">No donors or payers yet.</div>
	{/if}
	<p class={[muted, "mt-2 mb-0"]} data-test="donors-audit">
		<BooksIcon name="eye" class="mr-1 inline align-[-2px]" /> Every identified read is audited.
	</p>
{/if}
