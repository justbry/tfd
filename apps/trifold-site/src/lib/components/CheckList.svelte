<script lang="ts">
/**
 * The four named checks (signature, key, books, seal) as a live list. Every state has an icon and a word, never color
 * alone. While a check runs the rows wait; when the report lands they settle one by one (under ~0.5s; instant with
 * reduced motion).
 */
import type { CheckRow } from "#lib/verify/report";

const {
	rows,
	checking = false,
	pending = false,
	compact = false,
}: {
	rows: CheckRow[];
	/** The check is running: rows show as in progress. */
	checking?: boolean;
	/** Nothing has run: the list says what will be checked. */
	pending?: boolean;
	compact?: boolean;
} = $props();

const word = (row: CheckRow): string => {
	if (pending) return "";
	if (checking) return "Checking";
	if (row.state === "pass") return "Holds";
	if (row.state === "fail") return "Doesn't match";
	if (row.state === "neutral")
		return row.id === "seal" ? "Not yet" : "Couldn't check";
	return "Not checked";
};
const tone = (row: CheckRow): string => {
	if (pending || checking) return "text-muted-foreground";
	if (row.state === "pass") return "text-proof-text";
	if (row.state === "fail") return "text-alert-text";
	return "text-muted-foreground";
};
</script>

<ol class="grid" aria-label={pending ? "What gets checked" : "The checks"}>
	{#each rows as row, index (row.id)}
		<li
			class="check-row grid grid-cols-[28px_minmax(0,1fr)] gap-x-3.5 border-t border-border first:border-t-0 {compact
				? 'py-2.5'
				: 'py-3.5'}"
			class:check-settle={!checking && !pending}
			style="--i:{index}"
		>
			<span
				class="mt-px grid size-7 place-items-center rounded-full border {tone(row)} {checking
					? 'check-wait border-dashed border-line-strong'
					: pending
						? 'border-line-strong'
						: row.state === 'pass'
							? 'border-[color-mix(in_srgb,var(--proof)_55%,transparent)] bg-[color-mix(in_srgb,var(--proof)_12%,transparent)]'
							: row.state === 'fail'
								? 'border-[color-mix(in_srgb,var(--alert)_55%,transparent)] bg-[color-mix(in_srgb,var(--alert)_10%,transparent)]'
								: row.state === 'neutral'
									? 'border-line-strong'
									: 'border-dashed border-line-strong'}"
				aria-hidden="true"
			>
				<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
					{#if pending}
						<text x="7" y="10.5" text-anchor="middle" stroke="none" fill="currentColor" font-size="9.5" font-family="var(--font-mono)">{index + 1}</text>
					{:else if checking}
						<circle cx="7" cy="7" r="1.6" fill="currentColor" stroke="none" />
					{:else if row.state === "pass"}
						<path d="M3 7.4 L5.8 10 L11 4.2" />
					{:else if row.state === "fail"}
						<path d="M4 4 L10 10 M10 4 L4 10" />
					{:else if row.state === "neutral"}
						<circle cx="7" cy="7" r="3.2" />
					{:else}
						<path d="M4 7 H10" />
					{/if}
				</svg>
			</span>
			<div class="min-w-0">
				<p class="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
					<span class="font-semibold {compact ? 'text-[15px]' : 'text-base'}">
						{row.label}
						<span class="ml-1.5 font-mono text-[11px] font-normal tracking-[0.04em] text-muted-foreground">{row.term}</span>
					</span>
					{#if word(row)}
						<span class="font-mono text-[11px] font-medium tracking-[0.12em] uppercase {tone(row)}">{word(row)}</span>
					{/if}
				</p>
				{#if checking || row.note}
					<p class="mt-0.5 text-muted-foreground {compact ? 'text-[13.5px]' : 'text-[14.5px]'} [overflow-wrap:anywhere]">
						{checking ? "…" : row.note}
					</p>
				{/if}
			</div>
		</li>
	{/each}
</ol>

<style>
	@media (prefers-reduced-motion: no-preference) {
		.check-settle {
			animation: rise 0.45s cubic-bezier(0.16, 1, 0.3, 1) both;
			animation-delay: calc(var(--i) * 110ms);
		}
		.check-wait {
			animation: check-breathe 1.2s ease-in-out infinite;
			animation-delay: calc(var(--i) * 150ms);
		}
	}
	@keyframes check-breathe {
		50% {
			opacity: 0.35;
		}
	}
</style>
