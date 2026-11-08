<script lang="ts">
	import "./late-icons.ts"; // the icons this pane draws that the first page load does not carry
	import { onMount } from "svelte";
	import type { ViewAs } from "$contract/data/disclosure.ts";
	import Icon from "./Icon.svelte";
	import type { IconName } from "./icons.ts";
	import { popoverRow, popoverRule } from "./styles.ts";
	import { ownRowName, type Viewing } from "./viewing.ts";

	/** View as's rows (mockup `#kvp`, `renderVA`), loaded the first time the menu opens: the viewer's own row and what
	 * each role sees. The rows are a listbox, one Tab stop (the chosen row, focused on open); Arrow Up and Down, Home and
	 * End move; Enter and Space choose. A row the viewer does not hold is disabled and says why; the Custom audiences row
	 * is a later release. */
	let {
		viewing,
		listboxId,
		onChoose,
	}: {
		viewing: Viewing;
		listboxId: string;
		onChoose: (value: ViewAs) => void;
	} = $props();

	let listbox: HTMLElement | undefined = $state();
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
	onMount(() => {
		listbox?.querySelector<HTMLElement>("[aria-selected=true]")?.focus();
	});
</script>

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
			onclick={() => onChoose(option.value)}
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
