<script lang="ts">
	import type { Snippet } from "svelte";
	import type { PaneIconName } from "../pane-icons.ts";
	import PaneIcon from "../PaneIcon.svelte";
	import { previewTitle } from "./portal-model.ts";
	import { buttonClass } from "./styles.ts";

	/** A write or hand-off button of the member's view (mockup `data-vact`, `data-act`). A preview of another audience turns
	 * every write button off (title "Exit preview to act"); a button that cannot act now says why in its title. */
	let {
		action,
		icon,
		label,
		tone,
		reason,
		preview,
		attributes = {},
		onclick,
	}: {
		action: string;
		icon?: PaneIconName;
		label: string;
		tone?: "p" | "d";
		/** Why the button is off, shown as its title. */
		reason?: string | undefined;
		preview: boolean;
		attributes?: Record<string, string>;
		onclick: () => void;
	} = $props();
</script>

<button
	type="button"
	class={buttonClass(tone === "p" ? "primary" : tone === "d" ? "danger" : "plain")}
	data-test="portal-action"
	data-action={action}
	disabled={preview || Boolean(reason)}
	title={preview ? previewTitle : reason}
	{...attributes}
	{onclick}
>
	{#if icon}<PaneIcon name={icon} />{/if}{label}
</button>
