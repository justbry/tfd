<script lang="ts">
	import type { LockPanel } from "$contract/data/disclosure.ts";
	import BooksIcon from "./BooksIcon.svelte";

	/** What a books surface shows instead of its rows (mockup `lockPanel`, `.klock`): who may see it, and why. The
	 * books panes' golden hooks are `lock-title` and `lock-body`. Never an empty table or a 0. */
	let { lock }: { lock: LockPanel } = $props();
</script>

<div
	class="grid justify-items-center gap-1.5 rounded-xl border border-dashed border-border bg-card px-3.5 py-[34px] text-center"
	data-test="lock-panel"
	data-lock={lock.reason}
>
	<BooksIcon name="lock" class="size-[26px] text-muted-foreground" />
	<h4 class="m-0 text-[14px]" data-test="lock-title">{lock.who}</h4>
	<div class="text-muted-foreground" data-test="lock-body">{lock.when}</div>
</div>
