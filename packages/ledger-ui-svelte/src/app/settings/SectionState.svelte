<script lang="ts" generics="Name extends ConfigName">
	import type { Snippet } from "svelte";
	import type { ConfigName, ConfigValues } from "../../effect/config-client.ts";
	import { messageFor } from "../../effect/messages.ts";
	import type { ConfigEditor } from "../config/config-editor.svelte.ts";
	import LoadFailed from "../LoadFailed.svelte";
	import NotAvailable from "../plans/NotAvailable.svelte";
	import { retryFor } from "../panes/retry-for.ts";
	import { muted } from "./styles.ts";

	/** One section of the Settings over its config object: while the object is being read, a line; when it could not
	 * be, the message in place (never an empty section or a 0): "not available" where nothing provides it, with the
	 * message table's words and a way to look again, else the failure with Retry where the table has one. Once read,
	 * the section's own content. */
	let {
		editor,
		reading,
		test,
		children,
	}: {
		editor: ConfigEditor<Name>;
		/** What is being read, for the line: "the school's settings". */
		reading: string;
		test: string;
		children: Snippet<[ConfigValues[Name]]>;
	} = $props();
	const failure = $derived(editor.failure);
	const message = $derived(failure ? messageFor(failure) : null);
</script>

{#if editor.phase === "ready" && editor.value}
	{@render children(editor.value)}
{:else if editor.phase === "failed" && failure && message}
	{#if failure.kind === "not_available"}
		<NotAvailable
			title={message.title}
			what={`The ledger has no ${reading} to show yet. ${message.what}`}
			doThis={message.doThis}
			onCheck={() => editor.retryLoad()}
			busy={editor.loadBusy}
			test="{test}-not-available"
		/>
	{:else}
		<LoadFailed error={failure} onRetry={retryFor(failure, () => editor.retryLoad())} busy={editor.loadBusy} />
	{/if}
{:else}
	<p class={muted} data-test="{test}-loading">Reading {reading}…</p>
{/if}
