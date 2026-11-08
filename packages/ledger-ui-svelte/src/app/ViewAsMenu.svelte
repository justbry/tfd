<script lang="ts">
	import type { ViewAs } from "$contract/data/disclosure.ts";
	import { Button } from "$lib/components/ui/button/index.ts";
	import * as Popover from "$lib/components/ui/popover/index.ts";
	import Icon from "./Icon.svelte";
	import type { IconName } from "./icons.ts";
	import { popoverPanel, popoverRow, popoverRule } from "./styles.ts";
	import { ownRowName, type Viewing } from "./viewing.ts";

	/** View as (mockup `#kview`, `#kvp`, `renderVA`): the viewer's own row and what each role sees. The rows are a
	 * listbox, one Tab stop (the chosen row, focused on open); Arrow Up and Down, Home and End move; Enter and Space
	 * choose. A row the viewer does not hold is disabled and says why; the Custom audiences row is a later release. While
	 * previewing, the button takes the warning colour. */
	let {
		viewing,
		schoolName,
		onChoose,
	}: {
		viewing: Viewing;
		schoolName: string;
		onChoose: (value: ViewAs) => void;
	} = $props();

	let open = $state(false);
	let listbox: HTMLElement | undefined = $state();
	const listboxId = $props.id();
	const own = $derived(viewing.disclosure.viewer.viewAs);
	const ownName = $derived(ownRowName(viewing.disclosure));
	const icons: Record<ViewAs, IconName> = {
		owner: "key",
		finance: "coin",
		admin: "sliders",
		governance: "users",
		member: "user",
		public: "eye",
	};
	const notHeldReason = "You do not hold this audience";
	const laterReason = "Custom audiences are not accepted in the first release";

	const rows = (): HTMLElement[] => [
		...(listbox?.querySelectorAll<HTMLElement>("[role=option]:not([disabled])") ?? []),
	];
	const moves: Record<string, (index: number, count: number) => number> = {
		ArrowDown: (index) => index + 1,
		ArrowUp: (index) => index - 1,
		Home: () => 0,
		End: (_index, count) => count - 1,
	};
	const onKeyDown = (event: KeyboardEvent): void => {
		const move = moves[event.key];
		if (!move) return;
		event.preventDefault();
		const options = rows();
		const focused = document.activeElement;
		const index = focused instanceof HTMLElement ? options.indexOf(focused) : -1;
		options[Math.max(0, Math.min(options.length - 1, move(index, options.length)))]?.focus();
	};
	const choose = (value: ViewAs): void => {
		open = false;
		onChoose(value);
	};
</script>

<Popover.Root bind:open>
	<Popover.Trigger>
		{#snippet child({ props })}
			<Button
				{...props}
				variant="tool"
				size="tool"
				id="kview"
				class={[
					"min-h-8 whitespace-nowrap",
					viewing.preview && "border-warning text-warning hover:border-warning",
				]}
				data-test="view-as"
				aria-haspopup="listbox"
				aria-controls={listboxId}
				aria-label={`View as ${viewing.option.name}`}
				title={`View as ${viewing.option.name}. You are ${ownName} in ${schoolName}. Owners and admins own the dashboard and see everyone's data. Members see only themselves and their family.`}
			>
				<Icon name="eye" />
				<span class="max-[640px]:hidden">{"View as "}</span><b class="font-semibold">{viewing.option.name}</b>
				<Icon name="chevronDown" />
			</Button>
		{/snippet}
	</Popover.Trigger>
	<Popover.Content
		align="start"
		class={[popoverPanel, "w-[330px] max-w-[calc(100vw-16px)] min-w-0"]}
		data-test="view-as-panel"
		onOpenAutoFocus={(event) => {
			event.preventDefault();
			listbox?.querySelector<HTMLElement>("[aria-selected=true]")?.focus();
		}}
	>
		<div
			id={`${listboxId}-top`}
			class="px-2 py-1.5 text-[10.5px] text-muted-foreground"
			data-test="view-as-note"
			data-note="top"
		>
			You are {ownName} here. This previews what each role sees: the same document that audience gets, not a person.
			Owners and admins own the dashboard and see everyone's data. Members see only themselves and their family.
		</div>
		<hr class={popoverRule} />
		<div
			bind:this={listbox}
			id={listboxId}
			role="listbox"
			aria-label="View as"
			aria-describedby={`${listboxId}-top ${listboxId}-portal`}
			tabindex="-1"
			onkeydown={onKeyDown}
		>
			{#each viewing.disclosure.viewAs as option (option.value)}
				{@const selected = option.value === viewing.option.value}
				<button
					type="button"
					role="option"
					class={[popoverRow, "items-start", selected && "text-primary"]}
					data-test="view-as-option"
					data-as={option.value}
					aria-selected={selected}
					aria-describedby={option.held ? undefined : `${listboxId}-${option.value}-reason`}
					disabled={!option.held}
					tabindex={selected ? 0 : -1}
					title={option.held ? undefined : notHeldReason}
					onclick={() => choose(option.value)}
				>
					<Icon name={icons[option.value]} class="mt-px" />
					<span class="flex-1">
						<b class="font-semibold" data-test="view-as-name"
							>{option.name}{#if option.value === own}<span class="font-normal text-muted-foreground">{" (you)"}</span>{/if}</b
						>
						<small
							class="mt-px block text-[10.5px] whitespace-normal text-muted-foreground"
							data-test="view-as-summary">{option.summary}</small
						>
					</span>
					{#if selected}<Icon name="check" />{/if}
					{#if !option.held}
						<span id={`${listboxId}-${option.value}-reason`} class="sr-only">{notHeldReason}</span>
					{/if}
				</button>
			{/each}
			<button
				type="button"
				role="option"
				class={[popoverRow, "items-start"]}
				data-test="view-as-later"
				aria-selected="false"
				aria-describedby={`${listboxId}-later-reason`}
				disabled
				tabindex={-1}
				title={laterReason}
			>
				<Icon name="plus" class="mt-px" />
				<span class="flex-1">
					<b class="font-semibold">Custom audiences: later</b>
					<small class="mt-px block text-[10.5px] whitespace-normal text-muted-foreground"
						>Etc.: any audience a school defines (a donor tier) comes in a later release.</small
					>
				</span>
				<span id={`${listboxId}-later-reason`} class="sr-only">{laterReason}</span>
			</button>
		</div>
		<hr class={popoverRule} />
		<div
			id={`${listboxId}-portal`}
			class="flex items-center gap-1 px-2 py-1.5 text-[10.5px] text-muted-foreground"
			data-test="view-as-note"
			data-note="portal"
		>
			<Icon name="info" /> To see one person's portal, use View as member on their row in Members.
		</div>
	</Popover.Content>
</Popover.Root>
