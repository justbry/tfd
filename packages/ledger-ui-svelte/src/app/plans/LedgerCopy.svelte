<script lang="ts">
	import { onDestroy } from "svelte";
	import type { School } from "$contract/data/types.ts";
	import type { PlansDraftConfig } from "$worker-config/types.ts";
	import { Button } from "$lib/components/ui/button/index.ts";
	import { Input } from "$lib/components/ui/input/index.ts";
	import * as Sheet from "$lib/components/ui/sheet/index.ts";
	import { messageFor } from "../../effect/messages.ts";
	import Icon from "../Icon.svelte";
	import LoadFailed from "../LoadFailed.svelte";
	import PaneIcon from "../PaneIcon.svelte";
	import InlineError from "../toasts/InlineError.svelte";
	import type { LedgerCopy } from "./ledger-copy.svelte.ts";
	import { audienceChoice, audienceChoices } from "./drawer-model.ts";
	import { control, error as errorText, footer, heading, hint, muted, selectControl } from "./styles.ts";

	/** The Plans tab's copy in the ledger as a sheet: the `plans-draft` config object, tier by tier in the order members
	 * read them (names, descriptions, on sale, audience; never prices). Problems from the Worker's verify show at their
	 * field and as one summary toast; Save is on only for a verified value over a fresh base. */
	let {
		school,
		root,
		copy,
		onClose,
	}: { school: School; root: HTMLElement; copy: LedgerCopy; onClose: () => void } = $props();

	const ids = $props.id();
	let pin = $state("");
	let pinProblem = $state<string | null>(null);
	let confirming = $state(false);
	let content = $state<HTMLElement | null>(null);

	const problemsAt = (path: string) => copy.problems.filter((problem) => problem.path === path);
	const order = $derived(
		copy.value?.tierOrder.flatMap((id) => {
			const index = copy.value?.tiers.findIndex((tier) => tier.id === id) ?? -1;
			return index < 0 ? [] : [index];
		}) ?? [],
	);
	const fieldId = (path: string): string => `${ids}-${path.replace(/\W+/g, "-")}`;

	// svelte-ignore state_referenced_locally
	copy.onFirstProblem(() => {
		const first = content?.querySelector<HTMLElement>("[aria-invalid=true]");
		first?.focus();
	});
	onDestroy(() => copy.dispose());

	const editTier = (
		index: number,
		update: (tier: PlansDraftConfig["tiers"][number]) => PlansDraftConfig["tiers"][number],
	): void =>
		copy.edit((value) => ({
			...value,
			tiers: value.tiers.map((tier, at) => (at === index ? update(tier) : tier)),
		}));
	const move = (position: number, by: -1 | 1): void =>
		copy.edit((value) => {
			const next = [...value.tierOrder];
			const target = position + by;
			const [moved] = next.splice(position, 1);
			if (moved === undefined) return value;
			next.splice(target, 0, moved);
			return { ...value, tierOrder: next };
		});
	const confirm = async (): Promise<void> => {
		confirming = true;
		pinProblem = await copy.confirm(pin);
		confirming = false;
		if (pinProblem === null) pin = "";
	};
	const status = $derived.by(() => {
		if (copy.saving) return "Saving…";
		if (copy.verifying) return "Checking the copy…";
		if (copy.problems.length > 0)
			return `${copy.problems.length} problem${copy.problems.length === 1 ? "" : "s"}: fix the fields marked`;
		if (copy.conflict) return "Someone changed this since you opened it";
		if (copy.saved) return "Saved to the ledger";
		if (copy.verified) return "Verified: ready to save";
		return copy.changed ? "Checking the copy…" : "No changes yet";
	});
</script>

<Sheet.Root open onOpenChange={(open) => !open && onClose()}>
	<Sheet.Content
		side="right"
		showCloseButton={false}
		portalProps={{ to: root }}
		bind:ref={content}
		class="absolute top-[53px] z-(--layer-sheet) gap-0 overflow-auto border-t border-l border-border bg-card p-3.5 text-[12px] text-foreground shadow-[-12px_0_30px_rgba(0,0,0,0.25)] data-[side=right]:h-auto data-[side=right]:w-[68%] max-[600px]:data-[side=right]:w-[94%] data-[side=right]:sm:max-w-none"
		overlayClass="absolute z-(--layer-sheet) bg-transparent supports-backdrop-filter:backdrop-blur-none"
		data-test="ledger-copy"
	>
		<button
			type="button"
			class="float-right cursor-pointer border-0 bg-transparent text-[18px] text-muted-foreground"
			aria-label="Close"
			data-test="ledger-copy-close"
			onclick={onClose}>×</button
		>
		<Sheet.Title class="m-0 text-[14px] font-semibold"
			><PaneIcon name="layers" class="mr-1 inline align-[-2px]" /> Draft copy in the ledger</Sheet.Title
		>
		<Sheet.Description class={muted}
			>{school.name} · saved as plans-draft: names, descriptions, order and audiences, never prices</Sheet.Description
		>
		{#if copy.phase === "loading"}
			<p class={muted} data-test="ledger-copy-loading">Reading the stored copy…</p>
		{:else if copy.phase === "failed" && copy.failure}
			<LoadFailed error={copy.failure} onRetry={() => copy.retryLoad()} busy={copy.loadBusy} />
		{:else if copy.value}
			<h5 class={heading}><PaneIcon name="layers" /> Memberships in the order members read them</h5>
			{#each order as index, position (copy.value.tiers[index]?.id)}
				{@const tier = copy.value.tiers[index]}
				{#if tier}
					{@const base = `tiers[${index}]`}
					<div class="mt-2 rounded-[10px] border border-border bg-background p-2" data-test="ledger-copy-tier" data-tier={tier.id}>
						<div class="flex items-center gap-1.5">
							<b class="flex-1">{tier.id}</b>
							<Button variant="tool" size="tool-small" class="px-1.5 py-1" aria-label={`Move ${tier.name || tier.id} up`} disabled={position === 0} data-test="ledger-copy-up" onclick={() => move(position, -1)}
								><Icon name="chevronLeft" class="-rotate-90" /></Button
							>
							<Button variant="tool" size="tool-small" class="px-1.5 py-1" aria-label={`Move ${tier.name || tier.id} down`} disabled={position === order.length - 1} data-test="ledger-copy-down" onclick={() => move(position, 1)}
								><Icon name="chevronRight" class="rotate-90" /></Button
							>
						</div>
						<label class="mt-1.5 block text-[10.5px] text-muted-foreground" for={fieldId(`${base}.name`)}>Name</label>
						<Input
							id={fieldId(`${base}.name`)}
							type="text"
							class={control}
							bind:value={() => tier.name, (name) => editTier(index, (before) => ({ ...before, name }))}
							aria-invalid={problemsAt(`${base}.name`).length > 0}
							aria-describedby={fieldId(`${base}.name-problem`)}
							data-test="ledger-copy-field"
							data-field="name"
						/>
						<InlineError id={fieldId(`${base}.name-problem`)} problems={problemsAt(`${base}.name`)} />
						<label class="block text-[10.5px] text-muted-foreground" for={fieldId(`${base}.blurb`)}>Description</label>
						<Input
							id={fieldId(`${base}.blurb`)}
							type="text"
							class={control}
							bind:value={() => tier.blurb, (blurb) => editTier(index, (before) => ({ ...before, blurb }))}
							aria-invalid={problemsAt(`${base}.blurb`).length > 0}
							aria-describedby={fieldId(`${base}.blurb-problem`)}
							data-test="ledger-copy-field"
							data-field="blurb"
						/>
						<InlineError id={fieldId(`${base}.blurb-problem`)} problems={problemsAt(`${base}.blurb`)} />
						<div class="flex flex-wrap items-center gap-3">
							<label class="flex items-center gap-1.5 text-[11.5px]">
								<input
									type="checkbox"
									checked={tier.public}
									data-test="ledger-copy-field"
									data-field="public"
									onchange={(event) => editTier(index, (before) => ({ ...before, public: event.currentTarget.checked }))}
								/> On sale (public)
							</label>
							<label class="flex items-center gap-1.5 text-[11.5px]" for={fieldId(`${base}.audience`)}>
								Audience
								<select
									id={fieldId(`${base}.audience`)}
									class={[selectControl, "w-auto"]}
									aria-invalid={problemsAt(`${base}.audience`).length > 0}
									data-test="ledger-copy-field"
									data-field="audience"
									oninput={(event) => {
										const audience = audienceChoice(event.currentTarget.value);
										editTier(index, ({ audience: _before, ...rest }) =>
											audience === "member" ? rest : { ...rest, audience },
										);
									}}
								>
									{#each audienceChoices as [choice, label] (choice)}
										<option value={choice} selected={choice === (tier.audience ?? "member")}>{label}</option>
									{/each}
								</select>
							</label>
						</div>
						<InlineError id={fieldId(`${base}.audience-problem`)} problems={problemsAt(`${base}.audience`)} />
					</div>
				{/if}
			{/each}
			<InlineError id={fieldId("tierOrder-problem")} problems={copy.problems.filter((problem) => problem.path.startsWith("tierOrder"))} />
			<label class="mt-2.5 flex items-center gap-1.5 text-[11.5px]">
				<input
					type="checkbox"
					checked={copy.value.purchaseLinkShared}
					data-test="ledger-copy-field"
					data-field="purchaseLinkShared"
					onchange={(event) => {
						const shared = event.currentTarget.checked;
						copy.edit((value) => ({ ...value, purchaseLinkShared: shared }));
					}}
				/> The purchase link has been shared
			</label>
			{#if copy.problems.some((problem) => !/^(tiers|tierOrder)/.test(problem.path))}
				<InlineError id={fieldId("other-problems")} problems={copy.problems.filter((problem) => !/^(tiers|tierOrder)/.test(problem.path))} />
			{/if}
			{#if copy.conflict}
				<div class="mt-3 rounded-[10px] border border-warning p-2.5" role="alert" data-test="ledger-copy-conflict">
					<b class="text-warning"><Icon name="alert" class="mr-1 inline align-[-2px]" />Someone changed this. Review their change</b>
					<div class={muted}>Saving would change the stored copy like this:</div>
					<ul class="m-0 mt-1 list-none p-0 font-mono text-[10.5px]">
						{#each copy.conflict.diff as entry (entry.path)}
							<li data-test="ledger-copy-diff">
								{entry.path}: {JSON.stringify(entry.before) ?? "(none)"} → {JSON.stringify(entry.after) ?? "(none)"}
							</li>
						{:else}
							<li>Nothing differs from your copy, but the stored copy moved.</li>
						{/each}
					</ul>
					<Button variant="tool" size="tool-small" class="mt-1.5" data-test="ledger-copy-reload" onclick={() => copy.reload()}>
						<PaneIcon name="undo" />Reload their copy
					</Button>
				</div>
			{/if}
			{#if copy.stepUp}
				<div class="mt-3 rounded-[10px] border border-warning p-2.5" data-test="ledger-copy-step-up">
					<b class="text-warning"><Icon name="lock" class="mr-1 inline align-[-2px]" />Confirm it is you</b>
					<div class={muted}>Saving needs your family PIN from the last 10 minutes.</div>
					<div class="mt-1.5 flex items-center gap-1.5">
						<input
							class={[control, "w-32 rounded-md border border-border bg-card px-2 py-1"]}
							type="password"
							inputmode="numeric"
							maxlength={6}
							autocomplete="off"
							aria-label="Your family PIN"
							aria-invalid={pinProblem !== null}
							data-test="ledger-copy-pin"
							bind:value={pin}
						/>
						<Button variant="primary" size="tool" data-test="ledger-copy-confirm" disabled={pin.length < 4 || confirming} onclick={confirm}>Confirm it is you</Button>
					</div>
					{#if pinProblem}<div class={[errorText, "mt-1"]} role="alert">{pinProblem}</div>{/if}
				</div>
			{/if}
			<div class={hint} aria-live="polite" data-test="ledger-copy-status">{status}</div>
			<div class={footer}>
				<Button variant="tool" size="tool" data-test="ledger-copy-cancel" onclick={onClose}>Close</Button>
				<Button
					variant="primary"
					size="tool"
					data-test="ledger-copy-save"
					title={copy.saveReason ?? undefined}
					disabled={copy.saveReason !== null}
					onclick={() => copy.save()}
				>
					<PaneIcon name="check" />Save to the ledger
				</Button>
			</div>
		{/if}
	</Sheet.Content>
</Sheet.Root>
