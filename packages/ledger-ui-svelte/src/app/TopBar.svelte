<script lang="ts">
	import { formatPeriod, type Period } from "$contract/app/period.ts";
	import { type Route, withQuery } from "$contract/app/route.ts";
	import type { ViewAs } from "$contract/data/disclosure.ts";
	import type { School } from "$contract/data/types.ts";
	import { Button } from "$lib/components/ui/button/index.ts";
	import type { ToastInput } from "../effect/toast-model.ts";
	import HelpMenu from "./HelpMenu.svelte";
	import Icon from "./Icon.svelte";
	import PeriodControl from "./PeriodControl.svelte";
	import SchoolSwitcher from "./SchoolSwitcher.svelte";
	import ViewAsMenu from "./ViewAsMenu.svelte";
	import type { Viewing } from "./viewing.ts";

	/** The mockup's top bar (`.top`): brand, school switcher, the period control and View as on the left; help and
	 * settings pinned right on the first row at every width. Under 640px the controls tighten and the period word and
	 * "View as" hide; under 440px help and settings stay beside the switcher and the period control and View as wrap to
	 * a second row (the mockup's orders). */
	let {
		route,
		schools,
		school,
		today,
		period,
		viewing,
		settingsOpen,
		onNavigate,
		onChooseSchool,
		onChooseViewAs,
		onToggleSettings,
		onToast,
	}: {
		route: Route;
		schools: School[];
		school: School | undefined;
		today: string;
		/** The money period the viewed audience may see (the route's `month=`, snapped). */
		period: Period;
		/** What the route views, once the school's disclosure has loaded; null on All schools. */
		viewing: Viewing | null;
		settingsOpen: boolean;
		onNavigate: (route: Route) => void;
		onChooseSchool: (schoolId: string) => void;
		onChooseViewAs: (value: ViewAs) => void;
		onToggleSettings: () => void;
		onToast: (toast: ToastInput) => void;
	} = $props();
</script>

<div
	class="relative flex flex-wrap items-center gap-1.5 border-b border-border px-3 py-2 max-[640px]:gap-1 max-[640px]:px-2 max-[640px]:py-1.5"
	data-test="top-bar"
>
	<span class="font-mono font-bold max-[640px]:text-[11px]" data-test="brand">atm</span>
	<div class="relative max-[440px]:order-1">
		<SchoolSwitcher {schools} current={route.schoolId} onChoose={onChooseSchool} />
	</div>
	<div class="relative max-[440px]:order-5">
		<PeriodControl
			{period}
			{today}
			view={viewing?.view ?? null}
			previewing={viewing?.preview ?? false}
			changed={route.query.has("month")}
			compare={route.query.get("compare") === "1"}
			timeZoneNote={school ? `Times in ${school.timeZone}` : "Each school's own time zone"}
			onChoose={(chosen) =>
				onNavigate(withQuery(route, "month", formatPeriod(chosen, today)))}
			onCompareChange={(checked) =>
				onNavigate(withQuery(route, "compare", checked ? "1" : null))}
		/>
	</div>
	{#if school && viewing}
		<div class="relative max-[440px]:order-6">
			<ViewAsMenu {viewing} schoolName={school.name} onChoose={onChooseViewAs} />
		</div>
	{/if}
	<span class="min-w-0 flex-1 basis-0 max-[440px]:order-2"></span>
	<span class="hidden h-0 basis-full max-[440px]:order-4 max-[440px]:block" aria-hidden="true"></span>
	<div class="shrink-0 max-[440px]:order-3">
		<HelpMenu {onToast} />
	</div>
	<Button
		variant="box"
		size="box"
		id="gb"
		class="shrink-0 max-[440px]:order-3"
		data-test="settings-button"
		title="Settings"
		aria-label="Settings"
		aria-haspopup="dialog"
		aria-expanded={settingsOpen}
		onclick={onToggleSettings}
	>
		<Icon name="gear" />
	</Button>
</div>
