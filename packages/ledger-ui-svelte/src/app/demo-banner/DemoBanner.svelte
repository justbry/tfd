<script lang="ts">
	import "./demo-banner.css";
	import { tick } from "svelte";
	import * as Alert from "$lib/components/ui/alert/index.ts";
	import { Button } from "$lib/components/ui/button/index.ts";
	import {
		type DemoReason,
		foldedText,
		notSavedText,
		reasonText,
		reloadLabel,
	} from "./demo-banner-model.ts";

	/** The large alert pinned to the top right while the HTTP build shows only the demo schools (the ledger Worker's
	 * demo scenarios: fictional schools and people). It says they are demo scenarios and read-only, and links to B4
	 * Uni's sign-in page; B4 Uni cannot send a visitor back to the ledger after signing in, so "I have signed in"
	 * asks the token again (the entry reloads the page). It folds to a small pill so that it never hides the controls
	 * under it for good, and focus follows the fold. Pinned above the settings sheet and below the toasts. */
	let {
		reason,
		signInUrl,
		onSignedIn,
	}: {
		reason: DemoReason;
		signInUrl: string;
		onSignedIn: () => void;
	} = $props();

	let folded = $state(false);
	let hideButton = $state<HTMLElement | null>(null);
	let pill = $state<HTMLElement | null>(null);
	const frame = "fixed top-3 right-3 z-90 shadow-[0_8px_24px_rgba(0,0,0,0.18)]";

	const fold = async (next: boolean): Promise<void> => {
		folded = next;
		await tick();
		(next ? pill : hideButton)?.focus();
	};
</script>

{#if folded}
	<Button
		bind:ref={pill}
		variant="tool"
		class={[frame, "border-2 border-warning bg-popover px-3 py-1.5 font-semibold text-foreground"]}
		data-test="demo-banner-folded"
		onclick={() => fold(false)}>{foldedText}</Button
	>
{:else}
	<Alert.Root
		variant="warning"
		aria-label="Demo data"
		class={[frame, "w-[min(380px,calc(100vw-24px))] gap-0 px-[18px] py-4"]}
		data-test="demo-banner"
	>
		<div class="flex items-center gap-2">
			<strong class="text-[17px] text-warning">Demo data</strong>
			<span class="flex-1"></span>
			<Button
				bind:ref={hideButton}
				variant="tool"
				size="tool-small"
				aria-label="Fold the demo alert"
				onclick={() => fold(true)}>Hide</Button
			>
		</div>
		<p class="mt-2 mb-1 text-[14px] leading-[1.45]">{reasonText[reason]}</p>
		<p class="mb-3 text-[13px] text-muted-foreground" data-test="demo-banner-not-saved">{notSavedText}</p>
		<div class="flex flex-wrap gap-2">
			{#if reason === "signed_out"}
				<Button variant="primary" href={signInUrl} class="h-auto px-4 py-2 text-[15px]" data-test="sign-in"
					>Sign in</Button
				>
			{/if}
			<Button variant="tool" size="tool" onclick={onSignedIn}>{reloadLabel(reason)}</Button>
		</div>
	</Alert.Root>
{/if}
