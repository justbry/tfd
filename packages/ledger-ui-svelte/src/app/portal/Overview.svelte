<script lang="ts">
	import { count, type Plan } from "$contract/app/portal-format.ts";
	import type { KpiDocument } from "$contract/data/kpi-document.ts";
	import type { MemberPortal, PortalMember } from "$contract/data/portal.ts";
	import type { School } from "$contract/data/types.ts";
	import { messageFor } from "../../effect/messages.ts";
	import type { UiError } from "../../effect/ui-error.ts";
	import { formatMoney } from "../books-shared/books-text.ts";
	import KpiValue from "../books/KpiValue.svelte";
	import Icon from "../Icon.svelte";
	import PaneIcon from "../PaneIcon.svelte";
	import ActionButton from "./ActionButton.svelte";
	import { booksActions, booksCopy, booksPill, dayMonthYear, type Handlers, publishedPeriod } from "./portal-model.ts";
	import { actions, big, buttonClass, card, cardTitle, cardTitleLoose, item, list, muted, note, pillClass, rowBetween } from "./styles.ts";
	import UsageBar from "./UsageBar.svelte";

	/** The Overview tab of the member's view (mockup `mpHome`): the plan with its two actions, the balance of each feature,
	 * the School books card, and the add-ons on sale. The balances and prices are the server's; nothing is summed here. The
	 * books card reads the audience's document: a document that could not be read is said so on the card, never a figure
	 * made up. */
	let {
		school,
		portal,
		viewed,
		plan,
		preview,
		handlers,
		figures,
		figuresFailure,
		onRetryFigures,
		audienceChangedOn,
	}: {
		school: School;
		portal: MemberPortal;
		viewed: PortalMember;
		plan: Plan;
		preview: boolean;
		handlers: Handlers;
		figures: KpiDocument | null;
		figuresFailure: UiError | null;
		onRetryFigures: () => void;
		/** The day a publish gave this member's tier another audience. */
		audienceChangedOn: string | null;
	} = $props();

	const quantityReason = $derived.by(() => {
		if (!viewed.quantityOptions) return "This plan is sold in one size";
		if (plan.ended) return "Resume your membership first";
		return plan.waiting ? "A change is already on its way" : undefined;
	});
	const { audience, guardian } = $derived(portal.books);
	const booksAction = $derived(guardian ? undefined : booksActions[audience]);
	const shown = $derived(figures ? publishedPeriod(figures) : undefined);
	const failure = $derived(figuresFailure ? messageFor(figuresFailure) : null);
</script>

<div class={card} data-test="portal-plan">
	<div class={rowBetween}>
		<div>
			<h4 class={cardTitle} data-test="portal-plan-name">{plan.label}</h4>
			<div class={muted} data-test="portal-plan-price">{formatMoney(plan.priceCents, school.currency)} / {viewed.interval}</div>
		</div>
		<span class={pillClass(plan.ended ? "warn" : "ok")} data-test="portal-plan-status">{plan.ended ? `Ends ${plan.endsOn}` : "Active"}</span>
	</div>
	<div class={[muted, "mt-2"]} data-test="portal-plan-line">
		{plan.ended
			? `Your membership ends on ${plan.endsOn}. You can keep using your ${school.creditUnit.other} until then.`
			: `Renews ${plan.endsOn} · next invoice ${formatMoney(plan.priceCents, school.currency)}`}
	</div>
	{#if plan.scheduled}
		<div class={note} data-test="portal-plan-note"><Icon name="clock" /> Switches to {plan.scheduled} on {plan.endsOn}.</div>
	{/if}
	{#if plan.waiting}
		<div class={note} data-test="portal-plan-note"><Icon name="clock" /> A change is on its way. It can take a few minutes.</div>
	{/if}
	<div class={actions}>
		<ActionButton action="quantity" icon="sliders" label="Change amount" reason={quantityReason} {preview} onclick={handlers.onQuantity} />
		{#if plan.ended}
			<ActionButton
				action="resume"
				icon="undo"
				label="Resume membership"
				tone="p"
				reason={plan.waiting ? "A change is already on its way" : undefined}
				{preview}
				onclick={handlers.onResume}
			/>
		{:else}
			<ActionButton
				action="cancel"
				icon="ban"
				label="Cancel membership"
				tone="d"
				reason={plan.waiting ? "A change is already on its way" : undefined}
				{preview}
				onclick={handlers.onCancel}
			/>
		{/if}
	</div>
</div>

{#each viewed.balances as balance (balance.featureId)}
	<div class={card} data-test="portal-balance">
		<div class={rowBetween}>
			<div>
				<div class={big} data-test="portal-available">{balance.available}</div>
				<div class={muted}>{balance.unit.other} available</div>
			</div>
			<div class={[muted, "text-right"]}>
				{#if balance.held > 0}{balance.held} held for bookings<br />{/if}
				{balance.used} used this cycle
			</div>
		</div>
		<UsageBar {balance} />
		<div class={[muted, "mt-2"]}>
			{plan.ended
				? `No further refresh: your membership ends on ${plan.endsOn}.`
				: `Your allowance refreshes on ${plan.endsOn}.`}
		</div>
	</div>
{/each}

<div class={card} data-test="books-card" data-audience={audience}>
	<div class={rowBetween}>
		<div>
			<h4 class={cardTitle}><PaneIcon name="scale" /> School books</h4>
			{#if audienceChangedOn && !guardian}
				<div class={note} data-audchg><Icon name="info" /> What members can see changed on {dayMonthYear(audienceChangedOn)}.</div>
			{/if}
			<div class={muted} data-test="books-text">
				{guardian
					? `Your guardian (${guardian.name}) sees school books. A child never holds a member or governance audience; the adult on the account does.`
					: booksCopy[audience]}{#if figures && shown}{" "}{shown.label}: <KpiValue document={figures} kpi="gross_collected" period={shown.period} /> collected, <KpiValue document={figures} kpi="net_income" period={shown.period} /> net.{:else if figures}{" "}Nothing is published yet.{/if}
			</div>
			{#if failure}
				<div class={[muted, "mt-1"]} data-test="books-figures-failed" data-kind={figuresFailure?.kind}>
					The figures could not be read: {failure.title}. {failure.doThis}
					{#if failure.action === "retry"}
						<button type="button" class="cursor-pointer border-0 bg-transparent p-0 text-(--mp-pri) underline" data-test="books-figures-retry" onclick={onRetryFigures}>Retry</button>
					{/if}
				</div>
			{/if}
		</div>
		<span class={pillClass("neutral")} data-test="books-pill">{booksPill(audience, guardian !== null)}</span>
	</div>
	{#if booksAction}
		{@const toast = booksAction.toast}
		<div class={actions}>
			<button
				type="button"
				class={buttonClass()}
				data-test="portal-action"
				data-action="books"
				onclick={() => handlers.onBooks(toast)}
			>
				<PaneIcon name={booksAction.icon} />{booksAction.label}
			</button>
		</div>
	{/if}
</div>

{#if portal.addons.length > 0}
	<div class={card} data-test="portal-addons">
		<h4 class={cardTitleLoose}>Need more {school.creditUnit.other}?</h4>
		<div class={list}>
			{#each portal.addons as addon (addon.id)}
				<div class={item}>
					<div>
						<b>{addon.name}</b>
						<div class={muted}>{count(addon.grants, school.creditUnit)} · {formatMoney(addon.priceCents, school.currency)}</div>
					</div>
					<ActionButton action="buy" label="Buy" {preview} attributes={{ "data-addon": addon.id }} onclick={() => handlers.onBuy(addon.id)} />
				</div>
			{/each}
		</div>
	</div>
{/if}
