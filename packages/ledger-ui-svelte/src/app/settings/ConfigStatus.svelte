<script lang="ts">
	import type { ConfigName } from "../../effect/config-client.ts";
	import type { ConfigEditor } from "../config/config-editor.svelte.ts";
	import { hint } from "./styles.ts";

	/** Where a config object stands (checking, verified, problems, saved) and the ETag of the stored copy it was read
	 * at or saved to (the Worker's, so that a save is seen to have landed: nothing is assumed). */
	let {
		editor,
		test,
	}: { editor: ConfigEditor<ConfigName>; test: string } = $props();
	const etag = $derived(editor.base?.etag ?? null);
	/** Nothing is said while nothing has happened: a school with no stored copy and no edit shows no line at all. */
	const idle = $derived(!editor.changed && !editor.saved && editor.problems.length === 0 && !editor.conflict);
</script>

<div aria-live="polite">
	{#if !idle}<div class={hint} data-test="{test}-status">{editor.state.status}</div>{/if}
</div>
{#if etag !== null}
	<div class={hint} data-test="{test}-etag" title={etag}>Stored copy ETag {etag.slice(0, 8)}…</div>
{/if}
