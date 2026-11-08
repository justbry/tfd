<script lang="ts">
	import type { Snippet } from "svelte";
	import Icon from "../Icon.svelte";
	import type { IconName } from "../icons.ts";
	import PaneIcon from "../PaneIcon.svelte";
	import type { PaneIconName } from "../pane-icons.ts";
	import { connectionActions, connectionBody, connectionIcon, connectionRow, muted } from "./styles.ts";

	/** One row of Keys and Connections (mockup `crow`): an icon, a name with its badges, a detail line, and the actions. */
	let {
		icon,
		test,
		attributes,
		detailTest,
		name,
		badges,
		detail,
		actions,
	}: {
		icon: PaneIconName;
		test: string;
		attributes: Record<string, string>;
		detailTest: string;
		name: Snippet;
		badges: Snippet;
		detail: Snippet;
		actions: Snippet;
	} = $props();
</script>

<div class={connectionRow} data-test={test} {...attributes}>
	<span class={connectionIcon}><PaneIcon name={icon} /></span>
	<div class={connectionBody}>
		{@render name()} {@render badges()}
		<div class={muted} data-test={detailTest}>{@render detail()}</div>
	</div>
	<div class={connectionActions}>{@render actions()}</div>
</div>
