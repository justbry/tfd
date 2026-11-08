<script lang="ts">
	import type { Booking } from "$contract/data/bookings.ts";
	import type { Clock, School } from "$contract/data/types.ts";
	import { Badge } from "$lib/components/ui/badge/index.ts";
	import { Button } from "$lib/components/ui/button/index.ts";
	import * as Table from "$lib/components/ui/table/index.ts";
	import { monthAndDay } from "$contract/app/period.ts";
	import { formatMoney } from "../money.ts";
	import PaneIcon from "../PaneIcon.svelte";
	import { cell, mono, muted, paneBadge, smallButtons } from "../panes/styles.ts";
	import { badgeTones } from "../styles.ts";
	import {
		attendeeName,
		exitPreviewTitle,
		dayOf,
		refundTitle,
		rowActionsOf,
		statusBadges,
	} from "./booking-model.ts";

	/** A booking's row (mockup `tr.row`): when, the item and its hosts, the member, billing, status badges and the
	 * actions the booking allows. A booking with a write on its way shows `pending` and offers nothing. */
	let {
		booking,
		withDate,
		pending,
		reminding,
		preview,
		school,
		clock,
		onConfirm,
		onNoShow,
		onRelease,
		onRemind,
		onOpenMember,
	}: {
		booking: Booking;
		/** The overdue group's rows carry their date. */
		withDate: boolean;
		pending: boolean;
		/** The reminder for this booking is on its way. */
		reminding: boolean;
		/** Viewing as someone else: every write is off. */
		preview: boolean;
		school: School;
		clock: Clock;
		onConfirm: (booking: Booking) => void;
		onNoShow: (booking: Booking) => void;
		onRelease: (booking: Booking) => void;
		onRemind: (booking: Booking) => void;
		onOpenMember: (booking: Booking) => void;
	} = $props();

	const badges = $derived(statusBadges(booking, pending, clock));
	const actions = $derived(rowActionsOf(booking, pending, clock));
	const writeOff = $derived(preview ? exitPreviewTitle : undefined);
	const { billing } = $derived(booking);
</script>

<Table.Row class="[&>td]:hover:bg-secondary" data-test="booking-row" data-booking={booking.id}>
	<Table.Cell class={[cell, mono]} data-test="booking-time">
		{withDate ? `${monthAndDay(dayOf(booking))} ` : ""}{booking.startsAt.slice(11)}
	</Table.Cell>
	<Table.Cell class={[cell, "whitespace-normal"]}>
		<b data-test="booking-service">{booking.service}</b>
		<div class={[mono, muted]}>{booking.id} · {booking.hosts.map(({ name }) => name).join(", ")}</div>
	</Table.Cell>
	<Table.Cell class={[cell, "whitespace-normal"]}>
		{#if booking.attendee}
			<button
				type="button"
				class="cursor-pointer border-0 bg-transparent p-0 text-left font-normal text-foreground hover:underline"
				data-test="booking-member"
				onclick={() => onOpenMember(booking)}
			>{attendeeName(booking)}</button>
			<div class={[mono, muted]}>{booking.attendee.key}</div>
		{:else}
			<span data-test="booking-member">{attendeeName(booking)}</span>
		{/if}
	</Table.Cell>
	<Table.Cell class={cell} data-test="booking-billing">
		{#if billing?.kind === "free"}
			<Badge class={paneBadge}>Free</Badge>
		{:else if billing?.kind === "held"}
			<Badge class={paneBadge}><PaneIcon name="clock" class="mr-[3px] size-[11px]" />{billing.credits}
				{billing.credits === 1 ? school.creditUnit.one : school.creditUnit.other} held</Badge>
		{:else if billing?.kind === "paid"}
			<Badge class={paneBadge}><PaneIcon name="coin" class="mr-[3px] size-[11px]" />Paid {formatMoney(billing.amountMinor, billing.currency)}</Badge>
		{/if}
	</Table.Cell>
	<Table.Cell class={[cell, "whitespace-normal"]} data-test="booking-status">
		{#each badges as badge, index (badge.text)}
			{#if index > 0}{" "}{/if}<Badge class={[paneBadge, badge.tone && badgeTones[badge.tone]]}>{badge.text}</Badge>
		{/each}
	</Table.Cell>
	<Table.Cell class={[cell, "text-right"]}>
		<div class={smallButtons}>
			{#if actions === "pending"}
				<Badge class={[paneBadge, badgeTones.warning]}><PaneIcon name="clock" class="mr-[3px] size-[11px]" />waiting to ship</Badge>
			{:else if actions === "remind"}
				<Button
					variant="tool"
					size="tool-small"
					data-test="booking-action"
					data-action="remind"
					data-booking={booking.id}
					disabled={reminding || preview}
					title={reminding ? undefined : writeOff}
					onclick={() => onRemind(booking)}
				><PaneIcon name="mail" />Remind host</Button>
			{:else if actions === "outcome"}
				<Button
					variant="tool"
					size="tool-small"
					data-test="booking-action"
					data-action="confirm"
					data-booking={booking.id}
					disabled={preview}
					title={writeOff}
					onclick={() => onConfirm(booking)}
				><PaneIcon name="check" />Confirm attended</Button>
				<Button
					variant="tool"
					size="tool-small"
					data-test="booking-action"
					data-action="noshow"
					data-booking={booking.id}
					disabled={preview}
					title={writeOff}
					onclick={() => onNoShow(booking)}
				><PaneIcon name="xCircle" />No-show</Button>
			{:else if actions === "refund"}
				<Button
					variant="tool"
					size="tool-small"
					data-test="booking-action"
					data-action="refund"
					data-booking={booking.id}
					disabled
					title={refundTitle}
					aria-describedby={`refund-reason-${booking.id}`}
				><PaneIcon name="undo" />Cancel and refund</Button>
				<span id={`refund-reason-${booking.id}`} class="sr-only">{refundTitle}</span>
			{:else if actions === "release"}
				<Button
					variant="tool"
					size="tool-small"
					data-test="booking-action"
					data-action="release"
					data-booking={booking.id}
					disabled={preview}
					title={writeOff}
					onclick={() => onRelease(booking)}
				><PaneIcon name="unlock" />Release hold</Button>
			{/if}
		</div>
	</Table.Cell>
</Table.Row>
