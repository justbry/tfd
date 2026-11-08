<script lang="ts">
	import { onDestroy } from "svelte";
	import { Badge } from "$lib/components/ui/badge/index.ts";
	import { NativeSelect } from "$lib/components/ui/native-select/index.ts";
	import { useApp } from "../context.ts";
	import LoadFailed from "../LoadFailed.svelte";
	import { formatMoney } from "../money.ts";
	import PaneIcon from "../PaneIcon.svelte";
	import { errorText, muted, paneBadge } from "../panes/styles.ts";
		import Field from "./Field.svelte";
	import ModalFrame from "./ModalFrame.svelte";
	import type { ModalContext } from "./modal-context.ts";
	import { Submitter } from "./modal-submit.svelte.ts";
	import { switchPlan } from "./members-writes.ts";

	/** "Switch plan…" (not built in buzz-school yet): another published plan and, for a plan sold in sizes, an amount;
	 * the preview says what it costs and that it takes effect at the renewal. When the plans could not be read the
	 * modal says so. */
	let { context }: { context: ModalContext } = $props();
	const app = useApp();
	const submitter = new Submitter(app, () => context);
	onDestroy(() => submitter.cancel());
	// svelte-ignore state_referenced_locally
	const { write, member, currency } = context;
	// svelte-ignore state_referenced_locally
	const unreadable = Array.isArray(context.switchTiers) ? null : context.switchTiers;
	// svelte-ignore state_referenced_locally
	const others = (Array.isArray(context.switchTiers) ? context.switchTiers : []).filter(({ id }) => id !== member?.tierId);
	let tierId = $state(others[0]?.id ?? "");
	let quantity = $state(others[0]?.quantities?.[0] ?? 1);
	const tier = $derived(others.find(({ id }) => id === tierId));
	const money = (cents: number): string => formatMoney(cents, currency);
	const chosenTier = (id: string): void => {
		tierId = id;
		quantity = others.find((candidate) => candidate.id === id)?.quantities?.[0] ?? 1;
	};
	const label = $derived(tier ? `${tier.name} ×${quantity}` : "");
	const shown = $derived(tier?.quantities ? `${tier.name} ×${quantity}` : tier?.name);
</script>

<ModalFrame
	subtitle={member ? `${member.tierName} ×${member.quantity} now` : undefined}
	confirm={unreadable
		? undefined
		: {
				label: "Schedule switch",
				tone: "primary",
				disabled: !tier || member === null,
				onConfirm: () => {
					if (tier && member)
						submitter.run((withWriter) =>
							switchPlan(withWriter, member, { tierId: tier.id, label, quantity }),
						);
				},
			}}
	busy={submitter.busy}
	onCancel={context.onCancel}
>
	{#snippet heading()}<PaneIcon name="layers" class="mr-1 inline" /> Switch plan · {write.person.name}{" "}<Badge class={paneBadge}>Admin</Badge>{/snippet}
	{#snippet preview()}
		{#if unreadable}
			<span class={errorText}>The plans could not be read.</span>
		{:else if tier}
			From {write.renewal}: <b>{shown}</b> at <b>{money(tier.monthlyCents * quantity)}</b> / month. It takes effect at the renewal and grants nothing until then.
			<div class={muted}><PaneIcon name="alert" class="mr-1 inline" /> Stripe's member portal doesn't offer plan switches today, so members can't do this themselves.</div>
		{:else}
			<b class={errorText}>There is no other plan to switch to.</b>
		{/if}
	{/snippet}
	{#if unreadable}
		<LoadFailed error={unreadable} />
	{:else}
		<Field field="tier">
			{#snippet label()}New plan{/snippet}
			{#snippet children(id)}
				<NativeSelect {id} data-test="modal-field" data-field="tier" value={tierId} options={others.map((candidate) => ({ value: candidate.id, label: `${candidate.name} · ${money(candidate.monthlyCents)}${candidate.quantities ? ` per ${write.unit.one}` : ""} / month` }))} oninput={(event) => chosenTier(event.currentTarget.value)} />
			{/snippet}
		</Field>
		{#if tier?.quantities}
			<Field field="quantity">
				{#snippet label()}Amount{/snippet}
				{#snippet children(id)}
					<NativeSelect {id} data-test="modal-field" data-field="quantity" value={String(quantity)} options={(tier.quantities ?? []).map((size) => ({ value: size, label: String(size) }))} oninput={(event) => (quantity = Number(event.currentTarget.value))} />
				{/snippet}
			</Field>
		{/if}
	{/if}
</ModalFrame>
