<script lang="ts">
	import "./promos.css";
	import { formatPeriod } from "$contract/app/period.ts";
	import { formatRoute, type Route, withQuery } from "$contract/app/route.ts";
	import {
		expiresSoon,
		maskCode,
		type Promo,
		type PromoList,
		type PromoType,
		seesIdentities,
	} from "$contract/data/ledger.ts";
	import type { School } from "$contract/data/types.ts";
	import { Badge } from "$lib/components/ui/badge/index.ts";
	import { Button } from "$lib/components/ui/button/index.ts";
	import * as Table from "$lib/components/ui/table/index.ts";
	import { messageFor } from "../../effect/messages.ts";
	import { withRetry } from "../../effect/retry.ts";
	import { read, write } from "../../effect/run.ts";
	import type { UiError } from "../../effect/ui-error.ts";
	import { perform, useApp } from "../context.ts";
	import Icon from "../Icon.svelte";
	import LoadFailed from "../LoadFailed.svelte";
	import PaneIcon from "../PaneIcon.svelte";
	import { notify } from "../plans/notify.ts";
	import { bodyCell, headCell, muted, rowStart, tools } from "../plans/styles.ts";
	import { retryingRead, type RetryingRead } from "../retrying-read.ts";
	import { badgeTones, mockBadge } from "../styles.ts";
	import type { Viewing } from "../viewing.ts";
	import PromoCreated from "./PromoCreated.svelte";
	import PromoForm from "./PromoForm.svelte";
	import {
		copyFailedToast,
		previewTitle,
		smallCount,
		typeLabel,
		valueText,
	} from "./promos-model.ts";

	/** The Promos tab (mockup `codes()`). Owners create codes, owners and admins disable them; what an audience may see of
	 * a code (its uses, who redeemed, the full code) follows its grant. A preview acts on nothing. The list is read through
	 * the Effect layer (a failure is a toast with Retry and the same message here); create and disable are Writer writes with
	 * the Writer's own Idempotency-Key, retried as the same request. Where nothing provides promos yet (the HTTP build:
	 * no route) the pane says so, with the reason on the actions it keeps off, never an empty table or a sample. */
	let {
		route,
		school,
		viewing,
		navigate,
		onRendered,
	}: {
		route: Route;
		school: School;
		viewing: Viewing;
		navigate: (route: Route) => void;
		onRendered: (hash: string) => void;
	} = $props();

	const app = useApp();
	const clock = app.calendar;
	type Dialogs = { step: "form" } | { step: "created"; promo: Promo };

	const audience = $derived(viewing.option.audience);
	const admin = $derived(viewing.option.admin);
	const previewing = $derived(viewing.preview);
	const finance = $derived(seesIdentities(audience));
	const owner = $derived(school.role === "owner");

	let loaded = $state<{ key: string; list: PromoList } | null>(null);
	let failure = $state<{ key: string; error: UiError } | null>(null);
	let busy = $state(false);
	let revealed = $state<string[]>([]);
	let disabling = $state<string | null>(null);
	let dialog = $state<Dialogs | null>(null);
	let reading: RetryingRead | null = null;
	const key = $derived(`${school.id}|${audience}`);
	$effect(() => {
		const asked = { school: school.id, audience, key };
		const run = retryingRead(app, () => read((reader) => reader.promos({ school: asked.school, audience: asked.audience })), {
			value: (list) => {
				loaded = { key: asked.key, list };
				failure = null;
			},
			failure: (error) => {
				failure = { key: asked.key, error };
			},
			busy: (isBusy) => {
				busy = isBusy;
			},
		});
		reading = run;
		run.run();
		return () => {
			run.cancel();
			if (reading === run) reading = null;
		};
	});
	const shown = $derived(loaded?.key === key ? loaded.list : null);
	const failed = $derived(failure?.key === key && !shown ? failure.error : null);
	/** Nothing provides promos (the contract's gap, not a failure to retry): the actions say why they are off. */
	const unavailable = $derived(failed?.kind === "not_available" ? messageFor(failed) : null);
	$effect(() => {
		if (shown || failed) onRendered(formatRoute(route));
	});

	let actions = 0;
	const copy = async (code: string): Promise<void> => {
		try {
			await navigator.clipboard.writeText(code);
			notify(app, "Code copied.");
		} catch {
			notify(app, copyFailedToast);
		}
	};
	const change = (update: (list: PromoList) => PromoList): void => {
		if (loaded) loaded = { ...loaded, list: update(loaded.list) };
	};
	const disable = async (promo: Promo): Promise<void> => {
		disabling = promo.id;
		actions += 1;
		const owner = `promo-disable-${promo.id}`;
		const outcome = await perform(
			app,
			withRetry(
				write((writer) => writer.disablePromo({ school: school.id, promoId: promo.id })),
				{ kind: "write", idempotencyKey: `disable-${promo.id}-${actions}` },
				{ owner },
			),
			{ owner, handlers: { retry: () => void disable(promo) } },
		);
		disabling = null;
		if (!outcome.ok) return;
		const answered = outcome.value;
		change((list) => ({ ...list, promos: list.promos.map((other) => (other.id === answered.id ? answered : other)) }));
		notify(app, `Promo ${maskCode(answered.code)} disabled. It stops working at checkout now.`);
	};
	const create = async (type: PromoType, value: number, expiresOn: string, note: string): Promise<boolean> => {
		actions += 1;
		const who = `promo-create-${school.id}`;
		const outcome = await perform(
			app,
			withRetry(
				write((writer) => writer.createPromo({ school: school.id, type, value, expiresOn, note })),
				{ kind: "write", idempotencyKey: `create-${school.id}-${actions}` },
				{ owner: who },
			),
			{ owner: who, handlers: { retry: () => void create(type, value, expiresOn, note) } },
		);
		if (!outcome.ok) return false;
		const promo = outcome.value;
		change((list) => ({ ...list, promos: [promo, ...list.promos] }));
		dialog = { step: "created", promo };
		return true;
	};
	const openRedemptions = (promo: Promo): void => {
		const yearToDate = { from: `${clock.today.slice(0, 4)}-01-01`, to: clock.today };
		const withMonth = withQuery(route, "month", formatPeriod(yearToDate, clock.today));
		navigate({
			...withQuery(withQuery(withQuery(withMonth, "promo", promo.id), "drill", null), "type", null),
			tab: "ledger",
		});
	};
	const note = $derived(
		!admin
			? "Owners and admins manage promos. Redemption counts are a breakdown (Governance and up); who redeemed is finance and owner only."
			: owner
				? "Owners create promos. Admins can view and disable."
				: "You are an admin here: you can view and disable promos. Owners create them.",
	);
	const newTitle = $derived(
		unavailable
			? `${unavailable.title}: ${unavailable.what}`
			: previewing
				? previewTitle
				: owner
					? undefined
					: "Creating promos needs the owner role in this school",
	);
	const statusTone = (status: Promo["status"]): string =>
		status === "active" ? "border-success text-success" : status === "disabled" ? badgeTones.bad : "";
</script>

{#if shown || unavailable}
	<div class={tools}>
		<span class={muted} data-test="promo-note">{note}</span>
		<span class="flex-1"></span>
		<Button
			variant="primary"
			size="tool"
			data-test="promo-new"
			disabled={!owner || previewing || unavailable !== null}
			title={newTitle}
			onclick={() => (dialog = { step: "form" })}><PaneIcon name="plus" />Create promo</Button
		>
	</div>
{/if}
{#if failed && unavailable}
	<div
		class="mt-2 flex items-start gap-2 rounded-xl border border-dashed border-border bg-card p-3 text-foreground"
		data-test="promo-unavailable"
		data-kind={failed.kind}
	>
		<Icon name="info" class="mt-px text-muted-foreground" />
		<div class="flex flex-col gap-0.5">
			<b>Promos are not available yet</b>
			<span>{unavailable.what}</span>
			<span class={muted}>Creating and disabling promos stays off until they are: {unavailable.doThis}</span>
		</div>
	</div>
{:else if failed}
	<LoadFailed error={failed} onRetry={() => reading?.run()} {busy} />
{:else if shown}
	{@const { promos, currency, unit } = shown}
	<Table.Root class="text-[12px]">
		<Table.Header>
			<Table.Row class={rowStart}>
				<Table.Head class={headCell}>Code</Table.Head>
				<Table.Head class={headCell}>Type</Table.Head>
				<Table.Head class={headCell}>Value</Table.Head>
				<Table.Head class={[headCell, "text-right"]}>Used</Table.Head>
				<Table.Head class={headCell}>Expires</Table.Head>
				<Table.Head class={headCell}>Status</Table.Head>
				<Table.Head class={headCell}></Table.Head>
			</Table.Row>
		</Table.Header>
		<Table.Body>
			{#each promos as promo (promo.id)}
				{@const isShown = revealed.includes(promo.id)}
				{@const isBusy = disabling === promo.id}
				{@const label = isShown ? "Hide code" : "Show code"}
				{@const limit = promo.maxUses === null ? "" : `/${promo.maxUses}`}
				<Table.Row class="border-0 hover:bg-transparent" data-test="promo-row" data-promo={promo.id}>
					<Table.Cell class={bodyCell}>
						<span class="font-mono text-[10.5px]" data-test="promo-code">{isShown ? promo.code : maskCode(promo.code)}</span>{" "}
						<Button
							variant="tool"
							size="tool-small"
							class="px-1.5 py-1"
							data-test="promo-reveal"
							disabled={!admin}
							aria-label={label}
							title={admin ? label : "Owners and admins only"}
							onclick={() => (revealed = isShown ? revealed.filter((id) => id !== promo.id) : [...revealed, promo.id])}
							><PaneIcon name={isShown ? "lock" : "eye"} /></Button
						>{" "}
						<Button
							variant="tool"
							size="tool-small"
							class="px-1.5 py-1"
							data-test="promo-copy"
							disabled={!admin}
							aria-label="Copy code"
							title={admin ? "Copy code" : "Owners and admins only"}
							onclick={() => copy(promo.code)}><PaneIcon name="copy" /></Button
						>
					</Table.Cell>
					<Table.Cell class={bodyCell} data-test="promo-type">{typeLabel(promo.type, unit)}</Table.Cell>
					<Table.Cell class={bodyCell} data-test="promo-value">{valueText(promo, currency, unit)}</Table.Cell>
					{#if typeof promo.used === "object" && "hidden" in promo.used}
						<Table.Cell class={[bodyCell, "text-right tabular-nums"]} data-test="promo-used" data-hid={promo.used.hidden} title="Governance and up see this">
							<span class="inline-flex items-center gap-[3px] text-left text-[10.5px] font-medium whitespace-normal text-muted-foreground"
								><Icon name="lock" class="size-[11px]" />Governance and up see this</span
							>
						</Table.Cell>
					{:else if typeof promo.used === "object"}
						<Table.Cell
							class={[bodyCell, "text-right tabular-nums"]}
							data-test="promo-used"
							title={`Rounded to the nearest 10: fewer than ${smallCount} redeemers`}
						>
							<span class="cursor-help border-b border-dotted border-muted-foreground">{`<${promo.used.lt}`}</span>{limit}
						</Table.Cell>
					{:else}
						<Table.Cell class={[bodyCell, "text-right tabular-nums"]} data-test="promo-used">{`${promo.used}${limit}`}</Table.Cell>
					{/if}
					<Table.Cell class={bodyCell} data-test="promo-expires">
						{promo.expiresOn}{#if expiresSoon(promo, clock)}{" "}<Badge class={[mockBadge, badgeTones.warning]} data-test="promo-soon">soon</Badge>{/if}
					</Table.Cell>
					<Table.Cell class={bodyCell}>
						<Badge class={[mockBadge, statusTone(promo.status)]} variant="outline" data-test="promo-status">{promo.status}</Badge>
					</Table.Cell>
					<Table.Cell class={[bodyCell, "text-right"]}>
						<Button
							variant="tool"
							size="tool-small"
							data-test="promo-redemptions"
							disabled={!finance}
							title={finance ? undefined : "Finance admins only: lists who redeemed"}
							onclick={() => openRedemptions(promo)}><PaneIcon name="list" />Redemptions</Button
						>{" "}
						{#if promo.status === "active"}
							<Button
								variant="tool"
								size="tool-small"
								data-test="promo-disable"
								aria-busy={isBusy}
								disabled={previewing || isBusy}
								title={previewing ? previewTitle : undefined}
								onclick={() => disable(promo)}><PaneIcon name="ban" />Disable</Button
							>
						{/if}
					</Table.Cell>
				</Table.Row>
			{/each}
		</Table.Body>
	</Table.Root>
	{#if promos.length === 0}
		<p class={[muted, "py-6 text-center"]} data-test="promo-empty">No promos yet.</p>
	{/if}
	{#if dialog?.step === "form"}
		<PromoForm
			schoolName={school.name}
			{unit}
			{currency}
			defaultExpires={`${clock.today.slice(0, 4)}-12-31`}
			{create}
			onCancel={() => (dialog = null)}
		/>
	{:else if dialog?.step === "created"}
		<PromoCreated
			schoolName={school.name}
			promo={dialog.promo}
			summary={`${typeLabel(dialog.promo.type, unit)} · ${valueText(dialog.promo, currency, unit)} · expires ${dialog.promo.expiresOn}`}
			{copy}
			onDone={() => (dialog = null)}
		/>
	{/if}
{/if}
