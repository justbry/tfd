<script lang="ts">
	import type { PortalBalance } from "$contract/data/portal.ts";
	import { barWidths } from "./portal-model.ts";
	import { bar } from "./styles.ts";

	/** The bar of used, held and available side by side (mockup `mpBar`). */
	let { balance }: { balance: PortalBalance } = $props();
	const widths = $derived(barWidths(balance));
</script>

<div class={bar} role="img" aria-label={`used ${balance.used}, held ${balance.held}, available ${balance.available}`}>
	<i class="block h-full bg-(--mp-muted) opacity-50" style:width={widths.used}></i>
	<i class="block h-full bg-[repeating-linear-gradient(135deg,var(--mp-warn)_0_3px,transparent_3px_6px)]" style:width={widths.held}></i>
	<i class="block h-full bg-(--mp-pri)" style:width={widths.available}></i>
</div>
