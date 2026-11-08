<script lang="ts">
	import { Input } from "$lib/components/ui/input/index.ts";
	import { NativeSelect } from "$lib/components/ui/native-select/index.ts";
	import { useApp } from "../context.ts";
	import { currencySymbol, formatMoney } from "../money.ts";
	import { errorText, field as fieldClass, link, muted } from "../panes/styles.ts";
	import Field from "./Field.svelte";
	import ModalFrame from "./ModalFrame.svelte";
	import type { ModalContext } from "./modal-context.ts";
	import { Submitter } from "./modal-submit.svelte.ts";
	import { capitalized, refundedOf } from "./members-model.ts";
	import { refundPayment } from "./members-writes.ts";
	import NoteField from "./NoteField.svelte";

	/** "Refund a payment…" (brief C1 `refunds`): a payment, an amount up to what is left, the amount typed again to
	 * confirm, and a note. The preview says what the refund does and what would remain, or the problem. */
	let { context, bookingId }: { context: ModalContext; bookingId: string | null } = $props();
	const app = useApp();
	const submitter = new Submitter(app, () => context);

	const noteLength = 3;
	const majorUnits = (cents: number): string => (cents / 100).toFixed(2);
	// svelte-ignore state_referenced_locally
	const { write, detail, changes, currency } = context;
	const { refundable } = detail;
	const leftOf = (payment: (typeof refundable)[number]): number => payment.amountCents - refundedOf(payment, changes);
	const first =
		refundable.find((payment) => bookingId && payment.bookingId === bookingId) ??
		refundable.find((payment) => leftOf(payment) > 0) ??
		refundable[0];
	let paymentId = $state(first?.paymentIntentId ?? "");
	let amount = $state(first ? majorUnits(leftOf(first)) : "0");
	let typed = $state("");
	let note = $state("");
	const payment = $derived(refundable.find(({ paymentIntentId }) => paymentIntentId === paymentId));
	const money = (cents: number): string => formatMoney(cents, currency);
	const cents = $derived(Math.round((Number.parseFloat(amount) || 0) * 100));
	const refunded = $derived(payment ? refundedOf(payment, changes) : 0);
	const left = $derived(payment ? payment.amountCents - refunded : 0);
	const whole = $derived(cents === left);
	const matches = $derived((Number.parseFloat(typed) || 0).toFixed(2) === majorUnits(cents));
	const problem = $derived(
		!payment
			? "This member has no payments to refund."
			: left <= 0
				? `Nothing left to refund: ${money(refunded)} of ${money(payment.amountCents)} was already refunded.`
				: cents <= 0
					? "Enter an amount above 0."
					: cents > left
						? `Only ${money(left)} is left to refund on this payment (${money(refunded)} already refunded, pending refunds included).`
						: null,
	);
	const paymentOptions = $derived(
		refundable.map((candidate) => {
			const already = refundedOf(candidate, changes);
			return {
				value: candidate.paymentIntentId,
				label: `${candidate.description} · ${money(candidate.amountCents)} · ${
					already > 0 ? `refunded ${money(already)}, ${money(leftOf(candidate))} left` : "not refunded"
				}`,
			};
		}),
	);
	const pick = (id: string): void => {
		paymentId = id;
		const chosen = refundable.find(({ paymentIntentId }) => paymentIntentId === id);
		if (chosen) amount = majorUnits(leftOf(chosen));
	};
</script>

<ModalFrame
	returnTo={context.returnTo}
	subtitle={`${write.person.name} · ${write.person.id}`}
	confirm={{
		label: "Refund in Stripe",
		tone: "primary",
		disabled: problem !== null || !matches || note.trim().length < noteLength,
		onConfirm: () => {
			if (payment)
				submitter.run((withWriter) =>
					refundPayment(withWriter, payment, { amountCents: cents, whole, note: note.trim() }),
				);
		},
	}}
	busy={submitter.busy}
	onCancel={context.onCancel}
>
	{#snippet heading()}Refund a payment · {write.schoolName}{/snippet}
	{#snippet preview()}
		{#if problem === null}
			Stripe refunds <b>{money(cents)}</b>.
			{#if payment?.kind === "booking"}
				{#if whole}Booking <span class="font-mono">{payment.bookingId}</span> is cancelled and the place is freed.{:else}The booking stays.{/if}
			{:else if payment?.kind === "gift"}
				{whole ? "The gift code is disabled if it has not been redeemed." : "The gift code stays valid."}
			{:else if whole}
				{capitalized(write.unit.other)} from that invoice are taken back when Stripe confirms, never below zero.
			{:else}
				A <b>partial refund changes no {write.unit.other}</b>.
			{/if}
			<div class={muted}>{money(refunded)} already refunded · {money(left - cents)} would remain.</div>
		{:else}
			<b class={errorText}>{problem}</b>
		{/if}
	{/snippet}
	<Field field="payment">
		{#snippet label()}Payment{/snippet}
		{#snippet children(id)}
			<NativeSelect {id} data-test="modal-field" data-field="payment" value={paymentId} options={paymentOptions} oninput={(event) => pick(event.currentTarget.value)} />
		{/snippet}
	</Field>
	<Field field="amount">
		{#snippet label()}Amount ({currencySymbol(currency)}, up to what is left){" "}<button
				type="button"
				class={[link, "ml-1"]}
				data-test="modal-fill-rest"
				onclick={() => (amount = majorUnits(left))}>Refund the rest</button
			>{/snippet}
		{#snippet children(id)}
			<Input {id} type="number" step="0.01" class={fieldClass} data-test="modal-field" data-field="amount" defaultValue={first ? majorUnits(leftOf(first)) : "0"} value={amount} oninput={(event) => (amount = event.currentTarget.value)} />
		{/snippet}
	</Field>
	<Field field="typed">
		{#snippet label()}Type the refund amount to confirm{/snippet}
		{#snippet children(id)}
			<Input {id} type="text" autocomplete="off" class={fieldClass} data-test="modal-field" data-field="typed" value={typed} oninput={(event) => (typed = event.currentTarget.value)} />
		{/snippet}
	</Field>
	<NoteField onInput={(next) => (note = next)} />
</ModalFrame>
