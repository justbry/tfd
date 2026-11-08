<script lang="ts">
	import { onDestroy } from "svelte";
	import type { MemberBooking } from "$contract/data/members.ts";
	import { Button } from "$lib/components/ui/button/index.ts";
	import { useApp } from "../context.ts";
	import PaneIcon from "../PaneIcon.svelte";
	import { muted } from "../panes/styles.ts";
	import ModalFrame from "./ModalFrame.svelte";
	import type { ModalContext } from "./modal-context.ts";
	import { Submitter } from "./modal-submit.svelte.ts";
	import { countOf, formatWallTime, pendingBookingIds } from "./members-model.ts";
	import { releasable, releaseHold } from "./members-writes.ts";

	/** The release picker (mockup `kReleasePick`). A release that needs no second modal runs from the option, which
	 * waits while the call is on its way; one inside its cutoff goes on to the Release hold modal. */
	let { context, onPick }: { context: ModalContext; onPick: (booking: MemberBooking) => void } = $props();
	const app = useApp();
	const submitter = new Submitter(app, () => context);
	onDestroy(() => submitter.cancel());
	let waiting = $state<string | null>(null);
	// svelte-ignore state_referenced_locally
	const { write } = context;
	const bookings = $derived(releasable(context.detail, write.person, pendingBookingIds(context.changes)));
</script>

<ModalFrame
	subtitle={`${write.person.name} · ${write.person.id}. Pick the booking whose hold to release.`}
	busy={submitter.busy}
	onCancel={context.onCancel}
>
	{#snippet heading()}<PaneIcon name="unlock" class="mr-1 inline" /> Release a booking · {write.schoolName}{/snippet}
	<div class="mt-2.5 grid gap-1.5">
		{#each bookings as booking (booking.id)}
			<Button
				variant="tool"
				size="tool"
				class="justify-between"
				data-test="release-option"
				data-booking={booking.id}
				disabled={submitter.busy}
				aria-busy={submitter.busy && waiting === booking.id ? "true" : undefined}
				onclick={() => {
					if (context.insideCutoff(booking) && write.rules.lateCancel === "spend") {
						onPick(booking);
						return;
					}
					waiting = booking.id;
					submitter.run((withWriter) =>
						releaseHold(withWriter, booking, {
							waive: false,
							inside: context.insideCutoff(booking),
							quick: true,
						}),
					);
				}}
			>
				<span>{booking.service} · {formatWallTime(booking.startsAt)}</span>
				<span class={muted}>{countOf(booking.creditsHeld, write.unit)} held</span>
			</Button>
		{/each}
	</div>
</ModalFrame>
