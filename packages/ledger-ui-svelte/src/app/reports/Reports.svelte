<script lang="ts">
	import "./reports.css";
	import { parsePeriod } from "$contract/app/period.ts";
	import { formatRoute, type Route, withQuery } from "$contract/app/route.ts";
	import {
		type AudienceReport,
		audienceNames,
		csvFileNames,
		type DonorsReport,
		type IncomeStatement,
		needsPin,
		type SchoolRules,
		type StatementCsvRow,
		statementColumns,
		statementLines,
		type CreditUnit,
	} from "$contract/data/ledger.ts";
	import type { School } from "$contract/data/types.ts";
	import * as Card from "$lib/components/ui/card/index.ts";
	import { read } from "../../effect/run.ts";
	import BooksIcon from "../books-shared/BooksIcon.svelte";
	import { csvCurrency } from "../books-shared/books-text.ts";
	import DownloadButton from "../books-shared/DownloadButton.svelte";
	import { ReadSlot } from "../books-shared/read-slot.svelte.ts";
	import { card, heading, twoColumns } from "../books-shared/styles.ts";
	import PinLock from "../books/PinLock.svelte";
	import { useApp } from "../context.ts";
	import LoadFailed from "../LoadFailed.svelte";
	import { retryFor } from "../panes/retry-for.ts";
	import { toolsSpacer, tools } from "../panes/styles.ts";
	import { notify, notifySuccess } from "../panes/writes.ts";
	import type { Viewing } from "../viewing.ts";
	import DocumentBody from "./DocumentBody.svelte";
	import DocumentTable from "./DocumentTable.svelte";
	import Donors from "./Donors.svelte";
	import {
		documentColumns,
		documentRows,
		ledgerRoute,
		slug,
	} from "./reports-model.ts";
	import Rules from "./Rules.svelte";
	import StatementBody from "./StatementBody.svelte";
	import StatementTable from "./StatementTable.svelte";

	/** The Reports tab (mockup `reports()`). Finance admins and the owner get the period's income statement, with the
	 * drill-downs into the Ledger; Public, Member and Governance get their audience's document, at its grain, with the
	 * figures the cell rules and the delay allow. The statement (or the document), the rules in force and the donors are
	 * three reads, each with its own toast owner and its own message in the message table's words: a statement that fails
	 * is the pane's message (Retry where the table has one, never an empty table or a 0), the rules or the donors that
	 * fail leave their card with the message and the rest as it is. Every figure is the Reader's. Leaving the pane or the
	 * period lets a read go with no toast. A PIN-locked view shows the PIN prompt. `onRendered` says when the route's
	 * report, the PIN prompt or its message is on screen. */
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

	type Main =
		| { statement: IncomeStatement; document: null }
		| { statement: null; document: AudienceReport };
	type RulesRead = { rules: SchoolRules | null; unit: CreditUnit | null };

	const app = useApp();
	const { today } = app.calendar;
	const { query } = $derived(route);
	const audience = $derived(viewing.option.audience);
	const admin = $derived(viewing.option.admin);
	const documentAudience = $derived(
		audience === "finance" || audience === "owner" ? null : audience,
	);
	const pinLocked = $derived(query.get("pin") === "locked" && needsPin(audience));
	const period = $derived(parsePeriod(query.get("month"), today));
	const compare = $derived(query.get("compare") === "1");
	const year = Number(today.slice(0, 4));
	const key = $derived(
		[school.id, audience, period.from, period.to, compare].map(String).join("|"),
	);

	const mainRead = new ReadSlot<Main>();
	const rulesRead = new ReadSlot<RulesRead>();
	const donorsRead = new ReadSlot<DonorsReport>();
	$effect(() => {
		if (pinLocked) return;
		const asked = {
			key,
			school: school.id,
			audience,
			documentAudience,
			from: period.from,
			to: period.to,
			compare,
		};
		const cancels = [
			mainRead.begin(app, asked.key, () =>
				read(async (reader): Promise<Main> =>
					asked.documentAudience === null
						? {
								statement: await reader.incomeStatement({
									school: asked.school,
									from: asked.from,
									to: asked.to,
									compare: asked.compare,
								}),
								document: null,
							}
						: {
								statement: null,
								document: await reader.audienceReport({
									school: asked.school,
									audience: asked.documentAudience,
									from: asked.from,
									to: asked.to,
								}),
							},
				),
			),
			rulesRead.begin(app, asked.key, () => read((reader) => reader.schoolRules(asked.school))),
			// Donor names have no source yet (S8-contract section 11): a donors read that is not available leaves the card
			// with the message, and the rest of the report as it is.
			donorsRead.begin(app, asked.key, () =>
				read((reader) => reader.donors({ school: asked.school, audience: asked.audience, year })),
			),
		];
		// Leaving the period, the school or the pane lets the reads go: no toast, no log entry.
		return () => {
			for (const cancel of cancels) cancel();
		};
	});

	const loaded = $derived(mainRead.valueFor(key));
	const failed = $derived(mainRead.failureFor(key));
	const rules = $derived(rulesRead.valueFor(key));
	const donors = $derived(donorsRead.valueFor(key));
	const rulesFailed = $derived(rulesRead.failureFor(key));
	const donorsFailed = $derived(donorsRead.failureFor(key));
	const ready = $derived(loaded !== null && rulesRead.settledFor(key) && donorsRead.settledFor(key));
	$effect(() => {
		if (pinLocked || ready || failed) onRendered(formatRoute(route));
	});

	const unlocked = (): void => {
		navigate(withQuery(route, "pin", null));
		notifySuccess(app, "Books unlocked for this session.");
	};
	const openLedger = (drill: Parameters<typeof ledgerRoute>[1]): void => navigate(ledgerRoute(route, drill));
	// The statement as Reports shows it: a school with no published menu has no statement currency or unit, so the
	// school's own stand in (as the Ledger's do).
	const statement = $derived(loaded?.statement ?? null);
	const audienceDocument = $derived(loaded?.document ?? null);
	const statementCurrency = $derived(statement ? (statement.currency ?? school.currency) : null);
	const statementUnit = $derived(statement?.unit ?? school.creditUnit);
	const statementRowsForCsv = $derived<StatementCsvRow[]>(
		statement
			? statementLines.map(([line, field]) => ({ line, amountCents: statement.amounts[field] }))
			: [],
	);
	const edit = (): void => notify(app, { tone: "info", title: "Opening school settings in buzz-school…" });
</script>

<!-- The shell's `text-sm` ancestor gives the pane a line height of 1.4286; the mockup's is 1.4. -->
<div class="leading-[1.4]" data-test="reports-pane">
{#if pinLocked}
	{#key audience}
		<PinLock schoolId={school.id} levelName={audienceNames[audience]} onUnlocked={unlocked} />
	{/key}
{:else if failed}
	<LoadFailed error={failed} onRetry={retryFor(failed, mainRead.retry)} busy={mainRead.busy} />
{:else if ready && loaded}
	<div class={tools}>
		<span class={toolsSpacer}></span>
		{#if statement}
			<DownloadButton
				kind="button"
				test="report-download"
				title="Download the income statement as CSV"
				label="Download"
				name={csvFileNames.statement(statement.from, statement.to)}
				columns={statementColumns({ from: statement.from, to: statement.to, currency: csvCurrency(statementCurrency) })}
				rows={statementRowsForCsv}
				scope={school.id}
			/>
		{/if}
		{#if audienceDocument}
			<DownloadButton
				kind="button"
				test="report-download"
				title={`Download the ${audienceNames[audienceDocument.audience]} document's figures as CSV (aggregates only)`}
				label="Download"
				name={`books-${audienceDocument.audience}-${slug(audienceDocument.periodLabel)}.csv`}
				columns={documentColumns(audienceDocument)}
				rows={documentRows(audienceDocument, school.currency)}
				scope={school.id}
			/>
		{/if}
	</div>
	{#if statement}
		<StatementBody
			{statement}
			{period}
			currency={statementCurrency}
			unit={statementUnit}
			onDrill={openLedger}
			onPromos={() => navigate({ ...route, tab: "promos" })}
		/>
	{/if}
	{#if audienceDocument}
		<DocumentBody document={audienceDocument} currency={school.currency} />
	{/if}
	<div class={twoColumns}>
		<Card.Root class={card}>
			{#if statement}
				<StatementTable {statement} {period} currency={statementCurrency} onDrill={openLedger} />
			{/if}
			{#if audienceDocument}
				<DocumentTable document={audienceDocument} currency={school.currency} />
			{/if}
		</Card.Root>
		{#if rulesFailed}
			<Card.Root class={card} data-test="report-rules">
				<h5 class={heading}><BooksIcon name="clock" class="inline size-3.5 align-[-2px]" /> Rules in force</h5>
				<LoadFailed error={rulesFailed} onRetry={retryFor(rulesFailed, rulesRead.retry)} busy={rulesRead.busy} />
			</Card.Root>
		{:else if rules}
			<Rules
				rules={rules.rules}
				unit={rules.unit ?? school.creditUnit}
				canEdit={admin && !school.demo}
				onEdit={edit}
			/>
		{/if}
	</div>
	<Card.Root class={[card, "mt-2.5"]} data-test="donors">
		{#if donorsFailed}
			<h5 class={heading} data-test="donors-title"><BooksIcon name="users" class="inline size-3.5 align-[-2px]" /> Donors and payers</h5>
			<LoadFailed error={donorsFailed} onRetry={retryFor(donorsFailed, donorsRead.retry)} busy={donorsRead.busy} />
		{:else if donors}
			<Donors report={donors} {audience} currency={school.currency} {today} scope={school.id} />
		{/if}
	</Card.Root>
{/if}
</div>
