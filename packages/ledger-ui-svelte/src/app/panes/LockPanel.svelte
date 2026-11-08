<script lang="ts">
	import type { LockPanel } from "$contract/data/disclosure.ts";
	import PaneIcon from "../PaneIcon.svelte";
	import type { PaneIconName } from "../pane-icons.ts";

	/** What a gated surface shows instead of its rows (mockup `lockPanel`, `.klock`): who may see it, and when or how
	 * fine. Never an empty table or a 0. The hooks are each golden file's: Bookings `lock-who` and `lock-when`
	 * (the disclosure contract's panels), the Members roster `lock-title` and `lock-text`. */
	let {
		lock,
		icon = "lock",
		hooks = "disclosure",
	}: {
		lock: LockPanel;
		icon?: PaneIconName;
		hooks?: "disclosure" | "roster";
	} = $props();
	const names = $derived(
		hooks === "roster"
			? { heading: "lock-title", line: "lock-text" }
			: { heading: "lock-who", line: "lock-when" },
	);
</script>

<div
	class="grid justify-items-center gap-1.5 rounded-xl border border-dashed border-border bg-card px-3.5 py-[34px] text-center"
	data-test="lock-panel"
	data-lock={lock.reason}
>
	<PaneIcon name={icon} class="size-[26px] text-muted-foreground" />
	<h4 class="m-0 text-[14px]" data-test={names.heading}>{lock.who}</h4>
	<div class="text-muted-foreground" data-test={names.line}>{lock.when}</div>
</div>
