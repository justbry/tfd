<script lang="ts">
	import {
		type Period,
		periodLabel,
		periodName,
		periodPresets,
		periodWord,
		samePeriod,
		shiftPeriod,
		stepAllowed,
	} from "$contract/app/period.ts";
	import { Button } from "$lib/components/ui/button/index.ts";
	import { Input } from "$lib/components/ui/input/index.ts";
	import * as Popover from "$lib/components/ui/popover/index.ts";
	import Icon from "./Icon.svelte";
	import { popoverPanel, popoverRow, popoverRule } from "./styles.ts";
	import InlineError from "./toasts/InlineError.svelte";

	/** The one period control of the top bar (mockup `#pb`, `#pp`, `renderPP`): the steps around the period's name,
	 * the eight presets, a custom range, Compare. Every period is pickable until View as brings audiences (S9.1). A
	 * custom range may not start after the clock's today; the problem shows at the fields. */
	let {
		period,
		today,
		note,
		changed,
		compare,
		timeZoneNote,
		onChoose,
		onCompareChange,
	}: {
		period: Period;
		today: string;
		/** The viewed audience's note on what it may pick, under the period's name. */
		note: string | null;
		/** The route names a period other than the default: the button shows the dot. */
		changed: boolean;
		compare: boolean;
		timeZoneNote: string;
		onChoose: (period: Period) => void;
		onCompareChange: (compare: boolean) => void;
	} = $props();

	let open = $state(false);
	let from = $state("");
	let to = $state("");
	const panelId = $props.id();

	const presets = $derived(periodPresets(today));
	const chosenLabel = $derived(
		presets.find((preset) => samePeriod(preset.period, period))?.label,
	);
	const problem = $derived.by(() => {
		if (!from || !to) return "Pick both dates.";
		if (from > today) return "Start is after today.";
		if (from > to) return "Start is after the end.";
		return "";
	});
	const step = (direction: 1 | -1) => {
		const target = shiftPeriod(period, direction);
		return { target, ...stepAllowed(target, null, today) };
	};
	const previous = $derived(step(-1));
	const next = $derived(step(1));

	const pick = (chosen: Period, close: boolean): void => {
		if (close) open = false;
		onChoose(chosen);
	};
</script>

<Popover.Root
	bind:open
	onOpenChange={(opened) => {
		if (opened) {
			from = period.from;
			to = period.to;
		}
	}}
>
	<Popover.Trigger>
		{#snippet child({ props })}
			<Button
				{...props}
				variant="tool"
				size="tool"
				id="pb"
				class={["min-h-8 whitespace-nowrap", changed && "border-primary text-primary hover:border-primary"]}
				data-test="period-button"
				aria-haspopup="dialog"
				aria-controls={panelId}
				aria-label={`Period: ${periodName(period)}`}
				title={periodName(period)}
			>
				<Icon name="calendar" />
				<span class="max-[640px]:hidden" data-test="period-word">{periodWord(period)}</span>
				{#if changed}
					<i class="inline-block size-1.5 rounded-full bg-primary" aria-hidden="true"></i>
				{/if}
			</Button>
		{/snippet}
	</Popover.Trigger>
	<Popover.Content
		id={panelId}
		align="start"
		role="dialog"
		aria-label="Period"
		class={[popoverPanel, "w-[280px] max-[640px]:w-[calc(100vw-16px)]"]}
		data-test="period-panel"
	>
		<div class="flex items-center gap-1.5 px-2 pt-1.5 pb-0.5">
			<Button
				variant="tool"
				size="tool-small"
				class="px-1.5"
				data-test="period-prev"
				aria-label="Previous period"
				disabled={!previous.ok}
				title={previous.title ?? undefined}
				onclick={() => pick(previous.target, false)}
			>
				<Icon name="chevronLeft" />
			</Button>
			<b class="flex-1 text-center text-[13px]" data-test="period-label">{periodName(period)}</b>
			<Button
				variant="tool"
				size="tool-small"
				class="px-1.5"
				data-test="period-next"
				aria-label="Next period"
				disabled={!next.ok}
				title={next.title ?? undefined}
				onclick={() => pick(next.target, false)}
			>
				<Icon name="chevronRight" />
			</Button>
		</div>
		{#if note}
			<div class="px-2 pb-1 text-center text-[10.5px] text-muted-foreground" data-test="period-note">{note}</div>
		{/if}
		<hr class={popoverRule} />
		{#each presets as preset (preset.label)}
			<button
				type="button"
				class={[popoverRow, preset.label === chosenLabel && "text-primary"]}
				data-test="period-option"
				aria-current={preset.label === chosenLabel ? "true" : undefined}
				onclick={() => pick(preset.period, true)}
			>
				<span class="flex-1">{preset.label}</span>
				<span class="text-muted-foreground">{periodLabel(preset.period)}</span>
			</button>
		{/each}
		<hr class={popoverRule} />
		<div class="px-2 py-1" data-test="period-custom">
			<span class="mb-1 block text-[10.5px] text-muted-foreground">Custom range</span>
			<div class="mb-1.5 grid grid-cols-2 gap-1.5">
				<Input
					type="date"
					aria-label="From"
					max={today}
					bind:value={from}
					aria-invalid={problem !== "" ? "true" : undefined}
					aria-describedby={`${panelId}-problem`}
					class="h-auto rounded-md border-border bg-card px-2 py-1 text-[12px] shadow-none md:text-[12px]"
				/>
				<Input
					type="date"
					aria-label="To"
					bind:value={to}
					aria-invalid={problem !== "" ? "true" : undefined}
					aria-describedby={`${panelId}-problem`}
					class="h-auto rounded-md border-border bg-card px-2 py-1 text-[12px] shadow-none md:text-[12px]"
				/>
			</div>
			<InlineError id={`${panelId}-problem`} problems={problem} />
			<Button
				variant="primary"
				size="tool-small"
				class="mt-1"
				disabled={problem !== ""}
				onclick={() => pick({ from, to }, true)}>Apply</Button
			>
		</div>
		<hr class={popoverRule} />
		<label class="flex items-center gap-1.5 px-2 py-0.5 text-[11px]">
			<input
				type="checkbox"
				checked={compare}
				onchange={(event) => onCompareChange(event.currentTarget.checked)}
			/>
			Compare with previous period
		</label>
		<div class="px-2 pt-0.5 pb-1.5 text-[10.5px] text-muted-foreground" data-test="period-zone">
			{timeZoneNote}
		</div>
	</Popover.Content>
</Popover.Root>
