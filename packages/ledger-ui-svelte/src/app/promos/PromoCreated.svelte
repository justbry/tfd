<script lang="ts">
	import { maskCode, type Promo } from "$contract/data/ledger.ts";
	import { Button } from "$lib/components/ui/button/index.ts";
	import * as Dialog from "$lib/components/ui/dialog/index.ts";
	import { Input } from "$lib/components/ui/input/index.ts";
	import PaneIcon from "../PaneIcon.svelte";
	import { control, field, fieldLabel, footer, modal, muted } from "../plans/styles.ts";

	/** The created promo (mockup `ACT.code`'s second step): its full code, shown only now; copying it; and the two things no
	 * route provides yet (a checkout link, mailing the code), off with their reasons. */
	let {
		schoolName,
		promo,
		summary,
		copy,
		onDone,
	}: {
		schoolName: string;
		promo: Promo;
		summary: string;
		copy: (code: string) => void;
		onDone: () => void;
	} = $props();
	const ids = $props.id();
</script>

<Dialog.Root open onOpenChange={(open) => !open && onDone()}>
	<Dialog.Content
		showCloseButton={false}
		class={[modal, "top-10 translate-y-0"]}
		overlayClass="bg-black/50 supports-backdrop-filter:backdrop-blur-none"
		data-test="dialog"
		onOpenAutoFocus={(event) => {
			event.preventDefault();
			document.querySelector<HTMLElement>("[data-test=dialog-confirm]")?.focus();
		}}
	>
		<Dialog.Title>
			{#snippet child({ props })}
				<h3 {...props} class="m-0 text-[14px] font-semibold" data-test="dialog-title">Promo created · {schoolName}</h3>
			{/snippet}
		</Dialog.Title>
		<Dialog.Description class={muted} data-test="promo-created-summary">{summary}</Dialog.Description>
		<div
			class="my-3 mb-2 rounded-[10px] border border-border bg-secondary p-3.5 text-center font-mono text-[16px] tracking-[0.05em] break-all select-all"
			data-test="promo-created-code"
		>
			{promo.code}
		</div>
		<div class="flex flex-wrap items-center gap-1.5">
			<Button variant="primary" size="tool" onclick={() => copy(promo.code)}><PaneIcon name="copy" />Copy code</Button>
			<Button variant="tool" size="tool" disabled title="Checkout links are not available yet."
				><PaneIcon name="ext" />Copy checkout link</Button
			>
		</div>
		<p class={[muted, "mt-2.5 mb-0"]} data-test="promo-created-note">
			The full code is shown only now. Later it appears masked ({maskCode(promo.code)}); an owner can still reveal it.
		</p>
		{#if promo.type !== "member"}
			<div class={field}>
				<label class={fieldLabel} for={`${ids}-email`}>Email it to the recipient (optional)</label>
				<div class="flex flex-wrap items-center gap-1.5">
					<Input id={`${ids}-email`} type="email" placeholder="name@example.com" class={[control, "flex-1"]} data-test="promo-email-input" />
					<Button variant="tool" size="tool" disabled title="Emailing a code is not available yet."
						><PaneIcon name="mail" />Send</Button
					>
				</div>
			</div>
		{/if}
		<div class={footer}>
			<Button variant="primary" size="tool" data-test="dialog-confirm" onclick={onDone}>Done</Button>
		</div>
	</Dialog.Content>
</Dialog.Root>
