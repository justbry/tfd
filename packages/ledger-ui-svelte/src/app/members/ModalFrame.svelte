<script lang="ts">
	import type { Snippet } from "svelte";
	import { Button } from "$lib/components/ui/button/index.ts";
	import AppDialog from "../panes/AppDialog.svelte";
	import PaneIcon from "../PaneIcon.svelte";
	import type { PaneIconName } from "../pane-icons.ts";
	import { modalFooter, muted, preview as previewClass } from "../panes/styles.ts";

	/** A Members modal in the shared dialog: a title, the fields, the preview (the dashed box), Cancel and the action.
	 * Escape, the backdrop and Cancel close it unless a write is on its way; focus starts on Cancel. */
	let {
		heading,
		subtitle,
		preview,
		previewHook = "modal-preview",
		confirm,
		cancelLabel = "Cancel",
		busy,
		returnTo,
		onCancel,
		children,
	}: {
		heading: Snippet;
		subtitle?: string | undefined;
		/** The dashed box under the fields (the mockup's `.prev`). */
		preview?: Snippet | undefined;
		/** What `preview` is for the golden file: the role modal's refresh line is the note. */
		previewHook?: "modal-preview" | "modal-note";
		confirm?: {
			label: string;
			tone: "primary" | "destructive" | "plain";
			icon?: PaneIconName;
			disabled: boolean;
			onConfirm: () => void;
		} | undefined;
		cancelLabel?: string;
		busy: boolean;
		returnTo?: (() => HTMLElement | null) | undefined;
		onCancel: () => void;
		children?: Snippet;
	} = $props();
</script>

<AppDialog hooks="modal" {busy} {heading} onClose={onCancel} {returnTo}>
	{#if subtitle !== undefined}
		<div class={muted} data-test="modal-subtitle">{subtitle}</div>
	{/if}
	{@render children?.()}
	{#if preview}
		<div class={previewClass} data-test={previewHook} aria-live="polite">{@render preview()}</div>
	{/if}
	<div class={modalFooter}>
		<Button variant="tool" size="tool" data-test="modal-cancel" data-autofocus onclick={() => !busy && onCancel()}>
			{cancelLabel}
		</Button>
		{#if confirm}
			<Button
				variant={confirm.tone === "primary" ? "primary" : "tool"}
				size="tool"
				class={confirm.tone === "destructive" ? "border-destructive text-destructive" : ""}
				data-test="modal-confirm"
				disabled={confirm.disabled || busy}
				aria-busy={busy ? "true" : undefined}
				onclick={confirm.onConfirm}
			>
				{#if confirm.icon}<PaneIcon name={confirm.icon} />{/if}{confirm.label}
			</Button>
		{/if}
	</div>
</AppDialog>
