<script lang="ts">
	import {
		type BookingsPeriod,
		bookingsChoices,
		bookingsDays,
		bookingsLabel,
		bookingsPeriodRoute,
		readBookingsPeriod,
	} from "./period-model.ts";
	import { monthAndDay, type Period, periodName } from "$contract/app/period.ts";
	import type { Route } from "$contract/app/route.ts";
	import { Button } from "$lib/components/ui/button/index.ts";
	import Icon from "../Icon.svelte";

	/** The period control of the top bar on the Bookings tab (mockup `renderPP`): bookings look ahead, so the choices
	 * are a day or a week and the steps move one of them by one; the money period is not touched. */
	let {
		route,
		today,
		moneyPeriod,
		timeZone,
		onNavigate,
	}: {
		route: Route;
		today: string;
		/** The money period, which comes back when the tab is left. */
		moneyPeriod: Period;
		timeZone: string;
		onNavigate: (route: Route) => void;
	} = $props();

	/** The mockup's popover (`.pop`), its rows (`.pop .it`) and its rule, as the other period control draws them. */
	const popoverPanel =
		"z-(--layer-popover) min-w-[260px] max-w-[calc(100vw-16px)] rounded-xl border border-border bg-popover p-1 text-[12px] shadow-popover";
	const popoverRow =
		"flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-foreground hover:bg-secondary focus-visible:bg-secondary focus-visible:outline-none";
	const popoverRule = "my-1 border-0 border-t border-border";
	let open = $state(false);
	let wrapper = $state<HTMLElement | null>(null);
	const panelId = $props.id();
	const period = $derived(readBookingsPeriod(route.query));
	const days = $derived(bookingsDays(period, today));
	const name = $derived(bookingsLabel(period, days.from));
	const dates = $derived(
		`${monthAndDay(days.from)}${days.from === days.to ? "" : ` – ${monthAndDay(days.to)}`}`,
	);
	const changed = $derived(period.range !== "week" || period.offset !== 0);

	/** Escape or a click outside closes it and returns focus to the button, as the popover of the other period control does. */
	$effect(() => {
		if (!open) return;
		const onClick = (event: MouseEvent): void => {
			if (event.target instanceof Node && wrapper?.contains(event.target)) return;
			open = false;
		};
		const onKeyDown = (event: KeyboardEvent): void => {
			if (event.key !== "Escape") return;
			event.stopPropagation();
			open = false;
			wrapper?.querySelector<HTMLElement>("#pb")?.focus();
		};
		document.addEventListener("click", onClick);
		document.addEventListener("keydown", onKeyDown, true);
		return () => {
			document.removeEventListener("click", onClick);
			document.removeEventListener("keydown", onKeyDown, true);
		};
	});

	const choose = (chosen: BookingsPeriod, close: boolean): void => {
		if (close) {
			open = false;
			// The option that was picked is gone with the panel: focus goes back to the button.
			wrapper?.querySelector<HTMLElement>("#pb")?.focus();
		}
		onNavigate(bookingsPeriodRoute(route, chosen));
	};
</script>

<div class="relative" bind:this={wrapper}>
	<Button
		variant="tool"
		size="tool"
		id="pb"
		class={["min-h-8 whitespace-nowrap", changed && "border-primary text-primary hover:border-primary"]}
		data-test="period-button"
		aria-haspopup="dialog"
		aria-expanded={open}
		aria-controls={open ? panelId : undefined}
		aria-label={`Bookings period: ${name}`}
		title={`${name} · ${dates}`}
		onclick={() => (open = !open)}
	>
		<Icon name="calendar" />
		<span class="max-[640px]:hidden" data-test="period-word">{period.range === "day" ? "Day" : "Week"}</span>
		{#if changed}
			<i class="inline-block size-1.5 rounded-full bg-primary" aria-hidden="true"></i>
		{/if}
	</Button>
	{#if open}
		<div
			id={panelId}
			role="dialog"
			aria-label="Period"
			class={[popoverPanel, "absolute top-full left-0 mt-1 w-70 max-[640px]:fixed max-[640px]:inset-x-2 max-[640px]:top-auto max-[640px]:w-auto"]}
			data-test="period-panel"
		>
	<div class="flex items-center gap-1.5 px-2 pt-1.5 pb-0.5">
				<Button
					variant="tool"
					size="tool-small"
					class="px-1.5"
					data-test="period-prev"
					aria-label="Previous period"
					onclick={() => choose({ ...period, offset: period.offset - 1 }, false)}
				><Icon name="chevronLeft" /></Button>
				<b class="flex-1 text-center text-[13px]" data-test="period-label">{name}</b>
				<Button
					variant="tool"
					size="tool-small"
					class="px-1.5"
					data-test="period-next"
					aria-label="Next period"
					onclick={() => choose({ ...period, offset: period.offset + 1 }, false)}
				><Icon name="chevronRight" /></Button>
			</div>
			<div class="px-2 pb-1 text-center text-[10.5px] text-muted-foreground">{dates} · bookings ahead</div>
			<hr class={popoverRule} />
			{#each bookingsChoices as choice (choice.label)}
				{@const chosen = choice.range === period.range && choice.offset === period.offset}
				<button
					type="button"
					class={[popoverRow, chosen && "text-primary"]}
					data-test="period-option"
					aria-current={chosen ? "true" : undefined}
					onclick={() => choose(choice, true)}
				>
					<span class="flex-1">{choice.label}</span>
				</button>
			{/each}
			<hr class={popoverRule} />
			<div class="px-2 pt-0.5 pb-1.5 text-[10.5px] text-muted-foreground" data-test="period-zone">
				The money period ({periodName(moneyPeriod)}) comes back when you leave Bookings. Times in {timeZone}.
			</div>
		</div>
	{/if}
</div>
