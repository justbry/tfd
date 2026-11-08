<script lang="ts">
	import type { DisclosureChange } from "$contract/data/disclosure.ts";
	import { pinMinimumLength } from "$contract/data/settings.ts";
	import { error as errorText } from "./styles.ts";
	import PaneIcon from "../PaneIcon.svelte";
	import DialogField from "./DialogField.svelte";
	import SettingsDialog from "./SettingsDialog.svelte";
	import { changeNotes } from "./settings-model.ts";
	import { muted } from "./styles.ts";

	/** Save the disclosure change: the family PIN first (mockup `dovSave`). The PIN opens the books and takes the ledger
	 * token that carries the step-up (D22); the save then checks the value (verify) and sends it (PUT). A PIN that is
	 * wrong or locked is said here, in the message table's words. */
	let {
		change,
		problem,
		busy,
		onSave,
		onCancel,
	}: {
		change: Exclude<DisclosureChange, "none" | "public_open">;
		problem: string | null;
		busy: boolean;
		onSave: (pin: string) => void;
		onCancel: () => void;
	} = $props();
	let pin = $state("");
</script>

<SettingsDialog
	{busy}
	confirm={{
		label: "Confirm with PIN",
		icon: "check",
		disabled: pin.length < pinMinimumLength,
		onConfirm: () => onSave(pin),
	}}
	{onCancel}
>
	{#snippet heading()}<PaneIcon name="lock" class="mr-1 inline" /> Save the disclosure change{/snippet}
	<p class={[muted, "my-2"]}>{changeNotes[change]}</p>
	<DialogField label="Your family PIN" name="pin" bind:value={pin} numeric />
	{#if problem}<div class={[errorText, "mt-1"]} role="alert" data-test="dialog-pin-problem">{problem}</div>{/if}
</SettingsDialog>
