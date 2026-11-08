<script lang="ts">
	import type { DonorsReport, ReportCell } from "$contract/data/ledger.ts";
	import BooksIcon from "../books-shared/BooksIcon.svelte";
	import { smallCount } from "../books-shared/books-text.ts";
	import { barRow, barTrack } from "../books-shared/styles.ts";
	import { muted } from "../panes/styles.ts";
	import Figure from "./Figure.svelte";

	/** How donors give, with no names (governance): the number of donors, a bar and a count per bucket, the median gift.
	 * Fewer than five donors shows no spread, only the reason; a bucket the cell rules round says why, and a count is
	 * never worked out here. */
	let {
		report,
		currency,
	}: {
		report: Extract<DonorsReport, { kind: "spread" }>;
		currency: string | null;
	} = $props();

	const spreadColors = [
		"var(--chart-1)",
		"var(--chart-2)",
		"var(--chart-3)",
		"var(--chart-4)",
		"var(--chart-5)",
	];
	const shortBucketLabels: Record<string, string> = {
		"under $100": "< $100",
		"$1,000 or more": "$1,000+",
	};
	const { donors, buckets, medianCents } = $derived(report);
	const year = $derived(report.through.slice(0, 4));
	const highest = $derived(
		Math.max(
			1,
			...buckets.flatMap(({ donors: cell }: { donors: ReportCell }) => (typeof cell === "number" ? [cell] : [])),
		),
	);
	const reasons = $derived(buckets.filter(({ why }) => why !== null));
	const distLine = "my-0.5 mb-2 text-[12.5px]";
	const whyLine = "mt-1.5 flex items-start gap-[5px] text-[10.5px] text-muted-foreground";
</script>

{#if typeof donors === "number" && donors === 0}
	<div class={muted}>{`No donations recorded in ${year} yet.`}</div>
{:else if typeof donors !== "number"}
	<div class={distLine}><Figure cell={donors} money={false} {currency} whole noun="donors" /> donors</div>
	<div class={whyLine}>
		<BooksIcon name="lock" class="mt-px size-3 flex-none" />
		<span>{`Fewer than ${smallCount} donors so far, so no spread is shown.`}</span>
	</div>
{:else}
	<div class={distLine}>
		<b>{`${donors} donors`}</b>{": "}{#each buckets as { label, donors: cell }, index (label)}{#if index > 0}{", "}{/if}<Figure {cell} money={false} {currency} whole noun="donors" />{" "}{label}{/each}{"; median gift "}<Figure cell={medianCents} money {currency} whole noun="donors" />
	</div>
	<div>
	{#each buckets as { label, donors: cell, why }, index (label)}
		<div class={barRow}>
			<span title={label}>{shortBucketLabels[label] ?? label}</span>
			<div class={barTrack}>
				{#if !why && typeof cell === "number"}
					<i class="block h-full rounded-sm" style={`width: ${(cell / highest) * 100}%; background: ${spreadColors[index % spreadColors.length] ?? ""}`}></i>
				{/if}
			</div>
			<b class="text-right font-medium tabular-nums">
				{#if why}<span class="cursor-help border-b border-dotted border-muted-foreground" title={`Rounded to the nearest 10: ${why}`}><Figure {cell} money={false} {currency} whole noun="donors" /></span>{:else}<Figure {cell} money={false} {currency} whole noun="donors" />{/if}
			</b>
		</div>
	{/each}
	</div>
	{#if reasons.length > 0}
		<div class={whyLine}>
			<BooksIcon name="lock" class="mt-px size-3 flex-none" />
			<span>{reasons.map(({ label, why }) => `${label}: ${why}`).join(" · ")}</span>
		</div>
	{/if}
{/if}
