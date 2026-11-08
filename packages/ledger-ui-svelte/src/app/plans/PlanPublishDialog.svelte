<script lang="ts">
	import { Button } from "$lib/components/ui/button/index.ts";
	import * as Dialog from "$lib/components/ui/dialog/index.ts";
	import Icon from "../Icon.svelte";
	import PaneIcon from "../PaneIcon.svelte";
	import type { PlanChange } from "./plans-menu.ts";
	import { control, field, fieldLabel, footer, heading, lock, modal, muted, preview } from "./styles.ts";

	const minimumPinLength = 4;
	const maximumPinLength = 6;

	/** The review before publishing (mockup `reviewModal`): each change with what it does on Stripe, who is affected, and
	 * for an owner the family PIN that enables Publish (the server checks it on the session). Escape, the backdrop and
	 * Cancel close it unless a publish is pending. */
	let {
		schoolName,
		fromVersion,
		changes,
		affectedMembers,
		owner,
		pending,
		onPublish,
		onCancel,
		pinField = $bindable(null),
	}: {
		schoolName: string;
		/** The live version, and the one publishing makes. */
		fromVersion: number;
		changes: PlanChange[];
		/** Active members of the live tiers the draft changes or removes. */
		affectedMembers: number;
		/** Only an owner publishes; an admin's draft waits for one. */
		owner: boolean;
		/** `publishMenu` is pending: the dialog stays until it resolves. */
		pending: boolean;
		/** Called with the family PIN typed; the pane's handler keeps it nowhere. */
		onPublish: (pin: string) => void;
		onCancel: () => void;
		/** The PIN field, for the message table's "Enter the PIN". */
		pinField?: HTMLInputElement | null;
	} = $props();

	let pin = $state("");
	const ids = $props.id();
	const publishEnabled = $derived(owner && pin.length >= minimumPinLength && !pending);
	const behaviour = $derived(pending ? "ignore" : "close");
</script>

<Dialog.Root open onOpenChange={(open) => !open && !pending && onCancel()}>
	<Dialog.Content
		showCloseButton={false}
		escapeKeydownBehavior={behaviour}
		interactOutsideBehavior={behaviour}
		class={[modal, "top-10 translate-y-0"]}
		overlayClass="bg-black/50 supports-backdrop-filter:backdrop-blur-none"
		data-test="plan-publish-dialog"
		onOpenAutoFocus={(event) => {
			event.preventDefault();
			document.querySelector<HTMLElement>("[data-test=plan-publish-cancel]")?.focus();
		}}
	>
		<Dialog.Title>
			{#snippet child({ props })}
				<h3 {...props} class="m-0 flex items-center gap-1 text-[14px] font-semibold"><PaneIcon name="upload" /> Review and publish</h3>
			{/snippet}
		</Dialog.Title>
		<Dialog.Description class="sr-only">Each change and what it does on Stripe, before it goes live.</Dialog.Description>
		<div class={muted} data-test="plan-publish-versions">{schoolName} · v{fromVersion} → v{fromVersion + 1}</div>
		{#each changes as change (`${change.kind}:${change.id}`)}
			<div data-test="plan-publish-change" data-plan={change.id}>
				<h5 class={[heading, "mt-3"]}>
					<PaneIcon name={change.kind === "tiers" ? "layers" : "gift"} />{" "}{change.name}
				</h5>
				{#each change.lines as line (line.title)}
					<div>
						{line.title}
						<div class={[muted, "ml-0.5"]}><PaneIcon name="plug" class="mr-1 inline align-[-2px]" /> {line.detail}</div>
					</div>
				{/each}
			</div>
		{/each}
		<div class={preview} data-test="plan-publish-summary">
			{#if affectedMembers > 0}
				New purchases get the new terms. <b>{affectedMembers} current member{affectedMembers === 1 ? "" : "s"}</b>
				{affectedMembers === 1 ? "keeps" : "keep"} the version they bought.
			{:else}
				No current members are affected.
			{/if}{" "}
			The change applies at once (it doesn't wait for the next local month).
		</div>
		{#if owner}
			<div class={field}>
				<label class={fieldLabel} for={`${ids}-pin`}>Your family PIN</label>
				<input
					id={`${ids}-pin`}
					bind:this={pinField}
					class={control}
					type="password"
					inputmode="numeric"
					maxlength={maximumPinLength}
					autocomplete="off"
					data-test="plan-publish-pin"
					bind:value={pin}
				/>
			</div>
		{:else}
			<div class={lock} data-test="plan-publish-lock">
				<Icon name="lock" /> Owners publish. You are an admin here, so your draft waits for an owner.
			</div>
		{/if}
		<div class={footer}>
			<Button variant="tool" size="tool" data-test="plan-publish-cancel" disabled={pending} onclick={onCancel}>Cancel</Button>
			<Button
				variant="primary"
				size="tool"
				data-test="plan-publish-go"
				title={owner ? undefined : "Owners publish"}
				disabled={!publishEnabled}
				onclick={() => onPublish(pin)}
			>
				<PaneIcon name="upload" />{pending ? "Publishing…" : `Publish v${fromVersion + 1}`}
			</Button>
		</div>
	</Dialog.Content>
</Dialog.Root>
