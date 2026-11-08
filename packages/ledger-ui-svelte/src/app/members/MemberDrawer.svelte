<script lang="ts">
	import { audienceNames } from "$contract/data/disclosure.ts";
	import type { MemberBooking } from "$contract/data/members.ts";
	import { monthAndDay } from "$contract/app/period.ts";
	import type { School } from "$contract/data/types.ts";
	import { Badge } from "$lib/components/ui/badge/index.ts";
	import * as Sheet from "$lib/components/ui/sheet/index.ts";
	import type { UiError } from "../../effect/ui-error.ts";
	import LoadFailed from "../LoadFailed.svelte";
	import { retryFor } from "../panes/retry-for.ts";
	import { schoolMoney } from "../panes/money-text.ts";
	import PaneIcon from "../PaneIcon.svelte";
	import { link, mono, muted, paneBadge } from "../panes/styles.ts";
	import { badgeTones } from "../styles.ts";
	import AttentionBadges from "./AttentionBadges.svelte";
	import BalanceBar from "./BalanceBar.svelte";
	import DrawerBooking from "./DrawerBooking.svelte";
	import DrawerButton from "./DrawerButton.svelte";
	import FinanceChip from "./FinanceChip.svelte";
	import FinanceOnly from "./FinanceOnly.svelte";
	import MemberMenuButton from "./MemberMenuButton.svelte";
	import type { BookingAction, MenuAction, PersonContext } from "./menu-items.ts";
	import {
		amountText,
		attentionOf,
		capabilityReason,
		eventColors,
		eventLabel,
		formatDay,
		formatPaymentDay,
		formatPeriodEnd,
		historyOf,
		paymentsOf,
		project,
		signed,
		standingOf,
	} from "./members-model.ts";
	import RoleChip from "./RoleChip.svelte";

	/** The member drawer (mockup `open`, `openPerson`) as a shadcn-svelte sheet inside the app's frame: who they are
	 * and what they see, the actions, the balance, the upcoming bookings, the payments and the history. Pending writes
	 * show in it before the ledger ships them. When the person's lists could not be read, the lists are the message
	 * (never an empty list or a 0). Escape and the × close it; focus starts on the ×, and returns to the person's row
	 * (the pane does that). */
	let {
		context,
		detailFailure,
		school,
		unit,
		today,
		root,
		top,
		menuOpen,
		trapActive,
		busy,
		onMenu,
		onClose,
		onAction,
		onBookingAction,
		onRetryDetail,
	}: {
		context: PersonContext;
		/** The person's lists failed to read: the drawer says so where they would be. */
		detailFailure: UiError | null;
		school: School;
		unit: { one: string; other: string };
		today: string;
		root: HTMLElement;
		/** Where the top bar ends: the drawer hangs below it, as the mockup's does. */
		top: number;
		/** The ⋯ button is open on this drawer. */
		menuOpen: boolean;
		/** The drawer takes Tab and Escape while nothing above it does. */
		trapActive: boolean;
		/** The booking button whose call is on its way. */
		busy: { bookingId: string; action: BookingAction } | null;
		onMenu: (button: HTMLElement, focusFirst: boolean) => void;
		onClose: () => void;
		onAction: (action: MenuAction) => void;
		onBookingAction: (action: BookingAction, booking: MemberBooking) => void;
		onRetryDetail: () => void;
	} = $props();

	const shortList = 5;
	let showAll = $state(false);
	let closeButton = $state<HTMLElement | null>(null);

	const { person, member, detail, capabilities, viewer, changes } = $derived(context);
	const currency = $derived(school.currency);
	const owner = $derived(capabilities.role === "owner");
	const locked = $derived(viewer.preview);
	const standing = $derived(member ? standingOf(member, changes) : null);
	/** A canceled membership, or one set to end at the period's end, no longer renews. */
	const ended = $derived(standing?.canceled === true || standing?.cancelsAtPeriodEnd === true);
	const reasons = $derived(attentionOf(person, standing?.canceled ?? false, changes));
	const balance = $derived(member?.balances[0]);
	const projection = $derived(balance ? project(balance, person.id, changes) : null);
	const payments = $derived(paymentsOf(detail, person.id, changes, today));
	const history = $derived(historyOf(detail, person.id, changes));
	const hasFinance = $derived(person.role === "owner" || person.financeGrant);
	const expires = $derived(
		standing?.endsToday ? "Today" : balance?.expiresAt ? formatDay(balance.expiresAt, school.timeZone) : null,
	);
	const heading =
		"mt-3.5 mb-2 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] font-semibold tracking-[0.05em] text-muted-foreground uppercase [&_svg]:size-[11px]";
</script>

<Sheet.Root
	open
	onOpenChange={(open) => {
		if (!open) onClose();
	}}
>
	<Sheet.Content
		side="right"
		portalProps={{ to: root }}
		showCloseButton={false}
		trapFocus={trapActive}
		preventScroll={false}
		interactOutsideBehavior="ignore"
		onOpenAutoFocus={(event) => {
			event.preventDefault();
			closeButton?.focus({ preventScroll: true });
		}}
		onCloseAutoFocus={(event) => event.preventDefault()}
		class="absolute z-(--layer-sheet) gap-0 data-[side=right]:w-[68%] max-[600px]:data-[side=right]:w-[94%] overflow-auto border-t border-l border-border bg-card p-3.5 text-[12px] text-foreground shadow-[-12px_0_30px_rgba(0,0,0,0.25)] data-[side=right]:h-auto data-[side=right]:sm:max-w-none"
		style={`top: ${top}px; bottom: 0`}
		overlayClass="hidden"
		data-test="member-drawer"
	>
		<button
			bind:this={closeButton}
			type="button"
			class="absolute top-2.5 right-3.5 cursor-pointer rounded-sm border-0 bg-transparent px-1 text-[18px] leading-none text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
			aria-label="Close"
			data-test="drawer-close"
			onclick={onClose}>×</button
		>
		<div class={[mono, muted]} data-test="drawer-head">{person.id} · {school.name}</div>
		<Sheet.Title class="m-0 mb-0.5 text-[14px] font-semibold" data-test="drawer-name">
			{person.name}{#if person.you}{" "}<span class={muted} data-test="you-tag">(you)</span>{/if}
		</Sheet.Title>
		<Sheet.Description class="sr-only">Member details and actions</Sheet.Description>
		<div>
			<RoleChip role={person.role} />
			<FinanceChip {person} />{" "}
			<Badge class={paneBadge} data-test="member-plan">{member ? `${member.tierName} ×${member.quantity}` : "No plan"}</Badge>
			{#if member}
				{" "}<AttentionBadges {reasons} unitPlural={unit.other} />{" "}
				<Badge class={paneBadge} data-test="renews-badge">
					{ended
						? `ends ${standing?.endsToday ? "today" : formatPeriodEnd(member.currentPeriodEnd, school.timeZone)}`
						: `renews ${formatPeriodEnd(member.currentPeriodEnd, school.timeZone)}`}
				</Badge>
			{/if}
		</div>
		<div class="my-2 mb-3 grid gap-[3px] rounded-xl border border-border bg-secondary px-2.5 py-2">
			{#if person.role === "member"}
				<div data-test="capability-line" data-line="sees">Sees: only themselves and their family</div>
			{:else}
				<div data-test="capability-line" data-line="sees">
					<b>Sees:</b> every member, dashboard, bookings{person.you ? " (you)" : ""}
				</div>
				<div data-test="capability-line" data-line="money">
					<b>Money:</b> {hasFinance ? "yes" : "no"}{person.role === "owner" ? " (owner)" : ""}
				</div>
			{/if}
			<div data-test="capability-line" data-line="audience">
				<b>Audience:</b> {audienceNames[person.audience]} <span class={muted}>· {person.audienceReason}</span>
			</div>
		</div>
		<div class="mt-3 mb-2.5 flex flex-wrap items-start gap-1.5">
			{#if member}
				<DrawerButton icon="eye" label="View as member" reason="" locked={false} tone="primary" hook="drawer-action" action="view-as-member" onclick={() => onAction("view-as-member")} />
				<DrawerButton
					icon="mail"
					label="Send invoice"
					reason={viewer.finance ? capabilityReason(capabilities, "invoice", "drawer") : "Finance only"}
					{locked}
					hook="drawer-action"
					action="invoice"
					onclick={() => onAction("invoice")}
				/>
				<DrawerButton
					icon="sliders"
					label={`Adjust ${unit.other}`}
					reason={viewer.finance ? capabilityReason(capabilities, "adjustCredits", "drawer") : "Finance only"}
					{locked}
					hook="drawer-action"
					action="adjust"
					onclick={() => onAction("adjust")}
				/>
				<DrawerButton icon="undo" label="Refund" reason={capabilityReason(capabilities, "refund", "drawer")} {locked} hook="drawer-action" action="refund" onclick={() => onAction("refund")} />
			{:else}
				<DrawerButton icon="eye" label="View as member" reason="No plan, so there is no member portal to view" locked={false} hook="drawer-action" action="view-as-member" onclick={() => onAction("view-as-member")} />
			{/if}
			<MemberMenuButton name="" expanded={menuOpen} onOpen={onMenu} />
		</div>
		{#if !owner && !member}
			<div class={[muted, "mb-2"]} data-test="drawer-note">Changing roles needs the owner role in {school.name}.</div>
		{/if}
		{#if member && balance && projection}
			<div class="mt-1 mb-3 rounded-xl border border-border px-2.5 py-2" data-test="drawer-balance">
				<b>{projection.reported}</b> available
				{#if projection.available !== projection.reported}
					{" "}<Badge class={[paneBadge, badgeTones.warning]}><PaneIcon name="clock" class="mr-[3px] size-[11px]" />→ {projection.available} after pending</Badge>
				{/if}
				of {balance.granted}
				{#if projection.held > 0}{" "}· <b>{projection.held}</b> held for bookings{/if}
				{expires !== null ? ` · expire ${expires}` : ""}
				{#if balance.rolledOver !== undefined}{` · rollover ${balance.rolledOver}`}{/if}
				<div class="mt-1.5"><BalanceBar {balance} {projection} /></div>
			</div>
		{/if}
		{#if detailFailure}
			<LoadFailed error={detailFailure} onRetry={retryFor(detailFailure, onRetryDetail)} />
		{:else}
			{#if detail.bookings.length > 0}
				<h5 class={heading}><PaneIcon name="clock" /> Upcoming bookings</h5>
				<div>
					{#each detail.bookings as booking (booking.id)}
						<DrawerBooking {booking} {context} {unit} {currency} {busy} onAction={onBookingAction} />
					{/each}
				</div>
			{/if}
			{#if member}
				<div data-test="drawer-payments">
					<h5 class={heading}>
						<PaneIcon name="coin" /> Payments <span class={[muted, "font-normal normal-case"]}>{payments.length} rows</span>{" "}
						<button
							type="button"
							class={[link, "ml-1.5 font-normal normal-case"]}
							data-test="payments-csv"
							disabled={!viewer.finance}
							title={viewer.finance ? "Download this member's payment history as CSV" : "Finance admins only"}
							onclick={() => onAction("csv")}><PaneIcon name="download" class="mr-1" />Download CSV</button
						>
					</h5>
					<table class="w-full border-collapse">
						<tbody>
							{#each showAll ? payments : payments.slice(0, shortList) as payment, index (index)}
								<tr data-test="payment-row">
									<td class={["border-b border-border px-2 py-[7px]", muted]}>{formatPaymentDay(payment.date)}</td>
									<td class="border-b border-border px-2 py-[7px]">{payment.description}</td>
									<td class={["border-b border-border px-2 py-[7px] text-right", payment.amountCents < 0 && viewer.finance && "text-destructive"]}>
										{#if viewer.finance}{schoolMoney(payment.amountCents, currency)}{:else}<FinanceOnly place="person" />{/if}
									</td>
									<td class={["border-b border-border px-2 py-[7px]", muted]}>{payment.status}</td>
								</tr>
							{/each}
						</tbody>
					</table>
					{#if !showAll && payments.length > shortList}
						<button type="button" class={link} data-test="payments-all" onclick={() => (showAll = true)}>Show all payments ({payments.length})</button>
					{/if}
				</div>
			{/if}
			<h5 class={heading}><PaneIcon name="list" /> History</h5>
			<ul class="m-0 mt-2 list-none border-l-2 border-border p-0" data-test="drawer-history">
				{#if history.length === 0}
					<li class={[muted, "pb-2.5 pl-3"]} data-test="history-empty">No activity yet.</li>
				{/if}
				{#each showAll ? history : history.slice(0, shortList) as { event, pending }, index (index)}
					<li
						class={[
							"relative pb-2.5 pl-3 before:absolute before:top-1 before:-left-[5px] before:size-2 before:rounded-full before:content-['']",
							pending
								? "before:border-2 before:border-dashed before:border-warning before:bg-card"
								: "before:bg-(--c)",
						]}
						style:--c={eventColors[event.type] ?? "var(--muted-foreground)"}
						data-test="history-item"
						data-pending={pending ? "true" : undefined}
					>
						<b>{eventLabel(event, unit)}</b>{" "}
						{#if event.credits !== null}
							{signed(event.credits, String(Math.abs(event.credits)))}
						{:else if event.amountCents !== null}
							{#if viewer.finance}{amountText(event.amountCents)}{:else}<FinanceOnly place="person" />{/if}
						{/if}{" "}
						{event.text}
						{#if event.bookingId !== null}{" "}<span class={[mono, muted]}>{event.bookingId}</span>{/if}
						{#if event.promo !== null}{" "}<span class={[mono, muted]}>promo {event.promo}</span>{/if}
						<div class="text-[10px] text-muted-foreground">
							{pending ? "just now · you · ships within 5 min" : `${monthAndDay(event.at.slice(0, 10))} · ${event.source}`}
						</div>
					</li>
				{/each}
				{#if !showAll && history.length > shortList}
					<li class="pb-2.5 pl-3">
						<button type="button" class={link} onclick={() => (showAll = true)}>Show all ({history.length})</button>
					</li>
				{/if}
			</ul>
		{/if}
	</Sheet.Content>
</Sheet.Root>
