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
	import type { AudienceView } from "$contract/data/disclosure.ts";
	import { Button } from "$lib/components/ui/button/index.ts";
	import { Input } from "$lib/components/ui/input/index.ts";
	import * as Popover from "$lib/components/ui/popover/index.ts";
	import Icon from "./Icon.svelte";
	import { popoverPanel, popoverRow, popoverRule } from "./styles.ts";
	import InlineError from "./toasts/InlineError.svelte";

	/** The one period control of the top bar (mockup `#pb`, `#pp`, `renderPP`): the steps around the period's name,
	 * the viewed audience's note, the eight presets, the audience's own periods as chips, a custom range, Compare. An
	 * option the viewed audience may not pick is disabled with the reason (an embargoed preset its publish line, a hidden
	 * one "—"); days show to finance admins and the owner only, so below them the custom range is its note. On All
	 * schools (`view` null) every period is pickable. A custom range may not start after the clock's today; the problem
	 * shows at the fields. */
	let {
		period,
		today,
		view,
		previewing,
		changed,
		compare,
		timeZoneNote,
		onChoose,
		onCompareChange,
	}: {
		period: Period;
		today: string;
		/** The viewed audience's periods, presets and note; null on All schools and until the disclosure loads. */
		view: AudienceView | null;
		/** View as shows another audience than the viewer's own: the note starts "Previewing". */
		previewing: boolean;
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
		return { target, ...stepAllowed(target, view, today) };
	};
	const previous = $derived(step(-1));
	const next = $derived(step(1));

	const presetGate = (label: string) =>
		view?.presets.find((gate) => gate.label === label);
	const chips = $derived(view && !view.live ? view.periods : []);

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
		{#if view}
			<div class="px-2 pb-1 text-center text-[10.5px] text-muted-foreground" data-test="period-note">
				{previewing ? "Previewing " : ""}{view.periodNote}
			</div>
		{/if}
		<hr class={popoverRule} />
		{#each presets as preset (preset.label)}
			{@const gate = presetGate(preset.label)}
			{@const pickable = !gate || gate.state === "shown"}
			<button
				type="button"
				class={[popoverRow, preset.label === chosenLabel && "text-primary"]}
				data-test="period-option"
				aria-current={preset.label === chosenLabel ? "true" : undefined}
				disabled={!pickable}
				title={pickable ? undefined : (gate?.title ?? undefined)}
				onclick={() => pick(preset.period, true)}
			>
				<span class="flex-1">{preset.label}</span>
				<span class="text-muted-foreground"
					>{gate?.state === "embargoed"
						? (gate.title ?? periodLabel(preset.period))
						: gate?.state === "hidden"
							? "—"
							: periodLabel(preset.period)}</span
				>
			</button>
		{/each}
		{#if chips.length > 0}
			<hr class={popoverRule} />
			<div class="flex flex-wrap gap-1 px-2 py-1" role="group" aria-label={`${view?.grain ?? "period"}s`}>
				{#each chips as gate (gate.period)}
					{@const pickable = gate.state === "shown"}
					{@const chosen = samePeriod({ from: gate.from, to: gate.to }, period)}
					<button
						type="button"
						class={[
							"inline-flex items-center rounded-md border border-border bg-card px-2 py-[3px] text-[11px] text-foreground disabled:cursor-not-allowed disabled:opacity-50",
							chosen && "border-primary text-primary",
						]}
						data-test="period-chip"
						data-period={gate.period}
						aria-pressed={chosen}
						disabled={!pickable}
						title={pickable ? undefined : (gate.title ?? undefined)}
						onclick={() => pick({ from: gate.from, to: gate.to }, true)}>{gate.label}</button
					>
				{/each}
			</div>
		{/if}
		<hr class={popoverRule} />
		<div class="px-2 py-1" data-test="period-custom">
			<span class="mb-1 block text-[10.5px] text-muted-foreground">Custom range</span>
			{#if view?.customRangeNote}
				<div class="text-[11px] text-muted-foreground" data-test="period-custom-note">{view.customRangeNote}</div>
			{:else}
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
			{/if}
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
