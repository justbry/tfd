<script lang="ts" module>
	/** Where the panes loaded on demand come from; a test swaps one for a chunk that fails. */
	export const chunks = {
		dashboard: () => import("./dashboard/Dashboard.svelte"),
		allSchools: () => import("./AllSchools.svelte"),
		plans: () => import("./plans/Plans.svelte"),
		promos: () => import("./promos/Promos.svelte"),
	};
</script>

<script lang="ts">
	import type { Component } from "svelte";
	import {
		formatPeriod,
		periodName,
		samePeriod,
		snapPeriod,
	} from "$contract/app/period.ts";
	import {
		allSchools,
		formatRoute,
		type Route,
		type SchoolTab,
		schoolTabs,
		themeOf,
		withQuery,
	} from "$contract/app/route.ts";
	import type { Disclosure, ViewAs } from "$contract/data/disclosure.ts";
	import type { School } from "$contract/data/types.ts";
	import { Badge } from "$lib/components/ui/badge/index.ts";
	import { Button } from "$lib/components/ui/button/index.ts";
	import * as Tabs from "$lib/components/ui/tabs/index.ts";
	import { read } from "../effect/run.ts";
	import { Toasts } from "../effect/services.ts";
	import type { ToastInput } from "../effect/toast-model.ts";
	import { toUiError, type UiError } from "../effect/ui-error.ts";
	import { useApp } from "./context.ts";
	import EmptyPane from "./EmptyPane.svelte";
	import Icon from "./Icon.svelte";
	import LoadFailed from "./LoadFailed.svelte";
	import type { PaneProps } from "./pane-props.ts";
	import { type RetryingRead, retryingRead } from "./retrying-read.ts";
	import { shownPeriod, staleText, tabBadge, tabNames } from "./shell-model.ts";
	import { badgeTones, mockBadge } from "./styles.ts";
	import TopBar from "./TopBar.svelte";
	import { previewTail, resolveViewing } from "./viewing.ts";

	/** The mockup's frame (lines 375 to 450): top bar, the tabs row, the preview banner, the stale banner, the tab's
	 * pane (the Dashboard, loaded on demand; the others empty until their slice), the settings sheet. All schools has no
	 * tabs: its pane is the schools table. What the route views (`as=`) comes from the school's disclosure; the money
	 * period is the route's, snapped to what the viewed audience may pick. */
	let {
		route,
		schools,
		navigate,
		onPaneRendered,
		chrome = $bindable(null),
	}: {
		route: Route;
		schools: School[];
		navigate: (route: Route) => void;
		/** A pane that loads its own data (the Dashboard) says when the route's data, or its message, is on screen. */
		onPaneRendered: (hash: string) => void;
		/** The last of the bars (the tabs row, or the top bar on All schools), for the toast stack that sits below
		 * it so that it never covers a tab or a top-bar button. */
		chrome?: HTMLElement | null;
	} = $props();

	const app = useApp();
	const { today } = app.calendar;
	let settingsOpen = $state(false);
	let topBarHeight = $state(0);
	let topBar = $state<HTMLElement | null>(null);
	let tabsList = $state<HTMLElement | null>(null);
	$effect(() => {
		chrome = school ? tabsList : topBar;
	});
	/** The settings sheet loads the first time it opens, so that the first page load is the bar, the tabs and the pane
	 * only (as the Preact shell loads its settings after the first paint). */
	let settingsSheet: Promise<typeof import("./SettingsSheet.svelte")> | null =
		$state(null);
	$effect(() => {
		if (settingsOpen && !settingsSheet)
			settingsSheet = import("./SettingsSheet.svelte");
	});

	const school = $derived(
		schools.find((candidate) => candidate.id === route.schoolId),
	);
	/** Whether each school's Plans draft differs from its live menu, as the Plans tab says once it has worked it out: the
	 * tabs row's draft badge follows it (the school's own count is the answer before the tab was opened). */
	const draftChanges = $state<Record<string, boolean>>({});
	const theme = $derived(themeOf(route.query));

	/** The school's disclosure: View as, the preview banner, the period limits of the viewed audience. A failed read
	 * is a toast with Retry, and the Dashboard, which cannot show without it, shows the message in place. */
	let disclosure = $state<Disclosure | null>(null);
	let disclosureFailure = $state<{ school: string; error: UiError } | null>(
		null,
	);
	let disclosureBusy = $state(false);
	let disclosureRead: RetryingRead | null = null;
	$effect(() => {
		const schoolId = school?.id;
		if (!schoolId) return;
		const reading = retryingRead(
			app,
			() => read((reader) => reader.disclosure(schoolId)),
			{
				value: (loaded) => {
					disclosure = loaded;
					disclosureFailure = null;
				},
				failure: (error) => {
					disclosureFailure = { school: schoolId, error };
				},
				busy: (busy) => {
					disclosureBusy = busy;
				},
			},
		);
		disclosureRead = reading;
		reading.run();
		// Another school, or the shell leaving: this read's failure toast goes, and its Retry no longer runs.
		return () => {
			reading.cancel();
			if (disclosureRead === reading) disclosureRead = null;
		};
	});
	const viewing = $derived(
		school && disclosure?.school === school.id
			? resolveViewing(disclosure, route.query.get("as"))
			: null,
	);
	const disclosureError = $derived(
		school && disclosureFailure?.school === school.id && !viewing
			? disclosureFailure.error
			: null,
	);
	const period = $derived(
		snapPeriod(
			shownPeriod(route.query.get("month"), today, route.tab, school),
			viewing?.view ?? null,
		),
	);

	/** Picking a row of View as: the route gets `as=` (none for the viewer's own row), and a period the new audience
	 * may not pick becomes the nearest one it may, with a toast that says so (mockup `setVa`). */
	const chooseViewAs = (value: ViewAs): void => {
		if (!viewing) return;
		const own = value === viewing.disclosure.viewer.viewAs;
		const nextView = resolveViewing(viewing.disclosure, value).view;
		const snapped = snapPeriod(period, nextView);
		let target = withQuery(route, "as", own ? null : value);
		if (!samePeriod(snapped, period)) {
			target = withQuery(target, "month", formatPeriod(snapped, today));
			showToast({
				tone: "info",
				title: `Period changed to ${periodName(snapped)}`,
				detail: nextView.sees,
			});
		}
		navigate(target);
	};

	/** The tabs' panes and All schools, each its own chunk, loaded the first time it is shown, so that the first page load
	 * carries none of them. A chunk that fails to load is the pane's message, with Retry loading it again. */
	let loaded = $state.raw<
		Record<string, { module: Promise<unknown>; error?: UiError }>
	>({});
	const chunkOf = (tab: string): keyof typeof chunks | undefined =>
		tab === allSchools ? "allSchools" : tab in chunks ? (tab as keyof typeof chunks) : undefined;
	const loadChunk = (name: string): void => {
		const loading = chunks[name as keyof typeof chunks]();
		loaded = { ...loaded, [name]: { module: loading } };
		loading.catch((failure: unknown) => {
			if (loaded[name]?.module === loading)
				loaded = { ...loaded, [name]: { module: loading, error: toUiError(failure) } };
		});
	};
	$effect(() => {
		const name = chunkOf(route.tab);
		if (name && !loaded[name]) loadChunk(name);
	});
	/** A chunk that did not load is the pane's message, and so is a disclosure the school's panes cannot show without: the
	 * route is on screen. */
	$effect(() => {
		const name = chunkOf(route.tab);
		if (name && (loaded[name]?.error || (school && disclosureError)))
			onPaneRendered(formatRoute(route));
	});

	/** Each school's last tab, in memory only (mockup `s.last`). */
	const lastTabs: Record<string, SchoolTab> = {};
	$effect(() => {
		if (school && route.tab !== allSchools) lastTabs[school.id] = route.tab;
	});

	/** Another school opens on its last tab (Plans the first time) with only the theme carried over (mockup
	 * `setSchool`). */
	const chooseSchool = (chosen: string): void => {
		const query = new URLSearchParams();
		const themeAsked = route.query.get("theme");
		if (themeAsked) query.set("theme", themeAsked);
		navigate(
			chosen === allSchools
				? { schoolId: chosen, tab: allSchools, query }
				: { schoolId: chosen, tab: lastTabs[chosen] ?? "plans", query },
		);
	};
	const chooseTab = (tab: string): void => {
		const known = schoolTabs.find((name) => name === tab);
		if (known && known !== route.tab) navigate({ ...route, tab: known });
	};
	const showToast = (toast: ToastInput): void => {
		app.runtime.runFork(Toasts.use((toasts) => toasts.show(toast)));
	};

	const tabClass =
		"h-auto flex-none gap-0.5 rounded-none border-x-0! border-t-0! border-b-2! border-transparent px-2.5 py-2 text-[12px] font-normal text-muted-foreground shadow-none after:hidden hover:text-foreground data-active:border-primary data-active:bg-transparent data-active:text-foreground data-active:shadow-none dark:data-active:border-primary dark:data-active:bg-transparent [&_svg:not([class*='size-'])]:size-3.5 [&>svg]:mr-1";
</script>

<div bind:this={topBar} bind:clientHeight={topBarHeight}>
<TopBar
	{route}
	{schools}
	{school}
	{today}
	{period}
	{viewing}
	{settingsOpen}
	onNavigate={navigate}
	onChooseSchool={chooseSchool}
	onChooseViewAs={chooseViewAs}
	onToggleSettings={() => (settingsOpen = !settingsOpen)}
	onToast={showToast}
/>
</div>
{#if school}
	<Tabs.Root value={route.tab} onValueChange={chooseTab} class="gap-0" data-test="school">
		<Tabs.List
			bind:ref={tabsList}
			variant="line"
			aria-label={school.name}
			class="h-auto w-full justify-start gap-0.5 overflow-x-auto rounded-none border-b border-border p-0 px-2.5 group-data-horizontal/tabs:h-auto"
			data-test="tabs"
		>
			{#each schoolTabs as tab (tab)}
				{@const badge = tabBadge(tab, school, draftChanges[school.id])}
				<Tabs.Trigger
					value={tab}
					class={tabClass}
					data-test="tab"
					data-tab={tab}
					aria-label={badge ? `${tabNames[tab].label}: ${badge.meaning}` : undefined}
				>
					<Icon name={tabNames[tab].icon} />{tabNames[tab].label}
					{#if badge}
						<Badge class={[mockBadge, badgeTones[badge.tone], "ml-1.5"]} data-test="tab-badge">{badge.text}</Badge>
					{/if}
				</Tabs.Trigger>
			{/each}
		</Tabs.List>
		{#if viewing?.preview}
			<div
				class="flex items-center gap-2 border-b border-primary bg-secondary px-3.5 py-[7px] text-foreground"
				data-test="preview-banner"
				role="status"
			>
				<Icon name="eye" />
				<span>Preview: this is what <b>{viewing.option.name}</b>{previewTail(viewing)}</span>
				<span class="flex-1"></span>
				<Button
					variant="tool"
					size="tool-small"
					data-test="preview-exit"
					onclick={() => navigate(withQuery(route, "as", null))}
				>
					<Icon name="xCircle" />Exit preview
				</Button>
			</div>
		{/if}
		{#if school.stale}
			<div
				class="flex items-center gap-1.5 border-b border-warning bg-secondary px-3.5 py-[7px] text-warning"
				data-test="stale-banner"
				role="status"
			>
				<Icon name="alert" />{staleText(school)}
			</div>
		{/if}
		{#each schoolTabs as tab (tab)}
			<Tabs.Content
				value={tab}
				class="overflow-x-auto p-3.5"
				data-test={tab === route.tab ? "pane" : undefined}
			>
				{#if tab === route.tab && tab in chunks}
					<div class="text-[12px]" data-pane={tab}>
						{#if viewing && loaded[tab]}
							{#await loaded[tab].module as Promise<{ default: Component<PaneProps> }> then { default: Pane }}
								<Pane
									{route}
									{school}
									{viewing}
									{navigate}
									onRendered={onPaneRendered}
									onOpenSettings={() => (settingsOpen = true)}
									onDraftChange={(schoolId: string, changed: boolean) => (draftChanges[schoolId] = changed)}
								/>
							{:catch failure}
								<LoadFailed error={toUiError(failure)} onRetry={() => loadChunk(tab)} />
							{/await}
						{:else if disclosureError}
							<LoadFailed
								error={disclosureError}
								onRetry={() => disclosureRead?.run()}
								busy={disclosureBusy}
							/>
						{/if}
					</div>
				{:else if tab === route.tab}
					<EmptyPane {tab} {school} />
				{/if}
			</Tabs.Content>
		{/each}
	</Tabs.Root>
{:else}
	<section class="overflow-x-auto p-3.5" aria-label="All schools" data-test="pane">
		{#if loaded.allSchools}
			{#await loaded.allSchools.module as Promise<typeof import("./AllSchools.svelte")> then { default: AllSchools }}
				<AllSchools
					{schools}
					{period}
					onOpen={chooseSchool}
					onRendered={() => onPaneRendered(formatRoute(route))}
				/>
			{:catch failure}
				<LoadFailed error={toUiError(failure)} onRetry={() => loadChunk("allSchools")} />
			{/await}
		{/if}
	</section>
{/if}
{#if settingsSheet}
	{#await settingsSheet then { default: SettingsSheet }}
		<SettingsSheet
			bind:open={settingsOpen}
			root={app.root}
			top={topBarHeight}
			subtitle={school ? `You and ${school.name}` : "All schools"}
			allSchools={!school}
			{theme}
			onThemeChange={(chosen) =>
				navigate(withQuery(route, "theme", chosen === "system" ? null : chosen))}
		/>
	{:catch failure}
		<LoadFailed error={toUiError(failure)} />
	{/await}
{/if}
