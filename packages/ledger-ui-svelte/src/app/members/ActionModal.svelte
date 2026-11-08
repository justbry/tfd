<script lang="ts">
	import type { MemberBooking } from "$contract/data/members.ts";
	import AdjustModal from "./AdjustModal.svelte";
	import AuditModal from "./AuditModal.svelte";
	import CancelModal from "./CancelModal.svelte";
	import InvoiceModal from "./InvoiceModal.svelte";
	import type { Action, ModalContext } from "./modal-context.ts";
	import PickModal from "./PickModal.svelte";
	import RefundModal from "./RefundModal.svelte";
	import ReleaseHoldModal from "./ReleaseHoldModal.svelte";
	import ResumeModal from "./ResumeModal.svelte";
	import RoleModal from "./RoleModal.svelte";
	import SwitchModal from "./SwitchModal.svelte";

	/** The modal for one action on one person. A release or a no-show names the booking it is for. */
	let {
		action,
		context,
		onPick,
	}: {
		action: Action;
		context: ModalContext;
		onPick: (booking: MemberBooking) => void;
	} = $props();
	const bookingOf = (id: string): MemberBooking | undefined =>
		context.detail.bookings.find((booking) => booking.id === id);
</script>

{#if action.kind === "role"}
	<RoleModal {context} change={action.change} />
{:else if action.kind === "adjust"}
	<AdjustModal {context} />
{:else if action.kind === "invoice"}
	<InvoiceModal {context} />
{:else if action.kind === "refund"}
	<RefundModal {context} bookingId={action.bookingId} />
{:else if action.kind === "pick"}
	<PickModal {context} {onPick} />
{:else if action.kind === "switch"}
	<SwitchModal {context} />
{:else if action.kind === "cancel"}
	<CancelModal {context} />
{:else if action.kind === "resume"}
	<ResumeModal {context} />
{:else if action.kind === "audit"}
	<AuditModal {context} />
{:else if action.kind === "release" || action.kind === "noshow"}
	{@const booking = bookingOf(action.bookingId)}
	{#if booking}
		<ReleaseHoldModal {context} {booking} action={action.kind} />
	{/if}
{/if}
