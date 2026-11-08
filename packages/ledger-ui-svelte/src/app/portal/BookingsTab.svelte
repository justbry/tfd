<script lang="ts">
	import type { MemberPortal, PortalBooking } from "$contract/data/portal.ts";
	import type { Clock, School } from "$contract/data/types.ts";
	import Icon from "../Icon.svelte";
	import ActionButton from "./ActionButton.svelte";
	import { bookingsOf, bookingTail, hostNames, type Handlers, whenOf } from "./portal-model.ts";
	import { card, item, list, muted, pillClass } from "./styles.ts";

	/** The Bookings tab of the member's view (mockup `mpBk`): the viewed person's bookings not done yet, soonest first, with
	 * what each holds and whether it can still be cancelled free. A booking whose cancel is on its way says so and has no
	 * button. */
	let {
		school,
		clock,
		portal,
		profileId,
		preview,
		pendingBookings,
		handlers,
	}: {
		school: School;
		clock: Clock;
		portal: MemberPortal;
		profileId: string;
		preview: boolean;
		pendingBookings: ReadonlySet<string>;
		handlers: Handlers;
	} = $props();
	const bookings = $derived(bookingsOf(portal, profileId));
	const statusOf = (booking: PortalBooking): "waiting" | "requested" | "started" | "paid" | "cancel" => {
		if (pendingBookings.has(booking.id)) return "waiting";
		if (booking.state === "requested") return "requested";
		if (booking.startsAt < clock.now) return "started";
		return booking.paidCents !== null ? "paid" : "cancel";
	};
</script>

{#if bookings.length === 0}
	<div class="mb-3 rounded-(--mp-rad) border border-(--mp-border) bg-(--mp-card) p-3.5 text-(--mp-muted)" data-test="portal-empty">No upcoming bookings.</div>
{:else}
	<div class={card}>
		<div class={list}>
			{#each bookings as booking (booking.id)}
				{@const status = statusOf(booking)}
				<div class={item} data-test="portal-booking" data-booking={booking.id}>
					<div>
						<b data-test="portal-booking-service">{booking.service}</b>
						<div class={muted}>{whenOf(booking)} · {hostNames(booking)}</div>
						<div class={muted}>{bookingTail(booking, clock, school)}</div>
					</div>
					<div class="flex flex-wrap gap-2">
						{#if status === "waiting"}
							<span class={pillClass("warn")} data-test="portal-booking-status"><Icon name="clock" />waiting to ship</span>
						{:else if status === "requested"}
							<span class={pillClass("neutral")} data-test="portal-booking-status">Waiting for approval</span>
						{:else if status === "started"}
							<span class={pillClass("neutral")} data-test="portal-booking-status">Awaiting confirmation</span>
						{:else if status === "paid"}
							<span class={muted} data-test="portal-booking-status">Contact the school to cancel</span>
						{:else if !school.demo}
							<ActionButton
								action="cancel-booking"
								label="Cancel booking"
								{preview}
								attributes={{ "data-booking": booking.id }}
								onclick={() => handlers.onCancelBooking(booking)}
							/>
						{/if}
					</div>
				</div>
			{/each}
		</div>
	</div>
{/if}
