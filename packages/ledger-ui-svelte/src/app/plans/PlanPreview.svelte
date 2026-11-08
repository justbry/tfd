<script lang="ts">
	import type { Promo } from "$contract/data/ledger.ts";
	import type { Menu } from "$contract/data/plans.ts";
	import { Button } from "$lib/components/ui/button/index.ts";
	import { Badge } from "$lib/components/ui/badge/index.ts";
	import { Input } from "$lib/components/ui/input/index.ts";
	import { read } from "../../effect/run.ts";
	import { messageFor } from "../../effect/messages.ts";
	import type { UiError } from "../../effect/ui-error.ts";
	import { useApp } from "../context.ts";
	import Icon from "../Icon.svelte";
	import { formatMoney } from "../money.ts";
	import PaneIcon from "../PaneIcon.svelte";
	import { retryingRead } from "../retrying-read.ts";
	import { mockBadge, badgeTones } from "../styles.ts";
		import {
		grantText,
		type PlanChange,
		type PlanKind,
		slug,
		yearlyAmount,
	} from "./plans-menu.ts";
	import {
		cardModels,
		chooseToast,
		discounted,
		draftEmpty,
		liveEmpty,
		type PreviewSource,
	} from "./preview-model.ts";
	import { chip, heading, muted, note, segment, segmentButton } from "./styles.ts";
	import type { Audience } from "$contract/data/disclosure.ts";
	import { untrack } from "svelte";

	/** The purchase page as members see it (mockup `planPreview`): the live plans or the draft, monthly or yearly, each
	 * plan a card with a button that opens its editor. Choose is a preview only. The sizes picked and the promo code applied
	 * are this view's own. A code is checked against the school's active member promos and takes its percent off the
	 * memberships' prices as shown here: the editor's own draft prices, so this is presentation, not a books figure. The
	 * promos are their own read: where nothing provides them yet (the HTTP build) the field says so and Apply stays off. */
	let {
		schoolId,
		schoolName,
		audience,
		version,
		live,
		draft,
		changes,
		show,
		yearly,
		onShow,
		onBilling,
		onEdit,
		onToast,
	}: {
		schoolId: string;
		schoolName: string;
		audience: Audience;
		/** The live version's number; 0 before the first publish. */
		version: number;
		live: Menu;
		draft: Menu;
		changes: PlanChange[];
		show: PreviewSource;
		yearly: boolean;
		onShow: (show: PreviewSource) => void;
		onBilling: (yearly: boolean) => void;
		onEdit: (kind: PlanKind, id: string) => void;
		onToast: (text: string) => void;
	} = $props();

	const app = useApp();
	let sizes = $state<Record<string, number>>({});
	let typedCode = $state("");
	let appliedCode = $state("");
	let promos = $state<Promo[] | null>(null);
	let promosFailure = $state<UiError | null>(null);
	$effect(() => {
		const asked = { school: schoolId, audience };
		const reading = retryingRead(
			app,
			() => read((reader) => reader.promos(asked)),
			{
				value: (loaded) => {
					promos = loaded.promos;
					promosFailure = null;
				},
				failure: (error) => {
					promosFailure = error;
				},
			},
		);
		untrack(() => {
			promos = null;
		});
		reading.run();
		return () => reading.cancel();
	});
	const promo = $derived(
		promos?.find(
			({ type, status, code }) =>
				type === "member" && status === "active" && code === appliedCode,
		),
	);
	const applyCode = (): void => {
		const code = typedCode.trim().toUpperCase();
		typedCode = code;
		appliedCode = code;
	};

	const showingLive = $derived(show === "live");
	const menu = $derived(showingLive ? live : draft);
	const models = $derived(cardModels(live, menu, showingLive, yearly));
	const anyYearly = $derived(
		menu.tiers.some(
			(tier) => (!showingLive || tier.public) && yearlyAmount(tier) !== undefined,
		),
	);
	const changedIds = $derived(new Set(changes.map(({ id }) => id)));
	const promosReason = $derived(promosFailure ? messageFor(promosFailure) : null);
</script>

{#snippet card(model: (typeof models)["tiers"][number])}
	{@const size = model.quantities ? (sizes[model.id] ?? model.quantities[0] ?? 1) : 1}
	{@const forSale = model.amount !== undefined}
	{@const listPrice = (model.amount ?? 0) * size}
	{@const price = promo && model.kind === "tiers" ? discounted(listPrice, promo.value) : listPrice}
	{@const publishedPrice = model.publishedAmount === undefined ? null : model.publishedAmount * size}
	{@const changed = !showingLive && changedIds.has(model.id)}
	{@const showWas = forSale && changed && publishedPrice !== null && publishedPrice !== listPrice}
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div
		class={[
			"relative flex cursor-pointer flex-col gap-[7px] rounded-[10px] border bg-card p-3 hover:border-ring focus-visible:border-ring focus-visible:outline-0",
			changed ? "border-warning" : "border-border",
			model.hidden && "border-dashed opacity-55",
		]}
		data-test="plan-card"
		data-plan={model.id}
		data-changed={changed ? "" : undefined}
		onclick={() => onEdit(model.kind, model.id)}
	>
		<button
			type="button"
			class="absolute top-2.5 right-2.5 cursor-pointer border-0 bg-transparent p-0 text-muted-foreground hover:text-foreground"
			aria-label={`Edit ${model.name}`}
			onclick={(event) => {
				event.stopPropagation();
				onEdit(model.kind, model.id);
			}}
		>
			<PaneIcon name="edit" />
		</button>
		<div class="pr-5 text-[13px] font-semibold">{model.name}</div>
		<div class="flex min-h-[18px] flex-wrap items-center gap-1.5">
			{#if changed}
				<Badge class={[mockBadge, badgeTones.warning]} data-test="plan-card-flag">{model.inLive ? "Draft change" : "New"}</Badge>
			{/if}{" "}
			{#if model.hidden}<Badge class={mockBadge} variant="outline" data-test="plan-card-flag">Hidden</Badge>{/if}
		</div>
		{#if model.blurb}<div class={muted}>{model.blurb}</div>{/if}
		<div class="text-[20px] font-semibold tabular-nums">
			{#if forSale}
				{#if showWas}
					<s class="mr-1 text-[12px] font-normal text-muted-foreground" data-test="plan-card-was"
						>{formatMoney(publishedPrice ?? 0, menu.currency)}</s
					>
				{/if}
				{#if price !== listPrice}
					<s class="mr-1 text-[12px] font-normal text-muted-foreground">{formatMoney(listPrice, menu.currency)}</s>
				{/if}
				<span data-test="plan-card-price">{formatMoney(price, menu.currency)}</span>
				<small class="ml-[3px] text-[11px] font-normal text-muted-foreground" data-test="plan-card-period"
					>{model.period ? `/ ${model.period}` : "one time"}</small
				>
			{:else}
				<span data-test="plan-card-price">{model.unpriced}</span>
			{/if}
		</div>
		{#if forSale && model.quantities}
			<div class="flex flex-wrap items-center gap-1">
				<small class={muted}>How many</small>
				{#each model.quantities as quantity (quantity)}
					<button
						type="button"
						class={chip}
						aria-pressed={quantity === size}
						data-test="plan-size"
						data-plan={model.id}
						data-size={quantity}
						onclick={(event) => {
							event.stopPropagation();
							sizes = { ...sizes, [model.id]: quantity };
						}}>{quantity}</button
					>
				{/each}
			</div>
		{/if}
		<ul class="m-0 grid list-none gap-[3px] p-0">
			{#each model.grants as grant (`${grant.featureId}:${grant.every}:${grant.amount}`)}
				<li class="flex items-center gap-1.5" data-test="plan-card-grants">
					<PaneIcon name="check" class="text-success" />{grantText(menu, grant, { perUnit: false, once: model.once }, size)}
				</li>
			{/each}
		</ul>
		{#if forSale}
			<Button
				variant="primary"
				size="tool"
				class="mt-auto justify-center"
				data-test="plan-choose"
				onclick={(event) => {
					event.stopPropagation();
					onToast(chooseToast);
				}}>Choose {model.name}</Button
			>
		{/if}
	</div>
{/snippet}

<div class={[muted, "mb-2.5"]} data-test="plan-preview-intro">
	<PaneIcon name="eye" class="mr-1 inline align-[-2px]" /> How the purchase page looks at b4uni.com/join/{slug(schoolName)}. Click a
	plan to edit it.
</div>
<div class="mb-2.5 flex flex-wrap items-center gap-2">
	<div class={segment} role="group" aria-label="Live or draft">
		<button type="button" class={segmentButton} aria-pressed={showingLive} data-test="plan-show" data-show="live" onclick={() => onShow("live")}
			>Live{version > 0 ? ` v${version}` : ""}</button
		>
		<button type="button" class={segmentButton} aria-pressed={!showingLive} data-test="plan-show" data-show="draft" onclick={() => onShow("draft")}
			>Draft{changes.length > 0 ? ` · ${changes.length}` : ""}</button
		>
	</div>
	<div class={segment} role="group" aria-label="Billing period">
		<button type="button" class={segmentButton} aria-pressed={!yearly} data-test="plan-billing" data-billing="month" onclick={() => onBilling(false)}>Monthly</button>
		<button type="button" class={segmentButton} aria-pressed={yearly} disabled={!anyYearly} data-test="plan-billing" data-billing="year" onclick={() => onBilling(true)}>Yearly</button>
	</div>
	<Input
		type="text"
		placeholder="Promo code"
		aria-label="Promo code"
		class="h-auto w-[120px] rounded-md border-border bg-card px-2 py-1 text-[12px] md:text-[12px]"
		bind:value={typedCode}
		onkeydown={(event) => {
			if (event.key !== "Enter") return;
			event.preventDefault();
			applyCode();
		}}
	/>
	<Button
		variant="tool"
		size="tool-small"
		disabled={promosFailure !== null}
		title={promosReason ? `${promosReason.title}. ${promosReason.doThis}` : undefined}
		onclick={applyCode}>Apply</Button
	>
	<output class={["text-[10.5px]", promo ? "text-success" : "text-destructive"]} data-test="plan-promo-message">
		{#if promosFailure && promosReason}
			<span class={muted}><Icon name="info" class="mr-1 inline size-3 align-[-2px]" />Promo codes: {promosReason.title.toLowerCase()}. {promosReason.doThis}</span>
		{:else if appliedCode !== "" && promo}
			<Icon name="check" class="mr-1 inline size-3 align-[-2px]" /> {promo.code}: {promo.value}% off memberships
		{:else if appliedCode !== "" && promos}
			<Icon name="xCircle" class="mr-1 inline size-3 align-[-2px]" /> Not a valid code here
		{/if}
	</output>
</div>
{#if !showingLive && changes.length > 0}
	<div class={note}>
		<Icon name="info" />
		<span data-test="plan-preview-note">Showing the draft. Members see the live version until an owner publishes.</span>
	</div>
{/if}
{#if models.tiers.length > 0 || menu.addons.length > 0}
	{#if models.tiers.length > 0}
		<h5 class={heading}><PaneIcon name="layers" /> Memberships</h5>
		<div class="mb-1.5 grid grid-cols-[repeat(auto-fit,minmax(190px,1fr))] gap-2.5">
			{#each models.tiers as model (model.id)}{@render card(model)}{/each}
		</div>
	{/if}
	{#if menu.addons.length > 0}
		<h5 class={heading}><PaneIcon name="gift" /> Packs and add-ons</h5>
		<div class="mb-1.5 grid grid-cols-[repeat(auto-fit,minmax(190px,1fr))] gap-2.5">
			{#each models.addons as model (model.id)}{@render card(model)}{/each}
		</div>
	{/if}
{:else}
	<div class="rounded-[10px] border border-border bg-card p-2.5 text-muted-foreground" data-test="plan-preview-empty">
		{showingLive ? liveEmpty : draftEmpty}
	</div>
{/if}
