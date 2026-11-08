<script lang="ts">
	import type { Plan } from "$contract/app/portal-format.ts";
	import type { PortalMember } from "$contract/data/portal.ts";
	import { Button } from "$lib/components/ui/button/index.ts";
	import PaneIcon from "../PaneIcon.svelte";
	import { preview as previewClass } from "../panes/styles.ts";
	import PortalDialog from "./PortalDialog.svelte";

	/** Resume membership (mockup `vAct('resume')`). */
	let {
		viewed,
		plan,
		onClose,
		onConfirm,
	}: { viewed: PortalMember; plan: Plan; onClose: () => void; onConfirm: () => void } = $props();
</script>

<PortalDialog detail={plan.label} {onClose}>
	{#snippet heading()}<PaneIcon name="undo" class="mr-1 inline" /> Resume membership · {viewed.name}{/snippet}
	<div class={previewClass} data-test="dialog-preview">
		Billing continues on {plan.endsOn} as normal. Nothing is charged today.
	</div>
	{#snippet footer()}
		<Button variant="tool" size="tool" data-test="dialog-cancel" data-autofocus onclick={onClose}>Not now</Button>
		<Button variant="primary" size="tool" data-test="dialog-confirm" onclick={onConfirm}>Resume</Button>
	{/snippet}
</PortalDialog>
