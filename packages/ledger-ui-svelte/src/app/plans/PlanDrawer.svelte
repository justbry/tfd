<script lang="ts">
		import {
		type Menu,
		type MenuAddon,
		type MenuTier,
		planLimits,
	} from "$contract/data/plans.ts";
	import type { School } from "$contract/data/types.ts";
	import { Button } from "$lib/components/ui/button/index.ts";
	import { Input } from "$lib/components/ui/input/index.ts";
	import * as Sheet from "$lib/components/ui/sheet/index.ts";
	import PaneIcon from "../PaneIcon.svelte";
	import { currencySymbol } from "../money.ts";
	import type { Viewing } from "../viewing.ts";
	import {
		addonOf,
		audienceChoice,
		audienceChoices,
		audienceHint,
		chargeChoice,
		chargeLabels,
		charges,
		formOf,
		grainPlural,
		intervalChoices,
		intervalLabels,
		newGrant,
		sizesOf,
		tierOf,
	} from "./drawer-model.ts";
	import { exitPreviewTitle } from "./notify.ts";
	import {
		monthlyAmount,
		type PlanKind,
		problems,
		slug,
		unitWords,
		withAddon,
		withTier,
	} from "./plans-menu.ts";
	import { control, error, field, fieldLabel, footer, heading, hint, muted, preview as previewBox, selectControl } from "./styles.ts";

	/** The plan editor (mockup `#pe`, `drawPE`, `readPE`, `savePE`): one membership or pack of the draft, as a sheet from
	 * the right inside the app's frame. Save to draft hands back the whole menu with the plan replaced (or added, its id
	 * from its name); it stays off while the menu has problems. */
	let {
		school,
		root,
		menu,
		kind,
		item,
		activeMembers,
		viewing,
		onSave,
		onClose,
	}: {
		school: School;
		/** The app's frame: the drawer is drawn inside it, below the top bar, as the mockup's is. */
		root: HTMLElement;
		/** The draft the plan is part of. */
		menu: Menu;
		kind: PlanKind;
		/** The plan being edited, or null for a new one. */
		item: MenuTier | MenuAddon | null;
		/** The tier's active members, for the subtitle; null for a new plan or a pack. */
		activeMembers: number | null;
		viewing: Viewing;
		onSave: (menu: Menu) => void;
		onClose: () => void;
	} = $props();

	const ids = $props.id();
	// svelte-ignore state_referenced_locally
	let form = $state(formOf(item, kind, menu));
	const tier = $derived(kind === "tiers");
	const preview = $derived(viewing.preview);
	/** The grain a Member's income figures come in (mockup `rule(discOf(s), "member", "gross_collected").every`): the
	 * member audience view's grain, which the disclosure works out from the same rule. */
	const memberGrain = $derived(grainPlural[viewing.disclosure.views.member.grain]);
	const id = $derived(item?.id ?? (slug(form.name) || "new"));
	const edited = $derived(tier ? tierOf(form, id) : addonOf(form, id));
	const candidate = $derived(
		"prices" in edited ? withTier(menu, edited, item?.id ?? null) : withAddon(menu, edited, item?.id ?? null),
	);
	const found = $derived(problems(candidate));
	const symbol = $derived(currencySymbol(menu.currency));
	const unit = $derived(unitWords(menu, form.grants[0]?.featureId ?? ""));
	const sized = $derived(sizesOf(form.quantities) !== undefined);
	const heading_ = $derived(item === null ? `New ${tier ? "membership" : "pack"}` : item.name);
	const packOnce = $derived(!tier && form.charge === "once");
	let nameField = $state<HTMLInputElement | null>(null);
	const grantLabel = "mb-[3px] block text-[10.5px] text-muted-foreground";
</script>

<Sheet.Root open onOpenChange={(open) => !open && onClose()}>
	<Sheet.Content
		side="right"
		showCloseButton={false}
		portalProps={{ to: root }}
		onOpenAutoFocus={(event) => {
			event.preventDefault();
			nameField?.focus();
		}}
		class="absolute z-(--layer-sheet) gap-0 overflow-auto border-t border-l border-border bg-card p-3.5 text-[12px] text-foreground shadow-[-12px_0_30px_rgba(0,0,0,0.25)] data-[side=right]:h-auto data-[side=right]:w-[68%] max-[600px]:data-[side=right]:w-[94%] data-[side=right]:sm:max-w-none"
		style="top: 53px"
		overlayClass="absolute z-(--layer-sheet) bg-transparent supports-backdrop-filter:backdrop-blur-none"
		data-test="plan-drawer"
	>
		<button
			type="button"
			class="absolute top-2.5 right-3.5 cursor-pointer border-0 bg-transparent text-[18px] leading-none text-muted-foreground"
			aria-label="Close"
			data-test="plan-drawer-close"
			onclick={onClose}>×</button
		>
		<Sheet.Title class="m-0 text-[14px] font-semibold" data-test="plan-drawer-title"
			><PaneIcon name={tier ? "layers" : "gift"} class="mr-1 inline align-[-2px]" /> {heading_}</Sheet.Title
		>
		<Sheet.Description class={[muted, "text-[12px]"]} data-test="plan-drawer-sub"
			>{school.name} · editing the draft{activeMembers !== null
				? ` · ${activeMembers} active member${activeMembers === 1 ? "" : "s"}`
				: ""}</Sheet.Description
		>
		<div class={field}>
			<label class={fieldLabel} for={`${ids}-name`}>Name</label>
			<Input id={`${ids}-name`} type="text" class={control} data-test="plan-field" data-field="name" bind:ref={nameField} bind:value={form.name} />
		</div>
		{#if tier}
			<div class={field}>
				<label class={fieldLabel} for={`${ids}-blurb`}>Description</label>
				<Input id={`${ids}-blurb`} type="text" class={control} data-test="plan-field" data-field="blurb" bind:value={form.blurb} />
			</div>
			<div class={field}>
				<label class="flex items-center gap-1.5 text-[11.5px] text-foreground">
					<input
						type="checkbox"
						data-test="plan-field"
						data-field="public"
						checked={form.isPublic}
						onchange={(event) => (form.isPublic = event.currentTarget.checked)}
					/>{" "}
					On sale (public). Hidden plans can't be bought; current members keep them.
				</label>
			</div>
			<div class={field}>
				<label class={fieldLabel} for={`${ids}-audience`}>Audience</label>
				<select
					id={`${ids}-audience`}
					class={selectControl}
					data-test="plan-field"
					data-field="audience"
					oninput={(event) => (form.audience = audienceChoice(event.currentTarget.value))}
				>
					{#each audienceChoices as [choice, label] (choice)}
						<option value={choice} selected={choice === form.audience}>{label}</option>
					{/each}
				</select>
				<div class={hint} data-test="plan-drawer-hint">{audienceHint(memberGrain)}</div>
			</div>
			<div class="mt-1.5 grid grid-cols-2 gap-1.5 max-[420px]:grid-cols-1">
				<div class={field}>
					<label class={fieldLabel} for={`${ids}-month`}>Monthly price ({symbol}{sized ? `, per ${unit.one}` : ""})</label>
					<Input id={`${ids}-month`} type="number" step="0.01" class={control} data-test="plan-field" data-field="month" bind:value={form.month} />
				</div>
				<div class={field}>
					<label class={fieldLabel} for={`${ids}-year`}>Yearly price (optional)</label>
					<Input id={`${ids}-year`} type="number" step="0.01" class={control} data-test="plan-field" data-field="year" bind:value={form.year} />
				</div>
			</div>
			<div class={field}>
				<label class={fieldLabel} for={`${ids}-sizes`}
					>Sold in sizes (optional, for example 1, 2, 4). Prices and amounts are then per {unit.one}.</label
				>
				<Input id={`${ids}-sizes`} type="text" placeholder="One size" class={control} data-test="plan-field" data-field="quantities" bind:value={form.quantities} />
			</div>
		{:else}
			<div class="mt-1.5 grid grid-cols-2 gap-1.5 max-[420px]:grid-cols-1">
				<div class={field}>
					<label class={fieldLabel} for={`${ids}-price`}>Price ({symbol})</label>
					<Input id={`${ids}-price`} type="number" step="0.01" class={control} data-test="plan-field" data-field="price" bind:value={form.price} />
				</div>
				<div class={field}>
					<label class={fieldLabel} for={`${ids}-charge`}>Charged</label>
					<select
						id={`${ids}-charge`}
						class={selectControl}
						data-test="plan-field"
						data-field="every"
						oninput={(event) => (form.charge = chargeChoice(event.currentTarget.value))}
					>
						{#each charges as choice (choice)}
							<option value={choice} selected={choice === form.charge}>{chargeLabels[choice]}</option>
						{/each}
					</select>
				</div>
			</div>
		{/if}
		<h5 class={heading}><PaneIcon name="ticket" /> What members get</h5>
		{#each form.grants as grant, index (index)}
			<div class="mt-1.5 grid grid-cols-[70px_1fr_104px_90px_28px] items-end gap-1.5 max-[420px]:grid-cols-[60px_1fr_28px]" data-test="plan-grant">
				<div>
					<label class={[muted, grantLabel]} for={`${ids}-${index}-amount`}>Amount</label>
					<Input id={`${ids}-${index}-amount`} type="number" class={control} data-test="plan-grant-field" data-field="amount" data-index={index} bind:value={grant.amount} />
				</div>
				<div>
					<label class={[muted, grantLabel]} for={`${ids}-${index}-unit`}
						>{menu.features.find(({ id: featureId }) => featureId === grant.featureId)?.name ?? grant.featureId}</label
					>
					<Input id={`${ids}-${index}-unit`} type="text" disabled class={control} data-test="plan-grant-field" data-field="unit" data-index={index} bind:value={() => unitWords(menu, grant.featureId).other, () => undefined} />
				</div>
				<div>
					<label class={[muted, grantLabel]} for={`${ids}-${index}-every`}>How often</label>
					<select
						id={`${ids}-${index}-every`}
						class={selectControl}
						disabled={packOnce}
						data-test="plan-grant-field"
						data-field="every"
						data-index={index}
						oninput={(event) => (grant.every = event.currentTarget.value === "year" ? "year" : "month")}
					>
						{#if packOnce}
							<option value="once" selected>Once</option>
						{:else}
							{#each intervalChoices as interval (interval)}
								<option value={interval} selected={interval === grant.every}>{intervalLabels[interval]}</option>
							{/each}
						{/if}
					</select>
				</div>
				<div>
					<label class={[muted, grantLabel]} for={`${ids}-${index}-rollover`}>Rolls over (mo)</label>
					<Input id={`${ids}-${index}-rollover`} type="number" min="0" class={control} data-test="plan-grant-field" data-field="rollover" data-index={index} bind:value={grant.rollover} />
				</div>
				<Button
					variant="tool"
					size="tool-small"
					class="px-1.5 py-1"
					aria-label="Remove grant"
					title={preview ? exitPreviewTitle : "Remove"}
					data-test="plan-grant-remove"
					disabled={preview || form.grants.length < 2}
					onclick={() => (form.grants = form.grants.filter((_, at) => at !== index))}
				>
					<PaneIcon name="trash" />
				</Button>
			</div>
		{/each}
		<div class="mt-2">
			<Button
				variant="tool"
				size="tool-small"
				data-test="plan-grant-add"
				title={preview ? exitPreviewTitle : undefined}
				disabled={preview || form.grants.length >= planLimits.grants}
				onclick={() => (form.grants = [...form.grants, newGrant(menu)])}
			>
				<PaneIcon name="plus" />Add another
			</Button>{" "}
			<span class={muted} data-test="plan-drawer-note">A cap on rollover isn't enforced yet, so it isn't offered.</span>
		</div>
		{#if found.length > 0}
			<div class={previewBox}>
				{#each found as problem (problem)}
					<div class={error} data-test="plan-drawer-problem"><PaneIcon name="alert" class="mr-1 inline" /> {problem}</div>
				{/each}
			</div>
		{/if}
		<div class={footer}>
			<Button variant="tool" size="tool" data-test="plan-drawer-cancel" onclick={onClose}>Cancel</Button>
			<Button
				variant="primary"
				size="tool"
				data-test="plan-drawer-save"
				title={preview ? exitPreviewTitle : undefined}
				disabled={preview || found.length > 0}
				onclick={() => onSave(candidate)}
			>
				<PaneIcon name="check" />Save to draft
			</Button>
		</div>
	</Sheet.Content>
</Sheet.Root>
