<script lang="ts">
	import type { Snippet } from "svelte";
	import * as Dialog from "$lib/components/ui/dialog/index.ts";

	/** The one modal of the Bookings and Members panes (mockup `#md`) as a shadcn-svelte dialog: a title and the
	 * dialog's own body. Escape and a click on the backdrop close it unless it is busy (a write is on its way); an
	 * Escape inside is the dialog's alone (the drawer behind it stays open); Tab stays inside; focus starts on the
	 * body's `data-autofocus` control, else its first control, and returns to the control that opened it (or to
	 * `returnTo`, which the pane gives when the opener has gone). The hooks are the golden files' names: `dialog` and
	 * `dialog-title` on Bookings, `modal` and `modal-title` on Members. */
	let {
		heading,
		hooks = "dialog",
		busy = false,
		onClose,
		returnTo,
		children,
	}: {
		heading: Snippet;
		hooks?: "dialog" | "modal";
		busy?: boolean;
		onClose: () => void;
		returnTo?: (() => HTMLElement | null) | undefined;
		children: Snippet;
	} = $props();

	const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
	let content = $state<HTMLElement | null>(null);
	const titleHooks = { dialog: "dialog-title", modal: "modal-title" } as const;
	const behavior = $derived(busy ? "ignore" : "close");
</script>

<Dialog.Root
	open
	onOpenChange={(open) => {
		if (!open) onClose();
	}}
>
		<Dialog.Content
			bind:ref={content}
			data-test={hooks}
			escapeKeydownBehavior={behavior}
			interactOutsideBehavior={behavior}
			onOpenAutoFocus={(event) => {
				event.preventDefault();
				const first =
					content?.querySelector<HTMLElement>("[data-autofocus]") ??
					content?.querySelector<HTMLElement>("input, select, textarea, button:not([disabled])");
				first?.focus({ preventScroll: true });
			}}
			onCloseAutoFocus={(event) => {
				event.preventDefault();
				const target = returnTo?.() ?? opener;
				if (target?.isConnected) target.focus();
			}}
		>
			<Dialog.Title data-test={titleHooks[hooks]}>{@render heading()}</Dialog.Title>
			{@render children()}
		</Dialog.Content>
</Dialog.Root>
