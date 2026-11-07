<script lang="ts">
	import {
		allSchools,
		type Route,
		type SchoolTab,
		schoolTabs,
		themeOf,
		withQuery,
	} from "$contract/app/route.ts";
	import { type Disclosure, resolveViewAs } from "$contract/data/disclosure.ts";
	import type { School } from "$contract/data/types.ts";
	import { Badge } from "$lib/components/ui/badge/index.ts";
	import * as Tabs from "$lib/components/ui/tabs/index.ts";
	import { read } from "../effect/run.ts";
	import { Toasts } from "../effect/services.ts";
	import type { ToastInput } from "../effect/toast-model.ts";
	import { toUiError } from "../effect/ui-error.ts";
	import AllSchools from "./AllSchools.svelte";
	import { useApp } from "./context.ts";
	import EmptyPane from "./EmptyPane.svelte";
	import Icon from "./Icon.svelte";
	import LoadFailed from "./LoadFailed.svelte";
	import { retryingRead } from "./retrying-read.ts";
	import { shownPeriod, staleText, tabBadge, tabNames } from "./shell-model.ts";
	import { badgeTones, mockBadge } from "./styles.ts";
	import TopBar from "./TopBar.svelte";

	/** The mockup's frame (lines 375 to 450): top bar, the tabs row, the stale banner, the tab's pane (empty until its
	 * slice), the settings sheet. All schools has no tabs: its pane is the schools table. */
	let {
		route,
		schools,
		navigate,
		chrome = $bindable(null),
	}: {
		route: Route;
		schools: School[];
		navigate: (route: Route) => void;
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
	const period = $derived(
		shownPeriod(route.query.get("month"), today, route.tab, school),
	);
	const theme = $derived(themeOf(route.query));

	/** The school's disclosure, for the period note of the viewer's own audience (mockup `renderPP`'s sub-line).
	 * View as and the audience's period limits arrive with S9.1. */
	let disclosure = $state<Disclosure | null>(null);
	$effect(() => {
		const schoolId = school?.id;
		if (!schoolId) return;
		let current = true;
		retryingRead(app, () => read((reader) => reader.disclosure(schoolId)), {
			value: (loaded) => {
				if (current) disclosure = loaded;
			},
		})();
		return () => {
			current = false;
		};
	});
	const periodNote = $derived.by(() => {
		if (!school || disclosure?.school !== school.id) return null;
		const { option } = resolveViewAs(null, disclosure);
		return disclosure.views[option.audience]?.periodNote ?? null;
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
		"h-auto flex-none gap-0.5 rounded-none border-0 border-b-2 border-transparent px-2.5 py-2 text-[12px] font-normal text-muted-foreground shadow-none after:hidden hover:text-foreground data-active:border-primary data-active:bg-transparent data-active:text-foreground data-active:shadow-none dark:data-active:border-primary dark:data-active:bg-transparent [&_svg:not([class*='size-'])]:size-3.5 [&>svg]:mr-1";
</script>

<div bind:this={topBar} bind:clientHeight={topBarHeight}>
<TopBar
	{route}
	{schools}
	{school}
	{today}
	{period}
	{periodNote}
	{settingsOpen}
	onNavigate={navigate}
	onChooseSchool={chooseSchool}
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
				{@const badge = tabBadge(tab, school)}
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
				{#if tab === route.tab}
					<EmptyPane {tab} {school} />
				{/if}
			</Tabs.Content>
		{/each}
	</Tabs.Root>
{:else}
	<section class="overflow-x-auto p-3.5" aria-label="All schools" data-test="pane">
		<AllSchools {schools} {period} onOpen={chooseSchool} />
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
