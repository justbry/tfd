<script lang="ts">
	import type { ViewAs } from "$contract/data/disclosure.ts";
	import { Button } from "$lib/components/ui/button/index.ts";
	import * as Popover from "$lib/components/ui/popover/index.ts";
	import { toUiError } from "../effect/ui-error.ts";
	import Icon from "./Icon.svelte";
	import LoadFailed from "./LoadFailed.svelte";
	import { popoverPanel } from "./styles.ts";
	import { ownRowName, type Viewing } from "./viewing.ts";

	/** View as (mockup `#kview`): the button names the row viewed, and takes the warning colour while previewing; its
	 * rows (ViewAsPanel) load the first time it opens, so that the first page load carries the button only. */
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
	const listboxId = $props.id();
	const ownName = $derived(ownRowName(viewing.disclosure));
	let panel: Promise<typeof import("./ViewAsPanel.svelte")> | null = $state(null);
	$effect(() => {
		if (open && !panel) panel = import("./ViewAsPanel.svelte");
	});
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
		onOpenAutoFocus={(event) => event.preventDefault()}
	>
		{#if panel}
			{#await panel then { default: ViewAsPanel }}
				<ViewAsPanel {viewing} {listboxId} onChoose={choose} />
			{:catch failure}
				<LoadFailed error={toUiError(failure)} />
			{/await}
		{/if}
	</Popover.Content>
</Popover.Root>
