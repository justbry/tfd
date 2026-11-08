<script lang="ts">
	import type { Snippet } from "svelte";
	import { Button } from "$lib/components/ui/button/index.ts";
	import { messageFor } from "../../effect/messages.ts";
	import type { UiError } from "../../effect/ui-error.ts";
	import AppDialog from "../panes/AppDialog.svelte";
	import PaneIcon from "../PaneIcon.svelte";
	import type { PaneIconName } from "../pane-icons.ts";
	import { error as errorText, footer } from "./styles.ts";

	/** A dialog over the drawer (mockup `#md`): a title, a body, Cancel and the confirming action. Escape, a click on the
	 * backdrop and Cancel close it, except while the action is on its way; focus starts on the first field, else on the
	 * first button. The action stays busy until the Writer answers; a failure is also said here, in the message table's
	 * words (its toast has Retry). */
	let {
		heading,
		confirm,
		extra,
		cancelable = true,
		busy = false,
		failure = null,
		returnTo,
		onCancel,
		children,
	}: {
		heading: Snippet;
		confirm: {
			label: string;
			icon?: PaneIconName;
			danger?: boolean;
			disabled?: boolean;
			onConfirm: () => void;
		};
		extra?: Snippet;
		/** False for a dialog with only its closing button. */
		cancelable?: boolean;
		busy?: boolean;
		failure?: UiError | null;
		returnTo?: (() => HTMLElement | null) | undefined;
		onCancel: () => void;
		children: Snippet;
	} = $props();
	const message = $derived(failure ? messageFor(failure) : null);
</script>

<AppDialog hooks="dialog" {busy} {heading} onClose={onCancel} {returnTo}>
	{@render children()}
	{#if message}
		<div class={[errorText, "mt-2"]} role="alert" data-test="dialog-failure" data-kind={failure?.kind}>
			<b>{message.title}.</b> {message.what} {message.doThis}
		</div>
	{/if}
	<div class={footer}>
		{@render extra?.()}
		{#if cancelable}
			<Button variant="tool" size="tool" data-test="dialog-cancel" data-autofocus disabled={busy} onclick={onCancel}>Cancel</Button>
		{/if}
		<Button
			variant={confirm.danger ? "tool" : "primary"}
			size="tool"
			class={confirm.danger ? "border-destructive text-destructive" : ""}
			data-test="dialog-confirm"
			data-autofocus={cancelable ? undefined : ""}
			disabled={busy || confirm.disabled}
			aria-busy={busy ? "true" : undefined}
			onclick={confirm.onConfirm}
		>
			{#if confirm.icon}<PaneIcon name={confirm.icon} />{/if}{confirm.label}
		</Button>
	</div>
</AppDialog>
