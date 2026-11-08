<script lang="ts">
	import {
		applyOverride,
		audienceNames,
		checkOverride,
		classOf,
		type DetailStep,
		type DisclosureChange,
		type DisclosureDelay,
		type DisclosureGrain,
		disclosureCell,
		type DisclosureRule,
		disclosureMessages,
		editOverride,
		initialOverrideSelection,
		type KpiClass,
		kpiClasses,
		kpiClassNames,
		type OverrideEdit,
		type OverrideSelection,
		type RuledAudience,
		type RuledClass,
		ruledAudiences,
	} from "$contract/data/disclosure.ts";
	import type { School } from "$contract/data/types.ts";
	import { Button } from "$lib/components/ui/button/index.ts";
	import * as Table from "$lib/components/ui/table/index.ts";
	import type { DisclosureOverrideConfig } from "$worker-config/types.ts";
	import { messageFor } from "../../effect/messages.ts";
	import type { ConfigEditor } from "../config/config-editor.svelte.ts";
	import ConfigConflict from "../config/ConfigConflict.svelte";
	import ConfigStepUp from "../config/ConfigStepUp.svelte";
	import { useApp } from "../context.ts";
	import Icon from "../Icon.svelte";
	import LockPanel from "../panes/LockPanel.svelte";
	import { notifySuccess } from "../panes/writes.ts";
	import PaneIcon from "../PaneIcon.svelte";
	import type { Viewing } from "../viewing.ts";
	import InlineError from "../toasts/InlineError.svelte";
	import ConfigStatus from "./ConfigStatus.svelte";
	import OverrideSelect from "./OverrideSelect.svelte";
	import PinDialog from "./PinDialog.svelte";
	import SectionState from "./SectionState.svelte";
	import {
		afterChoices,
		changeTable,
		detailChoices,
		disclosureSavedToast,
		everyChoices,
		gapError,
		overrideOf,
		roundChoices,
		ruleClasses,
	} from "./settings-model.ts";
	import {
		customAudiences,
		heading,
		inlineIcon,
		lock,
		muted,
		overrideBox,
		overrideHint,
		row,
		sectionNote,
		threeColumns,
		twoColumns,
	} from "./styles.ts";

	/** School books (mockup `bkSettings`): the disclosure table the school's audiences read, and the owner's override.
	 * The override is the `disclosure` object of the ledger's config: every edit is checked by the contract's validator
	 * (the floor, the order) as the mockup does, and by the Worker's verify (what the stored object may hold); "Check and
	 * save" asks for the PIN, then verifies and PUTs. Opening Public needs a mailed link that no route sends yet: that
	 * change says so and cannot be saved (the contract's "not available"), while the PIN-only changes can. */
	let {
		editor,
		school,
		viewing,
		own,
		money,
		publicOpening,
	}: {
		editor: ConfigEditor<"disclosure">;
		school: School;
		viewing: Viewing;
		own: boolean;
		money: (minorUnits: number) => string;
		/** Whether the mailed link that opening Public needs can be sent (it cannot yet). */
		publicOpening: boolean;
	} = $props();

	const app = useApp();
	const ids = $props.id();
	const { file, size, year } = $derived(viewing.disclosure);
	const booksLock = $derived(viewing.option.locks["settings-books"]);
	let selection = $state<OverrideSelection>(initialOverrideSelection);
	let pinFor = $state<Exclude<DisclosureChange, "none"> | null>(null);
	let pinProblem = $state<string | null>(null);
	let pinBusy = $state(false);

	// Until the stored object is read, the table shows what the school's disclosure says now.
	const draft = $derived(editor.value ? overrideOf(editor.value) : viewing.disclosure.override);
	const saved = $derived(editor.base ? overrideOf(editor.base.value) : viewing.disclosure.override);
	const effective = $derived(applyOverride(file, draft));
	const check = $derived(checkOverride(file, saved, draft, money));
	const dirty = $derived(JSON.stringify(draft) !== JSON.stringify(saved));
	/** The change "Check and save" would send: none while the validator refuses or the draft changes nothing. */
	const savable = $derived(dirty && check.errors.length === 0 && check.change !== "none" ? check.change : null);
	const mailedLink = $derived(savable === "public_open" && !publicOpening);
	const gap = $derived(messageFor(gapError("disclosure-public")));
	const rule = $derived<Partial<DisclosureRule>>(
		effective.disclose[selection.ruleClass]?.[selection.ruleAudience] ?? {},
	);
	const kpis = $derived(ruleClasses.flatMap((kpiClass) => file.classes[kpiClass]));
	const workerProblems = $derived(editor.problems);

	const edit = (change: OverrideEdit): void => {
		const next = editOverride(file, draft, selection, size, change);
		editor.edit((value) => ({ ...value, override: next as DisclosureOverrideConfig }));
	};
	const askForPin = (): void => {
		if (savable === null || mailedLink || savable === "public_open") return;
		pinProblem = null;
		pinFor = savable;
	};
	const confirmPin = async (pin: string): Promise<void> => {
		pinBusy = true;
		const result = await editor.confirmAndSave(pin, { flush: true });
		pinBusy = false;
		if (result.problem !== null) {
			pinProblem = result.problem;
			return;
		}
		pinFor = null;
		if (result.saved) notifySuccess(app, disclosureSavedToast);
	};
	// svelte-ignore state_referenced_locally
	editor.onFirstProblem(() => document.querySelector<HTMLElement>("[data-test=books-problems]")?.focus());
	const cellParts = (text: string): { before: string; muted: string } | null => {
		const inherited = text.indexOf(" (as ");
		return inherited < 0 ? null : { before: text.slice(0, inherited), muted: text.slice(inherited + 1) };
	};
	const headCell = "h-auto p-1 text-left align-top text-[10.5px] font-normal whitespace-normal text-muted-foreground";
	const bodyCell = "border-t border-border p-1 align-top text-[10.5px] whitespace-normal";
</script>

<h5 class={heading} data-test="settings-section" data-section="books">
	<Icon name="eye" /> School books <span class={[muted, sectionNote]}>who sees what, how fine, how soon</span>
</h5>
{#if booksLock}
	<LockPanel lock={booksLock} surface="settings-books" />
{:else}
	<p class={[muted, "mb-1.5"]} data-test="books-intro">
		From the disclosure file (<span class="font-mono text-[10.5px]">disclosure.v1.json</span>, B4 Uni policy) and this school's override.
		Finance admins and the owner always see everything, names included.
	</p>
	<Table.Root class="w-full text-[10.5px]">
		<Table.Header>
			<Table.Row class="border-0 hover:bg-transparent">
				<Table.Head class={headCell}>Class</Table.Head>
				<Table.Head class={headCell}>KPIs</Table.Head>
				{#each ruledAudiences as audience (audience)}
					<Table.Head class={headCell}>{audienceNames[audience]}</Table.Head>
				{/each}
				<Table.Head class={headCell}>Finance · Owner</Table.Head>
			</Table.Row>
		</Table.Header>
		<Table.Body>
			{#each kpiClasses as kpiClass (kpiClass)}
				<Table.Row class="border-0 hover:bg-transparent" data-test="disclosure-row" data-class={kpiClass}>
					<Table.Cell class={bodyCell}><b>{kpiClassNames[kpiClass]}</b></Table.Cell>
					<Table.Cell class="max-w-[150px] border-t border-border p-1 align-top font-mono text-[9.5px] break-words whitespace-normal" data-test="disclosure-kpis" data-class={kpiClass}>
						{effective.classes[kpiClass].join(", ")}
					</Table.Cell>
					{#each ruledAudiences as audience (audience)}
						{@const text = disclosureCell(effective, kpiClass, audience)}
						{@const parts = cellParts(text)}
						<Table.Cell class={bodyCell} data-test="disclosure-cell" data-class={kpiClass} data-audience={audience}>
							{#if text === "—"}<span class={muted}>—</span>{:else if parts}{parts.before} <span class={muted}>{parts.muted}</span>{:else}{text}{/if}
						</Table.Cell>
					{/each}
					<Table.Cell class={bodyCell} data-test="disclosure-cell" data-class={kpiClass} data-audience="finance">names · live</Table.Cell>
				</Table.Row>
			{/each}
		</Table.Body>
	</Table.Root>
	<p class={[muted, "my-1.5"]} data-test="rounding-note">
		Money for Public and Member is rounded by school size: under {money(file.rounding.largeFrom)} of income in the last closed year,
		{money(file.rounding.small.public)} for both; from {money(file.rounding.largeFrom)}, {money(file.rounding.large.public)}
		for Public and {money(file.rounding.large.member)} for Member. Governance and up: exact.
		<b>{school.name} is {size}</b> for {year} (fixed on 1 Jan {year}).
	</p>
	{#if !own}
		<div class={lock} id="{ids}-readonly" data-test="books-readonly"><Icon name="lock" /> Owners change the disclosure. You can read it.</div>
	{/if}
	<SectionState {editor} reading="the school's disclosure override" test="settings-books">
		{#snippet children()}
			<div class={overrideBox}>
				<b class="mb-0.5 block">Override</b>
				<div class={overrideHint}>
					A school may move a KPI between the six classes or make rules stricter. Below the floor is refused.
				</div>
				<div class={twoColumns}>
					<OverrideSelect field="kpi" label="Move a KPI" value={selection.kpi} options={kpis.map((kpi) => [kpi, kpi])} disabled={!own} describedby="{ids}-readonly" onChange={(kpi) => (selection = { ...selection, kpi })} />
					<OverrideSelect
						field="class"
						label="to class"
						value={classOf(effective, selection.kpi) ?? ""}
						options={kpiClasses.map((kpiClass) => [kpiClass, kpiClassNames[kpiClass]])}
						disabled={!own}
						describedby="{ids}-readonly"
						onChange={(value) => edit({ field: "class", value: value as KpiClass })}
					/>
				</div>
				<div class={twoColumns}>
					<OverrideSelect
						field="rule-class"
						label="Rule for class"
						value={selection.ruleClass}
						options={ruleClasses.map((kpiClass) => [kpiClass, kpiClassNames[kpiClass]])}
						disabled={!own}
						describedby="{ids}-readonly"
						onChange={(value) => (selection = { ...selection, ruleClass: value as RuledClass })}
					/>
					<OverrideSelect
						field="rule-audience"
						label="audience"
						value={selection.ruleAudience}
						options={ruledAudiences.map((audience) => [audience, audienceNames[audience]])}
						disabled={!own}
						describedby="{ids}-readonly"
						onChange={(value) => (selection = { ...selection, ruleAudience: value as RuledAudience })}
					/>
				</div>
				<div class={threeColumns}>
					<OverrideSelect
						field="detail"
						label="Detail"
						value={rule.detail ?? ""}
						options={[["", "(inherit or none)"], ...detailChoices.map((step): [string, string] => [step, step])]}
						disabled={!own}
						describedby="{ids}-readonly"
						onChange={(value) => edit({ field: "detail", value: value as DetailStep | "" })}
					/>
					<OverrideSelect
						field="every"
						label="Every"
						value={rule.every ?? "quarter"}
						options={everyChoices.map((grain) => [grain, grain])}
						disabled={!own}
						describedby="{ids}-readonly"
						onChange={(value) => edit({ field: "every", value: value as DisclosureGrain })}
					/>
					<OverrideSelect
						field="after"
						label="After"
						value={rule.after ?? ""}
						options={[["", "at close"], ...afterChoices.map((delay): [string, string] => [delay, delay])]}
						disabled={!own}
						describedby="{ids}-readonly"
						onChange={(value) => edit({ field: "after", value: value as DisclosureDelay | "" })}
					/>
				</div>
				<div class={twoColumns}>
					<OverrideSelect
						field="round"
						label={`Round Public (${size} school) to`}
						value={String(effective.rounding[size].public)}
						options={roundChoices.map((units): [string, string] => [String(units), money(units)])}
						disabled={!own}
						describedby="{ids}-readonly"
						onChange={(value) => edit({ field: "round", value: Number(value) })}
					/>
					<div></div>
				</div>
				<div class="mt-2 grid gap-[3px]" role="status" aria-live="polite" data-test="override-message">
					{#if check.errors.length > 0}
						{#each check.errors as { code, text } (code + text)}
							<div class="text-destructive"><Icon name="xCircle" class={inlineIcon} />400 {code}: {text}</div>
						{/each}
					{:else if dirty && check.change !== "none"}
						<div class="text-success"><Icon name="check" class={inlineIcon} />{disclosureMessages[check.change]}</div>
					{:else}
						<div class={muted}>
							{Object.keys(saved).length > 0
								? `${disclosureMessages.noChange.slice(0, -1)}${disclosureMessages.savedOverrideSuffix}.`
								: disclosureMessages.noChange}
						</div>
					{/if}
				</div>
				{#if workerProblems.length > 0}
					<div tabindex="-1" data-test="books-problems">
						<InlineError id="{ids}-problems" problems={workerProblems.map((problem) => ({ ...problem, message: `${problem.path}: ${problem.message}` }))} />
					</div>
				{/if}
				<div class={customAudiences} aria-disabled="true" data-test="custom-audiences">
					<Icon name="plus" />
					<span class="flex-1">
						<b class="mb-0.5 block">Custom audiences: later</b>
						<span class={muted}>A school-defined audience (a donor tier) is allowed by the schema from version 1, not accepted in the first release.</span>
					</span>
					<Button variant="tool" size="tool-small" disabled title="Not in the first release">Add audience</Button>
				</div>
				<table class="my-1.5 w-full text-[10.5px]">
					<thead>
						<tr><th class="p-1 text-left font-normal text-muted-foreground">Change</th><th class="p-1 text-left font-normal text-muted-foreground">Who</th><th class="p-1 text-left font-normal text-muted-foreground">Check</th></tr>
					</thead>
					<tbody>
						{#each changeTable as [change, who, rowCheck] (change)}
							<tr data-test="disclosure-change-row"><td class="border-t border-border p-[7px_4px]">{change}</td><td class="border-t border-border p-[7px_4px]">{who}</td><td class="border-t border-border p-[7px_4px]">{rowCheck}</td></tr>
						{/each}
					</tbody>
				</table>
				{#if own}
					<div class={row}>
						<Button variant="tool" size="tool" data-test="disclosure-reset" disabled={!dirty} onclick={() => editor.discard()}>
							<PaneIcon name="undo" />Reset
						</Button>
						<Button
							variant="primary"
							size="tool"
							class="aria-disabled:cursor-not-allowed aria-disabled:opacity-40"
							data-test="disclosure-save"
							disabled={savable === null}
							aria-disabled={mailedLink ? "true" : undefined}
							aria-describedby={mailedLink ? `${ids}-gap` : undefined}
							title={mailedLink ? `${gap.title}: ${gap.what}` : undefined}
							onclick={askForPin}
						>
							<PaneIcon name="check" />Check and save
						</Button>
					</div>
					{#if mailedLink}
						<div class={lock} id="{ids}-gap" data-test="disclosure-gap" data-kind="not_available">
							<Icon name="info" />
							<span><b>{gap.title}.</b> Opening Public needs a mailed-link confirmation, and no route sends it yet. {gap.doThis}</span>
						</div>
					{/if}
				{/if}
				<ConfigConflict {editor} prefix="settings-books" />
				<ConfigStepUp {editor} prefix="settings-books" flush />
				<ConfigStatus {editor} test="settings-books" />
			</div>
		{/snippet}
	</SectionState>
{/if}
{#if pinFor !== null && pinFor !== "public_open"}
	<PinDialog change={pinFor} problem={pinProblem} busy={pinBusy} onSave={confirmPin} onCancel={() => (pinFor = null)} />
{/if}
