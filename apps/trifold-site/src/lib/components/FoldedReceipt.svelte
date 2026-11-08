<svelte:options namespace="svg" />

<script lang="ts">
/**
 * The heart of both verification marks: a receipt folded in thirds (the Trifold fold), outer panels wide, the middle
 * one tucked in, a torn bottom edge and a saffron seal. Flat and outlined, drawn in the 240-unit signet viewBox.
 * `seal`: "set" (a filled seal with a check), "open" (an empty seal: nothing proven yet) or "broken" (a crack runs
 * through the receipt and the seal).
 */
const {
	seal = "open",
	compact = false,
}: { seal?: "set" | "open" | "broken"; compact?: boolean } = $props();

const stroke = $derived(compact ? 7 : 2.4);
const hairline = $derived(compact ? 0 : 1.4);
const TORN =
	"L148 166 l-4 6 l-4-6 l-4 6 l-4-6 l-4 6 l-4-6 l-4 6 l-4-6 l-4 6 l-4-6 l-4 6 l-4-6 l-4 6 l-4-6 L92 166";
</script>

<g stroke="var(--signet-ink)" stroke-linejoin="round" stroke-linecap="round" fill="none">
	<!-- Top panel, widening into the first fold. -->
	<path d="M92 62 L148 62 L153 96 L87 96 Z" fill="var(--signet-paper)" stroke-width={stroke} />
	<!-- Middle panel, tucked in: the fold reads as a slightly darker, narrower face. -->
	<path d="M87 96 L153 96 L148 130 L92 130 Z" fill="var(--signet-fold)" stroke-width={stroke} />
	<!-- Bottom panel with the torn edge. -->
	<path d="M92 130 L148 130 {TORN} Z" fill="var(--signet-paper)" stroke-width={stroke} />

	{#if !compact}
		<g stroke-width={hairline} opacity="0.75">
			<path d="M101 73 H139" />
			<path d="M101 81 H127" />
			<path d="M101 88 H133" opacity="0.6" />
			<path d="M99 107 H122" stroke-width="3.2" />
			<path d="M130 107 H141" stroke-width="3.2" />
			<path d="M99 117 H141" opacity="0.6" />
		</g>
	{/if}

	{#if seal === "set"}
		<circle cx="120" cy="148" r={compact ? 13 : 11} fill="var(--signet-seal)" stroke="var(--signet-seal)" stroke-width={compact ? 3 : 1.5} />
		<path
			class="signet-check"
			d={compact ? "M113 148 l5 5 l9 -10" : "M114.5 148 l4 4 l7.5 -8.5"}
			stroke="var(--signet-seal-ink)"
			stroke-width={compact ? 4.5 : 2.4}
			pathLength="1"
		/>
	{:else if seal === "broken"}
		<circle cx="120" cy="148" r={compact ? 13 : 11} stroke-width={compact ? 5 : 1.8} stroke-dasharray={compact ? "8 6" : "4 3"} />
		<path d="M131 58 L118 84 L129 98 L112 122 L124 136 L109 171" stroke="var(--signet-ink)" stroke-width={compact ? 6 : 2.2} />
	{:else}
		<circle cx="120" cy="148" r={compact ? 13 : 11} stroke-width={compact ? 5 : 1.6} stroke-dasharray={compact ? "8 6" : "3 3"} />
	{/if}
</g>
