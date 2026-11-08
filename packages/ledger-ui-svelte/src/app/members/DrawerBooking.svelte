<script lang="ts">
	import { cutoffHours } from "$contract/app/booking-text.ts";
	import type { MemberBooking } from "$contract/data/members.ts";
	import { Badge } from "$lib/components/ui/badge/index.ts";
	import { schoolMoney } from "../panes/money-text.ts";
	import PaneIcon from "../PaneIcon.svelte";
	import { mono, muted, paneBadge } from "../panes/styles.ts";
	import { badgeTones } from "../styles.ts";
	import DrawerButton from "./DrawerButton.svelte";
	import type { BookingAction, PersonContext } from "./menu-items.ts";
	import {
		capabilityReason,
		countOf,
		formatWallTime,
		pendingBookingIds,
	} from "./members-model.ts";

	/** One upcoming booking of the member in the drawer (mockup `.bk`): the item, when, id and hosts, how it is paid,
	 * what it waits for, and the buttons its state allows. The server says which reasons it has (the person's
	 * attention); a booking with a write on its way shows `pending` and "waiting to ship". */
	let {
		booking,
		context,
		unit,
		currency,
		busy,
		onAction,
	}: {
		booking: MemberBooking;
		context: PersonContext;
		unit: { one: string; other: string };
		currency: string | null;
		busy: { bookingId: string; action: BookingAction } | null;
		onAction: (action: BookingAction, booking: MemberBooking) => void;
	} = $props();

	const waiting = $derived(pendingBookingIds(context.changes).has(booking.id));
	const reasons = $derived(context.person.attention.filter((reason) => reason.bookingId === booking.id));
	const needsOutcome = $derived(reasons.some(({ kind }) => kind === "needs_outcome"));
	const inside = $derived(reasons.some(({ kind }) => kind === "inside_cutoff"));
	const locked = $derived(context.viewer.preview);
	const reasonOf = (action: "recordOutcome" | "releaseBooking" | "refund"): string =>
		capabilityReason(context.capabilities, action, "drawer");
</script>

{#snippet button(action: BookingAction, icon: "mail" | "check" | "xCircle" | "undo" | "unlock", label: string, reason: string)}
	<DrawerButton
		{icon}
		{label}
		{reason}
		{locked}
		tone="small"
		hook="booking-action"
		{action}
		bookingId={booking.id}
		busy={busy?.bookingId === booking.id && busy.action === action}
		onclick={() => onAction(action, booking)}
	/>
{/snippet}

<div class="flex items-center justify-between gap-2 border-t border-border py-[7px] first:border-t-0" data-test="drawer-booking">
	<div>
		<b>{booking.service}</b> <span class={muted}>· {formatWallTime(booking.startsAt)}</span>
		<div class={[mono, muted]}>{booking.id} · {booking.hosts.join(", ")}</div>
		<div>
			{#if booking.paidCents !== null}
				<Badge class={paneBadge}><PaneIcon name="coin" class="mr-[3px] size-[11px]" />Paid {schoolMoney(booking.paidCents, currency)}</Badge>
			{:else if booking.creditsHeld > 0}
				<Badge class={paneBadge}><PaneIcon name="clock" class="mr-[3px] size-[11px]" />{countOf(booking.creditsHeld, unit)} held</Badge>
			{:else}
				<Badge class={paneBadge}>Free</Badge>
			{/if}
			{#if waiting}{" "}<Badge class={[paneBadge, badgeTones.warning]}>pending</Badge>{/if}
			{#if booking.state === "requested"}{" "}<Badge class={[paneBadge, badgeTones.warning]}>Waiting for approval</Badge>{/if}
			{#if needsOutcome && !waiting}{" "}<Badge class={[paneBadge, badgeTones.bad]}>Needs outcome</Badge>{/if}
			{#if !needsOutcome && inside && !waiting}
				{" "}<Badge class={[paneBadge, badgeTones.warning]}>Inside {cutoffHours(booking.cutoffMinutes)} cutoff</Badge>
			{/if}
			{#if booking.series !== null}{" "}<Badge class={paneBadge}>{booking.series}</Badge>{/if}
		</div>
	</div>
	<div class="flex flex-wrap justify-end gap-1">
		{#if context.readOnly}
			<!-- A demo school refuses every write: its bookings offer none. -->
		{:else if waiting}
			<Badge class={[paneBadge, badgeTones.warning]}><PaneIcon name="clock" class="mr-[3px] size-[11px]" />waiting to ship</Badge>
		{:else if booking.state === "requested"}
			{@render button("remind", "mail", "Remind host", "")}
		{:else if needsOutcome}
			{@render button("confirm", "check", "Confirm attended", reasonOf("recordOutcome"))}
			{@render button("noshow", "xCircle", "No-show", reasonOf("recordOutcome"))}
		{:else if booking.paidCents !== null}
			{@render button("refund", "undo", "Cancel and refund", reasonOf("refund"))}
		{:else if booking.creditsHeld > 0}
			{@render button("release", "unlock", "Release hold", reasonOf("releaseBooking"))}
		{/if}
	</div>
</div>
