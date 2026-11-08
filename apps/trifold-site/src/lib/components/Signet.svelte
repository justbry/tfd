<script lang="ts" module>
export type SignetState =
	| "lit"
	| "ink"
	| "unlit"
	| "checking"
	| "broken"
	| "unchecked";
</script>

<script lang="ts">
	/**
	 * The Trifold signet: the mark of a signed receipt. A receipt folded in thirds, ringed by mono microtext (the school,
	 * the key, the date, the fingerprint) and a guilloché rosette drawn from the receipt's fingerprint, so every receipt's
	 * signet is its own and a copied one visibly mismatches. Flat and outlined.
	 *
	 * States: "lit" (proof green, after a pass on the verify page), "ink" (printed or static: ink on paper), "unlit" (a
	 * hint: nothing checked yet), "checking", "broken" (doesn't match) and "unchecked" (couldn't be checked).
	 * Small sizes (≤ 72px) drop the microtext and draw one bolder band so the signet stays crisp at 48px.
	 */
	import FoldedReceipt from "./FoldedReceipt.svelte";
	import {
		BANDS_COMPACT,
		BANDS_FULL,
		CENTER,
		circlePath,
		groupFingerprint,
		rosettePaths,
	} from "#lib/verify/signet";

	let {
		size = 240,
		state = "ink",
		fingerprint = null,
		org = "",
		keyId = "",
		date = "",
		class: className = "",
		title = "",
	}: {
		size?: number;
		state?: SignetState;
		/** 8 hex: the signed bytes' fingerprint. null draws a plain rosette. */
		fingerprint?: string | null;
		/** The school's short name. */
		org?: string;
		keyId?: string;
		/** YYYY-MM-DD. */
		date?: string;
		class?: string;
		/** Accessible name; empty hides the signet from assistive tech (when the text beside it says the same). */
		title?: string;
	} = $props();

	const uid = $props.id();
	const compact = $derived(size <= 72);
	/** Microtext reads from about 140px up; below that the band shows a plain dotted ring. */
	const micro = $derived(size >= 140);
	const paths = $derived(rosettePaths(fingerprint, compact ? BANDS_COMPACT : BANDS_FULL, compact ? 240 : 480));
	const RING = 77;
	const ringText = $derived.by(() => {
		const parts = [
			org ? org.toUpperCase().slice(0, 22) : "TRIFOLD",
			keyId ? `KEY ${keyId.toUpperCase().slice(0, 28)}` : "SIGNED RECEIPT",
			date || "····-··-··",
			fingerprint ? `FP ${groupFingerprint(fingerprint).toUpperCase()}` : "FP ···· ····",
		];
		return `${parts.join(" · ")} · `;
	});
	const seal = $derived(state === "lit" || state === "ink" ? "set" : state === "broken" ? "broken" : "open");
	const description = $derived(
		[
			"A receipt folded in thirds inside a patterned ring.",
			fingerprint ? `Fingerprint ${groupFingerprint(fingerprint)}.` : "",
			keyId ? `Key ${keyId}.` : "",
			date ? `Date ${date}.` : "",
		]
			.filter(Boolean)
			.join(" "),
	);
</script>

<svg
	class="signet signet-{state} {className}"
	class:signet-compact={compact}
	width={size}
	height={size}
	viewBox="0 0 240 240"
	role={title ? "img" : undefined}
	aria-hidden={title ? undefined : "true"}
	aria-labelledby={title ? `${uid}-t ${uid}-d` : undefined}
	data-fingerprint={fingerprint ?? undefined}
>
	{#if title}
		<title id="{uid}-t">{title}</title>
		<desc id="{uid}-d">{description}</desc>
	{/if}
	<circle cx={CENTER} cy={CENTER} r="117" fill="var(--signet-ground)" stroke="var(--signet-ink)" stroke-width={compact ? 6 : 1.6} />
	<g class="signet-rosette" fill="none" stroke="var(--signet-ink)" stroke-width={compact ? 3.2 : 0.75} opacity={compact ? 0.9 : 0.85}>
		{#each paths as d, index (index)}
			<path {d} pathLength="1" style="--i:{index}" />
		{/each}
	</g>
	<circle cx={CENTER} cy={CENTER} r={compact ? 88 : 88.5} fill="var(--signet-ground)" stroke="var(--signet-ink)" stroke-width={compact ? 5 : 1.2} />
	{#if !compact}
		<circle cx={CENTER} cy={CENTER} r="72" fill="none" stroke="var(--signet-ink)" stroke-width="0.8" opacity="0.6" />
		{#if micro}
		<path id="{uid}-ring" d={circlePath(RING)} fill="none" />
		<text class="signet-microtext" fill="var(--signet-ink)" font-size="7.4" letter-spacing="0.6">
			<textPath href="#{uid}-ring" textLength={Math.round(2 * Math.PI * RING) - 4} lengthAdjust="spacing">{ringText}</textPath>
		</text>
		{:else}
			<circle cx={CENTER} cy={CENTER} r="80" fill="none" stroke="var(--signet-ink)" stroke-width="2.4" stroke-dasharray="0.1 6" stroke-linecap="round" />
		{/if}
	{/if}
	<FoldedReceipt {seal} {compact} />
</svg>

<style>
	.signet {
		--signet-ink: var(--foreground);
		--signet-ground: transparent;
		--signet-paper: var(--card);
		--signet-fold: color-mix(in srgb, var(--signet-ink) 9%, var(--card));
		--signet-seal: var(--seal);
		--signet-seal-ink: var(--seal-ink);
		flex: none;
		overflow: visible;
	}
	.signet-lit {
		--signet-ink: var(--proof);
	}
	.signet-unlit {
		--signet-ink: color-mix(in srgb, var(--muted-foreground) 70%, var(--background));
		--signet-fold: var(--card);
	}
	:global(.dark) .signet-unlit {
		--signet-ink: color-mix(in srgb, var(--muted-foreground) 55%, transparent);
	}
	.signet-checking {
		--signet-ink: var(--muted-foreground);
	}
	.signet-unchecked {
		--signet-ink: var(--muted-foreground);
	}
	.signet-broken {
		--signet-ink: var(--alert);
		--signet-fold: color-mix(in srgb, var(--alert) 10%, var(--card));
	}
	.signet-microtext {
		font-family: var(--font-mono);
		font-weight: 500;
		font-feature-settings: "tnum";
	}
	.signet-broken .signet-rosette {
		stroke-dasharray: 0.06 0.025;
	}
	.signet-unlit .signet-rosette,
	.signet-unchecked .signet-rosette {
		opacity: 0.55;
	}

	@media (prefers-reduced-motion: no-preference) {
		.signet-lit .signet-rosette path {
			stroke-dasharray: 1;
			animation: signet-draw 900ms cubic-bezier(0.16, 1, 0.3, 1) both;
			animation-delay: calc(var(--i) * 45ms);
		}
		.signet-lit :global(.signet-check) {
			stroke-dasharray: 1;
			animation: signet-draw 500ms cubic-bezier(0.16, 1, 0.3, 1) 350ms both;
		}
		.signet-checking .signet-rosette {
			transform-origin: 120px 120px;
			animation: signet-turn 1.6s linear infinite;
		}
	}
	@keyframes signet-draw {
		from {
			stroke-dashoffset: 1;
		}
		to {
			stroke-dashoffset: 0;
		}
	}
	@keyframes signet-turn {
		to {
			transform: rotate(30deg);
		}
	}
	@media (prefers-contrast: more) {
		.signet-unlit,
		.signet-unchecked,
		.signet-checking {
			--signet-ink: var(--foreground);
		}
		.signet .signet-rosette {
			opacity: 1;
		}
	}
</style>
