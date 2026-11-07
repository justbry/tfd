<script lang="ts">
	import { allSchools } from "$contract/app/route.ts";
	import type { School } from "$contract/data/types.ts";
	import { Badge } from "$lib/components/ui/badge/index.ts";
	import { Button } from "$lib/components/ui/button/index.ts";
	import { Input } from "$lib/components/ui/input/index.ts";
	import * as Popover from "$lib/components/ui/popover/index.ts";
	import Icon from "./Icon.svelte";
	import { schoolLabel } from "./shell-model.ts";
	import {
		badgeTones,
		mockBadge,
		popoverPanel,
		popoverRow,
		popoverRule,
	} from "./styles.ts";

	/** The school switcher (mockup `#sw`, `#sp`, `renderSP`): a search field, then a listbox whose rows are
	 * `role=option`. The listbox is one Tab stop (the current school's row, or the first shown); Arrow Up and Down,
	 * Home and End move between rows; Enter and Space choose; Arrow Down in the search enters the list; Escape closes
	 * and returns focus to the button. */
	let {
		schools,
		current,
		onChoose,
	}: {
		schools: School[];
		/** A school id, or `all`. */
		current: string;
		onChoose: (schoolId: string) => void;
	} = $props();

	let open = $state(false);
	let search = $state("");
	let listbox: HTMLElement | undefined = $state();
	const listboxId = $props.id();

	const currentName = $derived(
		schools.find((school) => school.id === current)?.name ?? "All schools",
	);
	const matches = (name: string): boolean =>
		name.toLowerCase().includes(search.trim().toLowerCase());
	const allShown = $derived(matches("All schools"));
	const shownSchools = $derived(schools.filter((school) => matches(school.name)));
	const shownIds = $derived([
		...(allShown ? [allSchools] : []),
		...shownSchools.map((school) => school.id),
	]);
	const tabStop = $derived(shownIds.includes(current) ? current : shownIds[0]);

	const rows = (): HTMLElement[] => [
		...(listbox?.querySelectorAll<HTMLElement>("[role=option]") ?? []),
	];
	const moves: Record<string, (index: number, count: number) => number> = {
		ArrowDown: (index) => index + 1,
		ArrowUp: (index) => index - 1,
		Home: () => 0,
		End: (_index, count) => count - 1,
	};

	const choose = (schoolId: string): void => {
		open = false;
		search = "";
		onChoose(schoolId);
	};
	const onListKeyDown = (event: KeyboardEvent): void => {
		const move = moves[event.key];
		if (move) {
			event.preventDefault();
			const options = rows();
			const focused = document.activeElement;
			const index =
				focused instanceof HTMLElement ? options.indexOf(focused) : -1;
			const target = Math.max(
				0,
				Math.min(options.length - 1, move(index, options.length)),
			);
			options[target]?.focus();
			return;
		}
		if (event.key !== "Enter" && event.key !== " ") return;
		const option =
			event.target instanceof HTMLElement
				? event.target.closest<HTMLElement>("[role=option]")
				: null;
		const schoolId = option?.dataset.school;
		if (schoolId === undefined) return;
		event.preventDefault();
		choose(schoolId);
	};
	const onSearchKeyDown = (event: KeyboardEvent): void => {
		if (event.key !== "ArrowDown") return;
		event.preventDefault();
		rows()
			.find((option) => option.dataset.school === tabStop)
			?.focus();
	};
</script>

<Popover.Root bind:open onOpenChange={(next) => { if (!next) search = ""; }}>
	<Popover.Trigger>
		{#snippet child({ props })}
			<Button
				{...props}
				variant="tool"
				size="tool"
				id="sw"
				class="min-h-8 max-w-[280px]"
				data-test="school-switcher"
				aria-haspopup="listbox"
				aria-controls={listboxId}
				title={currentName}
			>
				<Icon name="building" />
				<span
					class="mx-1 inline-block max-w-[200px] overflow-hidden text-ellipsis whitespace-nowrap align-middle max-[640px]:mx-0.5 max-[640px]:max-w-[96px]"
					data-test="school-name">{currentName}</span
				>
				<Icon name="chevronDown" />
			</Button>
		{/snippet}
	</Popover.Trigger>
	<Popover.Content
		align="start"
		class={popoverPanel}
		data-test="school-panel"
		onOpenAutoFocus={(event) => {
			event.preventDefault();
			document.getElementById(`${listboxId}-search`)?.focus();
		}}
	>
		<div class="p-1">
			<Input
				id={`${listboxId}-search`}
				type="search"
				placeholder="Find a school"
				aria-label="Find a school"
				aria-controls={listboxId}
				class="h-auto w-[150px] rounded-md border-border bg-card px-2 py-1 text-[12px] shadow-none md:text-[12px] focus-visible:border-border focus-visible:ring-0 focus-visible:[outline:-webkit-focus-ring-color_auto_1px]"
				bind:value={search}
				onkeydown={onSearchKeyDown}
			/>
		</div>
		<div
			bind:this={listbox}
			id={listboxId}
			role="listbox"
			aria-label="Schools"
			tabindex="-1"
			onkeydown={onListKeyDown}
		>
			{#if allShown}
				<button
					type="button"
					role="option"
					class={[popoverRow, current === allSchools && "text-primary"]}
					data-test="school-option"
					data-school={allSchools}
					aria-selected={current === allSchools}
					aria-label={`All schools, ${schools.length} schools`}
					tabindex={tabStop === allSchools ? 0 : -1}
					onclick={() => choose(allSchools)}
				>
					<Icon name="building" />
					<span class="flex-1">All schools</span>
					<span class="text-muted-foreground">{schools.length}</span>
				</button>
			{/if}
			<hr class={popoverRule} aria-hidden="true" />
			{#each shownSchools as school (school.id)}
				<button
					type="button"
					role="option"
					class={[popoverRow, current === school.id && "text-primary"]}
					data-test="school-option"
					data-school={school.id}
					aria-selected={current === school.id}
					aria-label={schoolLabel(school)}
					tabindex={tabStop === school.id ? 0 : -1}
					onclick={() => choose(school.id)}
				>
					<Icon name="building" />
					<span class="flex-1">{school.name}</span>
					{#if school.stale}
						<Badge class={[mockBadge, badgeTones.warning]}>stale</Badge>
					{/if}
					{#if school.attentionCount !== null && school.attentionCount > 0}
						<Badge class={[mockBadge, badgeTones.warning]}>{school.attentionCount}</Badge>
					{/if}
				</button>
			{/each}
		</div>
	</Popover.Content>
</Popover.Root>
