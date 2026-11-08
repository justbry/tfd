<script lang="ts">
/**
 * The future witness seal: the signet's folded receipt inside a notary emboss (a scalloped edge and ring text) in
 * witness blue. NOT IN USE: there is no witness signature yet, so this may only appear labeled as coming (the /verify
 * explainer, /brand), never as a result.
 */

import { CENTER, circlePath, scallopPath } from "#lib/verify/signet";
import FoldedReceipt from "./FoldedReceipt.svelte";

const {
	size = 240,
	class: className = "",
	title = "",
}: { size?: number; class?: string; title?: string } = $props();

const uid = $props.id();
const compact = $derived(size <= 72);
const RING = 89;
const TEXT = "WITNESSED BY TRIFOLD · AN INDEPENDENT COPY · ";
const ticks = Array.from({ length: 72 }, (_, index) => (index * 360) / 72);
</script>

<svg
	class="witness {className}"
	width={size}
	height={size}
	viewBox="0 0 240 240"
	role={title ? "img" : undefined}
	aria-hidden={title ? undefined : "true"}
	aria-label={title || undefined}
>
	<path d={scallopPath(110, 118, 36)} fill="var(--signet-ground)" stroke="var(--signet-ink)" stroke-width={compact ? 6 : 1.6} />
	<circle cx={CENTER} cy={CENTER} r="104" fill="none" stroke="var(--signet-ink)" stroke-width={compact ? 5 : 1.2} />
	{#if !compact}
		<g stroke="var(--signet-ink)" stroke-width="0.9" opacity="0.7">
			{#each ticks as angle (angle)}
				<path d="M{CENTER} {CENTER - 104} v4" transform="rotate({angle} {CENTER} {CENTER})" />
			{/each}
		</g>
		<path id="{uid}-ring" d={circlePath(RING)} fill="none" />
		<text class="witness-text" fill="var(--signet-ink)" font-size="9.6" letter-spacing="1.2">
			<textPath href="#{uid}-ring" textLength={Math.round(2 * Math.PI * RING) - 6} lengthAdjust="spacing"
				>{TEXT}{TEXT}</textPath
			>
		</text>
	{/if}
	<circle cx={CENTER} cy={CENTER} r={compact ? 82 : 80} fill="none" stroke="var(--signet-ink)" stroke-width={compact ? 5 : 1.2} />
	{#if !compact}
		<circle cx={CENTER} cy={CENTER} r="76" fill="none" stroke="var(--signet-ink)" stroke-width="0.7" stroke-dasharray="1.5 2.5" />
	{/if}
	<FoldedReceipt seal="set" {compact} />
</svg>

<style>
	.witness {
		--signet-ink: var(--witness);
		--signet-ground: transparent;
		--signet-paper: var(--card);
		--signet-fold: color-mix(in srgb, var(--witness) 10%, var(--card));
		--signet-seal: var(--witness);
		--signet-seal-ink: var(--card);
		flex: none;
	}
	.witness-text {
		font-family: var(--font-mono);
		font-weight: 600;
	}
</style>
