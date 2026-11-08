<script lang="ts">
	import { onDestroy } from "svelte";
	import { consequenceLine } from "$contract/app/booking-text.ts";
	import type { MemberBooking } from "$contract/data/members.ts";
	import { useApp } from "../context.ts";
	import { checkLabel } from "../panes/styles.ts";
	import ModalFrame from "./ModalFrame.svelte";
	import type { ModalContext } from "./modal-context.ts";
	import { Submitter } from "./modal-submit.svelte.ts";
	import { recordOutcome, releaseHold } from "./members-writes.ts";

	/** "Release hold" inside the cutoff, or "Mark no-show" (mockup `ACT.release`, `ACT.noshow`): the booking line, the
	 * waive box for a release, and the consequence the school's rule gives the held credits. */
	let {
		context,
		booking,
		action,
	}: { context: ModalContext; booking: MemberBooking; action: "release" | "noshow" } = $props();
	const app = useApp();
	const submitter = new Submitter(app, () => context);
	onDestroy(() => submitter.cancel());
	let waive = $state(false);
	// svelte-ignore state_referenced_locally
	const { write } = context;
	const line = $derived(
		consequenceLine({
			action,
			waive: action === "release" && waive,
			rules: write.rules,
			booking: {
				billing: { kind: "held", credits: booking.creditsHeld },
				cutoffMinutes: booking.cutoffMinutes,
			},
			creditUnit: write.unit,
			memberName: write.person.name,
		}),
	);
	// svelte-ignore state_referenced_locally
	const label = action === "release" ? "Release hold" : "Mark no-show";
</script>

<ModalFrame
	subtitle={`${booking.service} · ${booking.id} · ${write.person.name} · ${write.person.id}`}
	confirm={{
		label,
		tone: "primary",
		disabled: false,
		onConfirm: () =>
			submitter.run((withWriter) =>
				action === "release"
					? releaseHold(withWriter, booking, { waive, inside: true, quick: false })
					: recordOutcome(withWriter, booking, "no_show"),
			),
	}}
	busy={submitter.busy}
	onCancel={context.onCancel}
>
	{#snippet heading()}{label} · {write.schoolName}{/snippet}
	{#snippet preview()}
		{#if line}{line.before}{#if line.strong}<b>{line.strong}</b>{/if}{line.after}{/if}
	{/snippet}
	{#if action === "release"}
		<label class={checkLabel} data-test="modal-field-label" data-field="waive">
			<input type="checkbox" data-test="modal-field" data-field="waive" checked={waive} onchange={(event) => (waive = event.currentTarget.checked)} />
			Waive the late-cancel forfeit (return the {write.unit.other})
		</label>
	{/if}
</ModalFrame>
