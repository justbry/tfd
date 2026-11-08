<script lang="ts" generics="Props extends PaneProps">
	import type { Component } from "svelte";
	import { toUiError } from "../effect/ui-error.ts";
	import LoadFailed from "./LoadFailed.svelte";
	import type { PaneProps } from "./shell-model.ts";

	/** A pane loaded the first time it is shown, so that the first page load carries none of it. The chunk starts
	 * loading at once; the pane shows once `props` are in hand (null until then). A chunk that fails to load is the
	 * pane's message, with Retry loading it again, and `onFailed` says so. */
	let {
		load,
		props,
		onFailed,
	}: {
		load: () => Promise<{ default: Component<Props> }>;
		props: Props | null;
		onFailed?: () => void;
	} = $props();

	const start = () => {
		const loading = load();
		loading.catch(() => onFailed?.());
		return loading;
	};
	let loaded = $state.raw(start());
</script>

{#await loaded then { default: Pane }}
	{#if props}<Pane {...props} />{/if}
{:catch failure}
	<LoadFailed error={toUiError(failure)} onRetry={() => (loaded = start())} />
{/await}
