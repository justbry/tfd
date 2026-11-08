<script lang="ts">
	import "./dashboard.css";
	import "../late-icons.ts"; // the icons this pane draws that the first page load does not carry
	import { Effect } from "effect";
	import { onDestroy, untrack } from "svelte";
	import { parsePeriod } from "$contract/app/period.ts";
	import { formatRoute, type Route, withQuery } from "$contract/app/route.ts";
	import { type Audience, audienceNames, audiences } from "$contract/data/disclosure.ts";
	import type { KpiDocument } from "$contract/data/kpi-document.ts";
	import type { Preset, School } from "$contract/data/types.ts";
	import { Badge } from "$lib/components/ui/badge/index.ts";
	import { read } from "../../effect/run.ts";
	import { Toasts } from "../../effect/services.ts";
	import type { UiError } from "../../effect/ui-error.ts";
	import { useApp } from "../context.ts";
	import Icon from "../Icon.svelte";
	import LoadFailed from "../LoadFailed.svelte";
	import { retryingRead } from "../retrying-read.ts";
	import { badgeTones, mockBadge } from "../styles.ts";
	import type { Viewing } from "../viewing.ts";
	import PinLock from "../books/PinLock.svelte";
	import AggregateBody from "./AggregateBody.svelte";
	import {
		type Books,
		creditsName as creditsNameOf,
		dashboardViews,
		featuredScenarios,
		monthParameter,
		namesList,
		noPreset,
		openMonthTitle,
		shortPeriodName,
		snapStripPeriod,
		viewOf,
	} from "./dashboard-model.ts";
	import MonthBody from "./MonthBody.svelte";
	import { caption, chip, segment, segmentButton } from "./styles.ts";

	/** The Dashboard pane (mockup `dashboard()`): Money, Members or Risk for one period of the KPI document of the
	 * audience the route views. Public and Member read their years or quarters, each KPI at its own grain; Governance and
	 * up read months, the live audiences with the open month and its days. Every figure is a document cell written as the
	 * mockup writes it: nothing is summed, compared or recomputed, and a hidden or missing cell is never a 0. The
	 * document is read through the app's Effect layer: a failure is a toast with Retry and the same message here. While
	 * the next document of the same audience loads the one before stays on screen; another audience's never does (it
	 * would show its figures under the new View as banner), and the other held audiences' documents are read right
	 * after the first paint, so that picking another View as row is instant. `onRendered` says when the route's own is
	 * in. */
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
	type Loaded = {
		key: string;
		school: string;
		audience: Audience;
		presets: Preset[];
		document: KpiDocument | undefined;
	};

	const view = $derived(viewOf(route.query.get("view")));
	const audience = $derived(viewing.option.audience);
	const pinLocked = $derived(viewing.view.pin && route.query.get("pin") === "locked");
	const presetAsked = $derived(route.query.get("preset"));
	const keyOf = (schoolId: string, forAudience: Audience, locked: boolean): string =>
		`${schoolId}/${presetAsked}/${forAudience}/${locked}`;
	const key = $derived(keyOf(school.id, audience, pinLocked));

	let loaded = $state<Loaded | null>(null);
	let failure = $state<{ key: string; error: UiError } | null>(null);
	let busy = $state(false);
	/** The documents read so far, by the key that asked for them: going back to a view is instant. */
	const documents = new Map<string, Loaded>();

	/** The pre-reads on their way: the pane leaving lets them go (no toast, no log). */
	const preReads = new Set<AbortController>();
	onDestroy(() => {
		for (const controller of preReads) controller.abort();
	});
	/** The other audiences the viewer holds, read (unlocked) once the route's own document is in. A failed read here
	 * is dropped: picking that row reads it again, with its toast and Retry. */
	const preRead = (asked: { school: string; audience: Audience }, presets: Preset[]): void => {
		const preset = presets.find(({ id }) => id === presetAsked) ?? presets[0];
		const held = untrack(() => viewing.disclosure.viewAs).flatMap((row) =>
			row.held && row.audience !== asked.audience ? [row.audience] : [],
		);
		for (const other of new Set(held)) {
			const otherKey = keyOf(asked.school, other, false);
			if (documents.has(otherKey)) continue;
			const controller = new AbortController();
			preReads.add(controller);
			app.runtime
				.runPromise(
					read((reader) =>
						reader.kpiDocument({
							school: asked.school,
							preset: preset?.id ?? noPreset,
							audience: other,
							pinLocked: false,
						}),
					),
					{ signal: controller.signal },
				)
				.finally(() => preReads.delete(controller))
				.then(
					(document) => {
						if (document && !documents.has(otherKey))
							documents.set(otherKey, {
								key: otherKey,
								school: asked.school,
								audience: other,
								presets,
								document,
							});
					},
					() => undefined,
				);
		}
	};

	let reading: { run: () => Promise<void> } | null = null;
	$effect(() => {
		const asked = { key, school: school.id, preset: presetAsked, audience, pinLocked };
		const known = documents.get(asked.key);
		if (known) {
			loaded = known;
			failure = null;
			return;
		}
		const documentRead = retryingRead(
			app,
			() =>
				Effect.gen(function* () {
					const { presets } = yield* read((reader) => reader.dashboardOptions());
					const preset = presets.find(({ id }) => id === asked.preset) ?? presets[0];
					const document = yield* read((reader) =>
						reader.kpiDocument({
							school: asked.school,
							preset: preset?.id ?? noPreset,
							audience: asked.audience,
							pinLocked: asked.pinLocked,
						}),
					);
					return {
						key: asked.key,
						school: asked.school,
						audience: asked.audience,
						presets,
						document,
					};
				}),
			{
				value: (value) => {
					documents.set(value.key, value);
					loaded = value;
					failure = null;
					preRead(asked, value.presets);
				},
				failure: (error) => {
					failure = { key: asked.key, error };
				},
				busy: (next) => {
					busy = next;
				},
			},
		);
		reading = documentRead;
		documentRead.run();
		return () => {
			documentRead.cancel();
			if (reading === documentRead) reading = null;
		};
	});

	/** While the next document loads, the one before stays on screen if it is this school's and this audience's;
	 * otherwise the pane says it is loading. */
	const shown = $derived(
		loaded?.school === school.id && loaded.audience === audience ? loaded : null,
	);
	const document = $derived(shown?.document);
	const failed = $derived(failure?.key === key ? failure.error : null);
	const onScreen = $derived(failed !== null || shown?.key === key);

	const isMonthGrain = $derived(document?.grain === "month");
	const selected = $derived(
		document
			? snapStripPeriod(
					document.periods,
					parsePeriod(route.query.get("month") ?? school.dashboardOpensOn ?? null, app.calendar.today),
				)
			: undefined,
	);
	const books = $derived<Books | null>(
		document && selected
			? {
					document,
					selected,
					choose: (period) => {
						const target = document.periods.find((candidate) => candidate.period === period);
						if (target) go("month", monthParameter(document, target));
					},
				}
			: null,
	);
	const position = $derived(document && selected ? document.periods.indexOf(selected) : -1);
	const preset = $derived(
		shown?.presets.find(({ id }) => id === presetAsked) ?? shown?.presets[0],
	);
	const featured = $derived(shown?.presets.slice(0, featuredScenarios) ?? []);
	const creditsName = $derived(creditsNameOf(school.creditUnit.other));
	const pinAudiences = $derived(
		audiences.filter((candidate) => viewing.disclosure.views[candidate].pin),
	);
	const captionText = $derived(
		document && selected ? document.captions[selected.period.slice(0, 4)] : undefined,
	);
	const audienceName = $derived(audienceNames[audience]);

	/** The route is reported once its own document (or its message, or its PIN prompt) is on screen. */
	$effect(() => {
		if (onScreen) onRendered(formatRoute(route));
	});

	const go = (name: string, value: string | null): void => navigate(withQuery(route, name, value));
	const step = (direction: -1 | 1) => {
		const target = document?.periods[position + direction];
		return { target, disabled: target?.state !== "shown" };
	};
	const previous = $derived(step(-1));
	const next = $derived(step(1));
	const unlocked = (): void => {
		go("pin", null);
		app.runtime.runFork(
			Toasts.use((toasts) =>
				toasts.show({ tone: "success", title: "Books unlocked for this session." }),
			),
		);
	};
	const stripButton =
		"rounded-md border border-border bg-transparent px-[7px] py-0.5 text-[11px] text-muted-foreground aria-pressed:border-primary aria-pressed:text-foreground disabled:cursor-not-allowed";
</script>

{#if failed}
	<LoadFailed error={failed} onRetry={() => reading?.run()} {busy} />
{:else if !shown}
	<p class="m-0 py-6 text-muted-foreground" data-test="dash-loading">
		<span aria-hidden="true">…</span><span class="sr-only">Loading</span>
	</p>
{:else if !document}
	<div class="flex flex-col items-start gap-1 py-6 text-muted-foreground" data-test="dash-missing">
		<h2 class="m-0 flex items-center gap-1.5 text-[14px] font-semibold text-foreground">
			<Icon name="chart" />Not available
		</h2>
		<p class="m-0">
			The books of {school.name} have no {audienceName} document yet. Nothing is shown rather than a 0.
		</p>
	</div>
{:else if document && selected && books}
	<div class="mb-2 flex flex-wrap items-center gap-2">
		<div class={segment} role="group" aria-label="Dashboard view">
			{#each dashboardViews as option (option.id)}
				<button
					type="button"
					class={segmentButton}
					data-test="dash-view"
					data-view={option.id}
					aria-pressed={option.id === view}
					onclick={() => go("view", option.id)}
				>
					<Icon name={option.icon} />{option.label}
				</button>
			{/each}
		</div>
		<Badge class={[mockBadge, "border-border text-muted-foreground [&>svg]:size-[11px]!"]} data-test="dash-badge">
			<Icon name="scale" class="mr-[3px]" />Cash basis · {document.symbol}
		</Badge>
		<Badge
			class={[mockBadge, document.dataSource === "fixture" ? badgeTones.warning : "border-border text-muted-foreground"]}
			data-test="dash-badge"
			title={document.notes.join(" ") || undefined}
		>
			{document.dataSource === "fixture" ? "Fixture data: invented" : "From this school's events"}
		</Badge>
		{#if viewing.view.pin}
			<button
				type="button"
				class={chip}
				data-test="pin-chip"
				aria-pressed={pinLocked}
				title={`${namesList(pinAudiences.map((candidate) => audienceNames[candidate]))} open books with the family PIN`}
				onclick={() => go("pin", pinLocked ? null : "locked")}
			>
				<Icon name="lock" class="size-3" />PIN locked
			</button>
		{/if}
		{#if document.source.kind === "mart" && featured.length > 0}
			<span class="flex-1"></span>
			<div class={segment} role="group" aria-label="Fixture scenario">
				{#each featured as option (option.id)}
					<button
						type="button"
						class={segmentButton}
						data-test="preset-option"
						data-preset={option.id}
						aria-pressed={option.id === preset?.id}
						onclick={() => go("preset", option.id)}>{option.label}</button
					>
				{/each}
			</div>
		{/if}
	</div>
	{#if document.pinLocked}
		{#key audience}
			<PinLock schoolId={school.id} levelName={audienceName} onUnlocked={unlocked} />
		{/key}
	{:else}
		<div
			class="mb-3 flex flex-wrap items-center gap-[3px]"
			role="group"
			aria-label={isMonthGrain ? "Month" : "Period"}
		>
			{#if isMonthGrain}
				<button
					type="button"
					class={stripButton}
					data-test="dash-step"
					data-step="-1"
					aria-label="Previous month"
					disabled={previous.disabled}
					onclick={() => previous.target && books.choose(previous.target.period)}>‹</button
				>
			{/if}
			{#each document.periods as period (period.period)}
				<button
					type="button"
					class={[
						stripButton,
						period.state === "embargoed" && "hatch-wait border-dashed opacity-75",
						period.open && "hatch-open border-dashed border-warning",
					]}
					data-test="dash-period"
					data-period={period.period}
					data-open={period.open ? "" : undefined}
					aria-pressed={period === selected}
					disabled={period.state !== "shown"}
					title={period.open ? openMonthTitle : (period.title ?? undefined)}
					onclick={() => books.choose(period.period)}
				>
					{isMonthGrain ? shortPeriodName(period.period) : period.label}
				</button>
			{/each}
			{#if isMonthGrain}
				<button
					type="button"
					class={stripButton}
					data-test="dash-step"
					data-step="1"
					aria-label="Next month"
					disabled={next.disabled}
					onclick={() => next.target && books.choose(next.target.period)}>›</button
				>
				<span class="ml-1.5 text-muted-foreground">{selected.period.slice(0, 4)}</span>
			{/if}
			{#if document.periods.some(({ open }) => open)}
				<span class="ml-1.5 text-muted-foreground" data-test="open-key">hatched = open month, live</span>
			{/if}
		</div>
		{#if captionText}
			<div class={caption} data-test="dash-caption">
				<Icon name="info" />
				<span>
					{#if captionText.startsWith(audienceName)}<b>{audienceName}</b>{captionText.slice(audienceName.length)}{:else}{captionText}{/if}
				</span>
			</div>
		{/if}
		{#if isMonthGrain && document.source.kind === "mart" && preset?.note}
			<div
				class="mb-2 flex items-center gap-2 rounded-xl border border-warning px-2.5 py-[7px] text-warning"
				data-test="dash-note"
			>
				<Icon name="alert" /><span>{preset.note}</span>
			</div>
		{/if}
		{#if selected.state !== "shown"}
			<div
				class="hatch-wait mb-2.5 grid min-h-[132px] place-items-center content-center gap-1 rounded-xl border border-dashed border-border text-center"
			>
				<b class="text-[13px] text-foreground">{selected.label} is not shown yet</b>
				<span>{selected.title}.</span>
			</div>
		{:else if !isMonthGrain}
			<AggregateBody
				{books}
				{view}
				{creditsName}
				planLock={viewing.option.locks["dashboard-plan"]}
				fewerThan={viewing.view.smallCounts?.fewerThan ?? null}
			/>
		{:else if document.empty}
			<div
				class="grid h-[126px] place-items-center rounded-xl border border-border bg-card text-muted-foreground"
				data-test="dash-empty"
			>
				No payments yet. This dashboard fills in after the first payment.
			</div>
		{:else}
			<MonthBody
				{books}
				{view}
				{creditsName}
				identities={viewing.view.identities}
				onOpenReports={() => navigate({ ...route, tab: "reports" })}
			/>
		{/if}
	{/if}
{/if}
