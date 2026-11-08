<script lang="ts">
	import type { GatedSurface, LockPanel } from "$contract/data/disclosure.ts";
	import Icon from "../Icon.svelte";
	import type { IconName } from "../icons.ts";

	/** What a gated surface shows instead of its figures (mockup `lockPanel`): who may see it, and when or how fine. The
	 * surface names itself in `data-surface`; the panel is never an empty table or a 0. */
	let {
		lock,
		surface,
		icon = "lock",
	}: { lock: LockPanel; surface?: GatedSurface; icon?: IconName } = $props();
</script>

<div
	class="grid justify-items-center gap-1.5 rounded-xl border border-dashed border-border bg-card px-3.5 py-[34px] text-center"
	data-test="lock-panel"
	data-surface={surface}
	data-lock={lock.reason}
>
	<Icon name={icon} class="size-[26px] text-muted-foreground" />
	<h4 class="m-0 text-[14px] font-semibold" data-test="lock-who">{lock.who}</h4>
	<div class="text-muted-foreground" data-test="lock-when">{lock.when}</div>
</div>
