<script lang="ts">
	import { Button } from "$lib/components/ui/button/index.ts";
	import type { ConfigName } from "../../effect/config-client.ts";
	import Icon from "../Icon.svelte";
	import PaneIcon from "../PaneIcon.svelte";
	import { muted } from "../plans/styles.ts";
	import type { ConfigEditor } from "./config-editor.svelte.ts";

	/** A 412 `stale_etag` (S9-plan section 4): someone else changed the stored copy since this one was read. It shows what
	 * saving would change, path by path, and offers Reload; nothing is saved over their change. The hooks are
	 * `<prefix>-conflict`, `-diff` and `-reload`. */
	let { editor, prefix }: { editor: ConfigEditor<ConfigName>; prefix: string } = $props();
</script>

{#if editor.conflict}
	<div class="mt-3 rounded-[10px] border border-warning p-2.5" role="alert" data-test="{prefix}-conflict">
		<b class="text-warning"><Icon name="alert" class="mr-1 inline align-[-2px]" />Someone changed this. Review their change</b>
		<div class={muted}>Saving would change the stored copy like this:</div>
		<ul class="m-0 mt-1 list-none p-0 font-mono text-[10.5px]">
			{#each editor.conflict.diff as entry (entry.path)}
				<li data-test="{prefix}-diff">
					{entry.path}: {JSON.stringify(entry.before) ?? "(none)"} → {JSON.stringify(entry.after) ?? "(none)"}
				</li>
			{:else}
				<li>Nothing differs from your copy, but the stored copy moved.</li>
			{/each}
		</ul>
		<Button variant="tool" size="tool-small" class="mt-1.5" data-test="{prefix}-reload" onclick={() => editor.reload()}>
			<PaneIcon name="undo" />Reload their copy
		</Button>
	</div>
{/if}
