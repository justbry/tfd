<script lang="ts">
	import {
		type Menu,
		type MenuAddon,
		type MenuTier,
		type PlanSummary,
		planLimits,
	} from "$contract/data/plans.ts";
	import { Button } from "$lib/components/ui/button/index.ts";
	import { Badge } from "$lib/components/ui/badge/index.ts";
	import * as Table from "$lib/components/ui/table/index.ts";
	import Icon from "../Icon.svelte";
	import { formatMoney } from "../money.ts";
	import PaneIcon from "../PaneIcon.svelte";
	import { exitPreviewTitle } from "./notify.ts";
	import {
		audienceName,
		grantText,
		type PlanKind,
		type PlansView,
		priceText,
		tierAudience,
		tierCount,
	} from "./plans-menu.ts";
	import {
		bodyCell,
		emptyCell,
		figureCell,
		headCell,
		heading,
		link,
		muted,
		note,
		rowStart,
	} from "./styles.ts";
	import {
		financeOnlyText,
		governanceUpText,
		minimumContributors,
		noMonthlyText,
	} from "./tables-model.ts";
	import Withheld from "./Withheld.svelte";
	import { mockBadge, badgeTones } from "../styles.ts";

	/** Edit mode (mockup `editBody`): the memberships and the packs, each with its Add button, and the note below. A
	 * row opens the plan's editor; the Members count of a finance viewer opens Members filtered to the plan. */
	let {
		view,
		menu,
		tiers,
		summary,
		changedIds,
		removedNames,
		full,
		owner,
		onOpen,
		onMembers,
	}: {
		view: PlansView;
		/** The menu the rows are drawn from: the draft for admins, the live menu for the rest. */
		menu: Menu;
		/** The memberships listed (an audience below admin sees only some). */
		tiers: MenuTier[];
		summary: PlanSummary;
		/** Plans the draft changes (admins see them marked) and names of those it removes. */
		changedIds: ReadonlySet<string>;
		removedNames: string[];
		/** The draft already holds as many memberships or packs as the menu allows. */
		full: Record<PlanKind, boolean>;
		/** The signed-in person owns the school: admins are told that owners publish. */
		owner: boolean;
		onOpen: (kind: PlanKind, id: string | null) => void;
		onMembers: (tierId: string) => void;
	} = $props();

	const them = $derived(removedNames.length === 1 ? "it" : "them");
	const rowClass = (changed: boolean): string =>
		`cursor-pointer border-0 hover:bg-secondary/60 ${changed ? "[&>td:first-child]:shadow-[inset_2px_0_0_var(--warning)]" : ""}`;
	const monthlyOf = (monthlyMinor: number | null): string =>
		monthlyMinor === null ? noMonthlyText : formatMoney(monthlyMinor, menu.currency);
	const addTitle = (kind: PlanKind): string | undefined =>
		view.preview
			? exitPreviewTitle
			: full[kind]
				? `Up to ${planLimits[kind]}${kind === "tiers" ? " memberships" : ""}`
				: undefined;
	const grantsOf = (item: MenuTier | MenuAddon, perUnit: boolean, once: boolean) =>
		item.grants.map((grant) => grantText(menu, grant, { perUnit, once }));
</script>

{#snippet draftBadge()}
	{" "}<Badge class={[mockBadge, badgeTones.warning]} data-test="plan-changed">draft</Badge>
{/snippet}

{#snippet editButton(name: string, open: () => void)}
	<Button
		variant="tool"
		size="tool-small"
		class="px-1.5 py-1"
		data-test="plan-edit"
		aria-label={`Edit ${name}`}
		title="Edit"
		onclick={(event) => {
			event.stopPropagation();
			open();
		}}
	>
		<PaneIcon name="edit" class="mr-0" />
	</Button>
{/snippet}

{#if removedNames.length > 0}
	<div class={note}>
		<Icon name="alert" />
		<span data-test="plan-removed-note"
			>Removed in the draft: {removedNames.join(", ")}. Publishing archives {them} in Stripe. Discard the draft to
			bring {them} back.</span
		>
	</div>
{/if}
<h5 class={heading}>
	<PaneIcon name="layers" /> Memberships{" "}
	<span class={[muted, "font-normal normal-case"]} data-test="plan-count" data-kind="tiers">{menu.tiers.length} of {planLimits.tiers}</span>
</h5>
<Table.Root class="text-[12px]">
	<Table.Header>
		<Table.Row class={rowStart}>
			<Table.Head class={headCell}>Plan</Table.Head>
			<Table.Head class={headCell}>Price</Table.Head>
			<Table.Head class={headCell}>Members get</Table.Head>
			<Table.Head class={[headCell, "text-right"]}>Members</Table.Head>
			<Table.Head class={[headCell, "text-right"]}>Monthly</Table.Head>
			<Table.Head class={headCell}></Table.Head>
		</Table.Row>
	</Table.Header>
	<Table.Body>
		{#each tiers as tier (tier.id)}
			{@const count = tierCount(summary, tier.id)}
			{@const changed = view.admin && changedIds.has(tier.id)}
			{@const audience = tierAudience(tier)}
			{@const few = count.active > 0 && count.active < minimumContributors}
			<Table.Row
				class={rowClass(changed)}
				data-test="plan-row"
				data-plan={tier.id}
				data-kind="tiers"
				data-changed={changed ? "" : undefined}
				onclick={() => onOpen("tiers", tier.id)}
			>
				<Table.Cell class={bodyCell}>
					<b data-test="plan-name">{tier.name}</b>{" "}
					{#if !tier.public}<Badge class={mockBadge} variant="outline" data-test="plan-hidden">Hidden</Badge>{/if}
					{#if audience !== "member"}
						{" "}<Badge
							class={mockBadge}
							variant="outline"
							data-test="plan-audience"
							title="The audience this plan names: what its members see of the school's books"
							><Icon name="scale" class="mr-[3px] size-[11px] align-[-1px]" />Audience: {audienceName[audience]}</Badge
						>
					{/if}
					{#if changed}{@render draftBadge()}{/if}
					<div class={muted} data-test="plan-blurb">{tier.blurb}</div>
				</Table.Cell>
				<Table.Cell class={bodyCell}>
					<span data-test="plan-price">{priceText(menu, tier)}</span>
					{#if tier.quantities}<div class={muted} data-test="plan-sizes">Sold in {tier.quantities.join(", ")}</div>{/if}
				</Table.Cell>
				<Table.Cell class={bodyCell} data-test="plan-grants">
					{#each grantsOf(tier, tier.quantities !== undefined, false) as line, index (index)}
						<span>{#if index > 0}<br />{/if}{line}</span>
					{/each}
				</Table.Cell>
				<Table.Cell class={[bodyCell, figureCell]}>
					{#if view.finance}
						<button
							type="button"
							class={link}
							data-test="plan-members"
							title="Show these members"
							onclick={(event) => {
								event.stopPropagation();
								onMembers(tier.id);
							}}>{count.active}</button
						>
						{#if count.ending > 0}<span class={muted} data-test="plan-ending">{" "}+{count.ending} ending</span>{/if}
					{:else if view.audience === "governance"}
						<span data-test="plan-members">
							{#if few}
								<span
									class="cursor-help border-b border-dotted border-muted-foreground"
									data-test="plan-hid"
									data-hid="approx"
									title={`Rounded to the nearest 10: fewer than ${minimumContributors} members`}>&lt;10</span
								>
							{:else}{count.active}{/if}
						</span>
					{:else}
						<span data-test="plan-members"
							><Withheld text={view.audience === "admin" ? financeOnlyText : governanceUpText} /></span
						>
					{/if}
				</Table.Cell>
				<Table.Cell class={[bodyCell, figureCell]}>
					{#if view.finance}
						<span data-test="plan-monthly">{monthlyOf(count.monthlyMinor)}</span>
					{:else if view.audience === "governance"}
						<span data-test="plan-monthly">
							{#if few}
								<span
									class="cursor-help"
									data-test="plan-hid"
									data-hid="suppressed"
									title={`Hidden: fewer than ${minimumContributors} payers`}>—</span
								>
							{:else}{monthlyOf(count.monthlyMinor)}{/if}
						</span>
					{:else}
						<span data-test="plan-monthly"
							><Withheld text={view.audience === "admin" ? financeOnlyText : governanceUpText} /></span
						>
					{/if}
				</Table.Cell>
				<Table.Cell class={[bodyCell, "text-right"]}>
					{@render editButton(tier.name, () => onOpen("tiers", tier.id))}
				</Table.Cell>
			</Table.Row>
		{:else}
			<Table.Row class={rowStart}>
				<Table.Cell colspan={6} class={[bodyCell, muted, emptyCell]} data-test="plan-empty" data-kind="tiers"
					>No memberships yet.</Table.Cell
				>
			</Table.Row>
		{/each}
	</Table.Body>
</Table.Root>
<div class="mt-2">
	<Button
		variant="tool"
		size="tool-small"
		data-test="plan-add"
		data-kind="tiers"
		title={addTitle("tiers")}
		disabled={view.preview || full.tiers}
		onclick={() => onOpen("tiers", null)}
	>
		<PaneIcon name="plus" />Add membership
	</Button>
</div>
<h5 class={heading}>
	<PaneIcon name="gift" /> Packs and add-ons{" "}
	<span class={[muted, "font-normal normal-case"]} data-test="plan-count" data-kind="addons">{menu.addons.length} of {planLimits.addons}</span>
</h5>
<Table.Root class="text-[12px]">
	<Table.Header>
		<Table.Row class={rowStart}>
			<Table.Head class={headCell}>Name</Table.Head>
			<Table.Head class={headCell}>Price</Table.Head>
			<Table.Head class={headCell}>Gives</Table.Head>
			<Table.Head class={headCell}></Table.Head>
			<Table.Head class={headCell}></Table.Head>
			<Table.Head class={headCell}></Table.Head>
		</Table.Row>
	</Table.Header>
	<Table.Body>
		{#each menu.addons as addon (addon.id)}
			{@const changed = view.admin && changedIds.has(addon.id)}
			<Table.Row
				class={rowClass(changed)}
				data-test="plan-row"
				data-plan={addon.id}
				data-kind="addons"
				data-changed={changed ? "" : undefined}
				onclick={() => onOpen("addons", addon.id)}
			>
				<Table.Cell class={bodyCell}>
					<b data-test="plan-name">{addon.name}</b>
					{#if changed}{@render draftBadge()}{/if}
				</Table.Cell>
				<Table.Cell class={bodyCell}><span data-test="plan-price">{priceText(menu, addon)}</span></Table.Cell>
				<Table.Cell class={bodyCell} data-test="plan-grants">
					{#each grantsOf(addon, false, addon.price.every === "once") as line, index (index)}
						<span>{#if index > 0}<br />{/if}{line}</span>
					{/each}
				</Table.Cell>
				<Table.Cell class={[bodyCell, "text-right"]}></Table.Cell>
				<Table.Cell class={[bodyCell, "text-right"]}></Table.Cell>
				<Table.Cell class={[bodyCell, "text-right"]}>
					{@render editButton(addon.name, () => onOpen("addons", addon.id))}
				</Table.Cell>
			</Table.Row>
		{:else}
			<Table.Row class={rowStart}>
				<Table.Cell colspan={6} class={[bodyCell, muted, emptyCell]} data-test="plan-empty" data-kind="addons"
					>None yet.</Table.Cell
				>
			</Table.Row>
		{/each}
	</Table.Body>
</Table.Root>
<div class="mt-2">
	<Button
		variant="tool"
		size="tool-small"
		data-test="plan-add"
		data-kind="addons"
		title={addTitle("addons")}
		disabled={view.preview || full.addons}
		onclick={() => onOpen("addons", null)}
	>
		<PaneIcon name="plus" />Add pack
	</Button>
</div>
<p class={[muted, "mt-2.5"]} data-test="plan-note">
	<Icon name="info" class="mr-1 inline align-[-2px]" /> A change starts a new version for new purchases. Members keep the
	version they bought.{owner ? "" : " Admins edit the draft; owners publish."}
</p>
