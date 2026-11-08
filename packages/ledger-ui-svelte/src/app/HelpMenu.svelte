<script lang="ts">
	import { Button } from "$lib/components/ui/button/index.ts";
	import * as Popover from "$lib/components/ui/popover/index.ts";
	import type { ToastInput } from "../effect/toast-model.ts";
	import Icon from "./Icon.svelte";
	import type { IconName } from "./icons.ts";
	import { popoverPanel, popoverRow, popoverRule } from "./styles.ts";

	/** The help menu (mockup `#hb`, `renderHP`): each link says what it opens in a toast; the prompt link says so
	 * only once the clipboard has taken the text, and says why when it could not. */
	let { onToast }: { onToast: (toast: ToastInput) => void } = $props();

	const assistantPrompt = [
		"You are helping an owner or admin of a school on atm, the bookings and payments service behind ledger.b4uni.com.",
		"Treat this as read-only context: you can read what I paste from the ledger, and nothing you say changes plans, bookings, promos or payments.",
		"The ledger is an append-only list of events; reports come from it through hledger and DuckDB, and apps use the School SDK, @b4uni/school.",
		"When you are not sure what an event means, say so and point me to the ledger event reference.",
	].join(" ");
	const links: Array<{
		label: string;
		detail?: string;
		icon: IconName;
		toast: string;
		copy?: string;
	}> = [
		{
			label: "School SDK",
			detail: "@b4uni/school",
			icon: "box",
			toast: "Opening the School SDK readme…",
		},
		{
			label: "Ledger event reference",
			icon: "list",
			toast: "Opening the event reference…",
		},
		{
			label: "Reports with hledger and DuckDB",
			icon: "chart",
			toast: "Opening the recipes…",
		},
		{
			label: "Copy a prompt for an AI assistant",
			icon: "copy",
			toast: "Prompt copied. It gives an assistant read-only context.",
			copy: assistantPrompt,
		},
	];

	let open = $state(false);

	const follow = async (link: (typeof links)[number]): Promise<void> => {
		open = false;
		if (!link.copy) {
			onToast({ tone: "info", title: link.toast });
			return;
		}
		try {
			await navigator.clipboard.writeText(link.copy);
			onToast({ tone: "success", title: link.toast });
		} catch (error) {
			onToast({
				tone: "error",
				title: "Could not copy the prompt",
				detail:
					error instanceof Error && error.message
						? error.message
						: "The browser blocked the clipboard.",
				doThis: "Allow clipboard access for this page, then try again.",
			});
		}
	};
</script>

<Popover.Root bind:open>
	<Popover.Trigger>
		{#snippet child({ props })}
			<Button
				{...props}
				variant="box"
				size="box"
				id="hb"
				data-test="help-button"
				title="Help and SDK"
				aria-label="Help and SDK"
			>
				<Icon name="help" />
			</Button>
		{/snippet}
	</Popover.Trigger>
	<Popover.Content align="end" class={popoverPanel} data-test="help-panel">
		{#each links as link, index (link.label)}
			{#if index === links.length - 1}<hr class={popoverRule} />{/if}
			<button type="button" class={popoverRow} data-test="help-link" onclick={() => follow(link)}>
				<Icon name={link.icon} />
				<span class="flex-1">{link.label}</span>
				{#if link.detail}<span class="text-muted-foreground">{link.detail}</span>{/if}
			</button>
		{/each}
	</Popover.Content>
</Popover.Root>
