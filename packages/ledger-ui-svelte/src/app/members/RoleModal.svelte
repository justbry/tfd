<script lang="ts">
	import { useApp } from "../context.ts";
	import PaneIcon from "../PaneIcon.svelte";
	import { muted } from "../panes/styles.ts";
	import ModalFrame from "./ModalFrame.svelte";
	import type { ModalContext } from "./modal-context.ts";
	import { Submitter } from "./modal-submit.svelte.ts";
	import { type RoleChange, roleTexts } from "./members-model.ts";
	import { changeRole } from "./members-writes.ts";

	/** Make admin, Remove admin, Remove owner role, Grant or Revoke finance: what it does, and that it applies at the
	 * person's next sign-in refresh (the token lives 5 minutes). */
	let { context, change }: { context: ModalContext; change: RoleChange } = $props();
	const app = useApp();
	const submitter = new Submitter(app, () => context);
	// svelte-ignore state_referenced_locally
	const { write } = context;
	const { person } = write;
	const texts = $derived(roleTexts(change, person, write.schoolName));
</script>

<ModalFrame
	returnTo={context.returnTo}
	previewHook="modal-note"
	confirm={{
		label: "Confirm",
		tone: "primary",
		disabled: false,
		onConfirm: () => submitter.run((withWriter) => changeRole(withWriter, change)),
	}}
	busy={submitter.busy}
	onCancel={context.onCancel}
>
	{#snippet heading()}<PaneIcon name="key" class="mr-1 inline" /> {texts.title}{/snippet}
	{#snippet preview()}
		<PaneIcon name="clock" class="mr-1 inline" /> This applies at {person.name}'s next sign-in refresh. Their access token lasts 5 minutes, so it can take up to 5 minutes to show.
	{/snippet}
	<p class={[muted, "mt-2.5 mb-0"]} data-test="modal-body">{texts.body}</p>
</ModalFrame>
