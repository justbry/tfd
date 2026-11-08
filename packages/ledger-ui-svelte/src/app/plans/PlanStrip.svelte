<script lang="ts">
	import { monthName } from "$contract/app/period.ts";
	import type { PlanSummary } from "$contract/data/plans.ts";
	import { formatMoney } from "../money.ts";
	import PaneIcon from "../PaneIcon.svelte";
	import type { PaneIconName } from "../pane-icons.ts";
	import type { PlansView } from "./plans-menu.ts";
	import Withheld from "./Withheld.svelte";
	import { financeOnlyText } from "./tables-model.ts";

	/** The strip over the tables (mockup `strip`): the server's counts and the month's gross, which an admin without the
	 * finance grant does not see. Active members, Ending soon and Need attention open Members; Collected the Dashboard.
	 * Collected names the month the viewed period reads from (mockup `dm`) while its figure is withheld; with a figure it
	 * names the month the server summed, so the label never claims a month the figure is not for. */
	let {
		view,
		summary,
		currency,
		attentionCount,
		viewedMonth,
		onMembers,
		onDashboard,
	}: {
		view: PlansView;
		summary: PlanSummary;
		currency: string | null;
		/** Null when no source counts it: the stat shows "—", never 0. */
		attentionCount: number | null;
		/** The month the viewed period reads from (`YYYY-MM-01`): it names the stat when its figure is withheld. */
		viewedMonth: string;
		onMembers: () => void;
		onDashboard: () => void;
	} = $props();

	const collected = $derived(summary.collected);
	const stats = $derived<
		Array<{ stat: string; icon: PaneIconName; label: string; click: () => void }>
	>([
		{ stat: "active", icon: "users", label: "Active members", click: onMembers },
		{
			stat: "collected",
			icon: "coin",
			label: collected
				? `Collected in ${monthName(view.finance ? `${collected.period}-01` : viewedMonth)}`
				: "Collected",
			click: onDashboard,
		},
		{ stat: "ending", icon: "clock", label: "Ending soon", click: onMembers },
		{ stat: "attention", icon: "alert", label: "Need attention", click: onMembers },
	]);
</script>

<div class="mb-3 grid grid-cols-4 gap-2">
	{#each stats as stat (stat.stat)}
		<button
			type="button"
			class="cursor-pointer rounded-[10px] border border-border bg-card px-[11px] py-[9px] text-left text-foreground"
			data-test="plan-stat"
			data-stat={stat.stat}
			onclick={stat.click}
		>
			<small class="block text-[10.5px] text-muted-foreground" data-test="plan-stat-label"
				><PaneIcon name={stat.icon} class="mr-1 inline size-[13px] align-[-2px]" /> {stat.label}</small
			>
			<b
				class={["block text-[17px] tabular-nums", stat.stat === "attention" && "text-destructive"]}
				data-test="plan-stat-value"
			>
				{#if stat.stat === "active"}{summary.activeMembers}
				{:else if stat.stat === "ending"}{summary.endingSoon}
				{:else if stat.stat === "attention"}{attentionCount ?? "—"}
				{:else if !view.finance}<Withheld text={financeOnlyText} />
				{:else}{collected && currency ? formatMoney(collected.amount, currency) : "—"}{/if}
			</b>
		</button>
	{/each}
</div>
