<script lang="ts">
	import type { Snippet } from "svelte";
	import AppDialog from "../panes/AppDialog.svelte";
	import { modalFooter, muted } from "../panes/styles.ts";

	/** The portal's four dialogs in the shared dialog: a title, a line under it, the body, the buttons. The button marked
	 * `data-autofocus` (Cancel, Done) takes the focus. */
	let {
		heading,
		detail,
		footer,
		onClose,
		children,
	}: {
		heading: Snippet;
		/** The line under the title. */
		detail: string;
		footer: Snippet;
		onClose: () => void;
		children: Snippet;
	} = $props();
</script>

<AppDialog hooks="dialog" {heading} {onClose}>
	<div class={muted}>{detail}</div>
	{@render children()}
	<div class={modalFooter}>{@render footer()}</div>
</AppDialog>
