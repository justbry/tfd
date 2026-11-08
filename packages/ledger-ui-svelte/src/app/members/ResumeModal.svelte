<script lang="ts">
	import { useApp } from "../context.ts";
	import PaneIcon from "../PaneIcon.svelte";
	import { preview as previewClass } from "../panes/styles.ts";
	import ModalFrame from "./ModalFrame.svelte";
	import type { ModalContext } from "./modal-context.ts";
	import { Submitter } from "./modal-submit.svelte.ts";
	import { resumeMembership } from "./members-writes.ts";

	/** "Resume membership…" (undoes a cancel): billing continues at the renewal, nothing is charged today. */
	let { context }: { context: ModalContext } = $props();
	const app = useApp();
	const submitter = new Submitter(app, () => context);
	// svelte-ignore state_referenced_locally
	const { write, member } = context;
</script>

<ModalFrame
	returnTo={context.returnTo}
	subtitle={member ? `${member.tierName} ×${member.quantity}` : undefined}
	cancelLabel="Not now"
	confirm={{
		label: "Resume",
		tone: "primary",
		disabled: member === null,
		onConfirm: () => {
			if (member) submitter.run((withWriter) => resumeMembership(withWriter, member));
		},
	}}
	busy={submitter.busy}
	onCancel={context.onCancel}
>
	{#snippet heading()}<PaneIcon name="undo" class="mr-1 inline" /> Resume membership · {write.person.name}{/snippet}
	<div class={previewClass} data-test="modal-body">
		Billing continues on {write.renewal} as normal. Nothing is charged today.
	</div>
</ModalFrame>
