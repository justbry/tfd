<script lang="ts">
	import type { CreditUnit, SchoolRules } from "$contract/data/ledger.ts";
	import * as Card from "$lib/components/ui/card/index.ts";
	import * as Table from "$lib/components/ui/table/index.ts";
	import BooksIcon from "../books-shared/BooksIcon.svelte";
	import { card, heading } from "../books-shared/styles.ts";
	import { cell, link, muted } from "../panes/styles.ts";

	/** The rules in force (mockup `rules`): the cancel cutoff and what a no-show and a late cancel do to the unit. A
	 * rule with no source (D11) says so and claims no cutoff. Every audience sees them; an admin of a real school can
	 * go on to the school's settings. */
	let {
		rules,
		unit,
		canEdit,
		onEdit,
	}: {
		/** Null where no source has the rules (D11). */
		rules: SchoolRules | null;
		unit: CreditUnit;
		/** An admin of a real school; a demo school is read-only, so it has no way to an edit. */
		canEdit: boolean;
		onEdit: () => void;
	} = $props();

	const ruleNotAvailable = "Not available";
	const rows = $derived([
		{
			rule: "cutoff",
			label: "Cancel cutoff (default)",
			value: rules ? `${rules.cancelCutoffHours} hours before` : ruleNotAvailable,
		},
		{
			rule: "no-show",
			label: "No-show",
			value: rules ? `${unit.other} are ${rules.noShow === "spend" ? "spent" : "released"}` : ruleNotAvailable,
		},
		{
			rule: "late-cancel",
			label: "Late cancel",
			value: rules ? `${unit.other} are ${rules.lateCancel === "spend" ? "forfeited" : "released"}` : ruleNotAvailable,
		},
	]);
</script>

<Card.Root class={card} data-test="report-rules">
	<h5 class={heading}><BooksIcon name="clock" class="inline size-3.5 align-[-2px]" /> Rules in force</h5>
	<Table.Root class="text-[12px]">
		<Table.Body>
			{#each rows as { rule, label, value } (rule)}
				<Table.Row class="hover:bg-transparent" data-test="report-rule" data-rule={rule}>
					<Table.Cell class={[cell, "whitespace-normal"]}>{label}</Table.Cell>
					<Table.Cell class={[cell, "text-right tabular-nums whitespace-normal"]}>{value}</Table.Cell>
				</Table.Row>
			{/each}
		</Table.Body>
	</Table.Root>
	<p class={[muted, "mt-2 mb-0"]}>School policy: every audience sees it. An item can set its own cutoff.</p>
	{#if canEdit}
		<button type="button" class={[link, "mt-1.5 [&_svg]:mr-1"]} data-test="report-rules-edit" onclick={onEdit}
			><BooksIcon name="ext" />Edit in school settings</button
		>
	{/if}
</Card.Root>
