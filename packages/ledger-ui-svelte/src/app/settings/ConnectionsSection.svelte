<script lang="ts">
	import {
		pinMinimumLength,
		restrictedKeyMessage,
		type StripeConnection,
		stripePermissions,
		type ZeffyConnection,
		zeffyKeyMinimumLength,
	} from "$contract/data/settings.ts";
	import { Button } from "$lib/components/ui/button/index.ts";
	import { messageFor } from "../../effect/messages.ts";
	import { useApp } from "../context.ts";
	import Icon from "../Icon.svelte";
	import { notify, notifySuccess } from "../panes/writes.ts";
	import PaneIcon from "../PaneIcon.svelte";
	import ConnectionRow from "./ConnectionRow.svelte";
	import DialogField from "./DialogField.svelte";
	import { DialogWrite } from "./dialog-write.svelte.ts";
	import SettingsDialog from "./SettingsDialog.svelte";
	import { gapError, type SettingsAction } from "./settings-model.ts";
	import { badgeClass, heading, inlineIcon, muted, permissions, preview, sectionNote } from "./styles.ts";

	/** Connections you give us (mockup `zeffyModal`, `stripeModal`, `permModal`): Stripe, Zeffy, and the bucket that comes
	 * later. Saving or removing a key asks for the family PIN (Zeffy's save does not) and goes through the Writer; the row
	 * shows the new state only once the Writer answered. A build that has no route for Zeffy's key says so on the
	 * button (disabled, focusable, its reason a line the button is described by), never in a dialog that cannot work. */
	let {
		school,
		stripe,
		zeffy,
		writeOff,
		gaps,
		onStripe,
		onZeffy,
		onNotAvailable,
	}: {
		school: { id: string; name: string };
		stripe: StripeConnection;
		zeffy: ZeffyConnection;
		writeOff: { disabled: boolean; title: string | undefined; describedby: string | undefined };
		gaps: readonly SettingsAction[];
		onStripe: (stripe: StripeConnection) => void;
		onZeffy: (zeffy: ZeffyConnection) => void;
		onNotAvailable: (action: SettingsAction) => void;
	} = $props();

	const app = useApp();
	const ids = $props.id();
	let dialog = $state<"permissions" | "stripe" | "remove-stripe" | "zeffy" | "remove-zeffy" | null>(null);
	let ticket = 0;
	let shownTicket = $state(0);
	let restrictedKey = $state("");
	let pin = $state("");
	let apiKey = $state("");
	const writing = new DialogWrite(app);
	$effect(() => () => writing.leave());
	const zeffyGap = $derived(gaps.includes("zeffy"));
	const zeffyReason = $derived.by(() => {
		const message = messageFor(gapError("zeffy"));
		return `${message.title}: ${message.what} ${message.doThis}`;
	});
	const open = (which: NonNullable<typeof dialog>): void => {
		writing.failure = null;
		restrictedKey = "";
		pin = "";
		apiKey = "";
		ticket += 1;
		shownTicket = ticket;
		dialog = which;
	};
	const close = (): void => {
		dialog = null;
		writing.failure = null;
	};
	$effect(() => {
		if (writing.failure?.kind === "not_available" && (dialog === "zeffy" || dialog === "remove-zeffy"))
			onNotAvailable("zeffy");
	});
	const saveStripe = (): void => {
		const request = { school: school.id, restrictedKey: restrictedKey.trim(), pin };
		const missing = stripe.connected ? stripe.missing : [];
		const account = school.name;
		const of = shownTicket;
		writing.run(
			(writer) => writer.saveStripeKey(request),
			() => {
				onStripe({ connected: true, account, mode: "live", last4: request.restrictedKey.slice(-4), missing });
				if (shownTicket === of) dialog = null;
				notifySuccess(app, "Stripe key saved. Run Check to confirm permissions.");
			},
		);
	};
	const removeStripe = (): void => {
		const request = { school: school.id, pin };
		const of = shownTicket;
		writing.run(
			(writer) => writer.removeStripeKey(request),
			() => {
				onStripe({ connected: false });
				if (shownTicket === of) dialog = null;
			},
		);
	};
	const saveZeffy = (): void => {
		const request = { school: school.id, apiKey: apiKey.trim() };
		const of = shownTicket;
		writing.run(
			(writer) => writer.saveZeffyKey(request),
			() => {
				onZeffy({ connected: true, last4: request.apiKey.slice(-4) });
				if (shownTicket === of) dialog = null;
				notifySuccess(app, "Zeffy connected.");
			},
		);
	};
	const removeZeffy = (): void => {
		const request = { school: school.id, pin };
		const of = shownTicket;
		writing.run(
			(writer) => writer.removeZeffyKey(request),
			() => {
				onZeffy({ connected: false });
				if (shownTicket === of) dialog = null;
			},
		);
	};
	const keyLine = $derived(restrictedKeyMessage(restrictedKey));
	const mistake = $derived(restrictedKey.trim() !== "" && !keyLine.ok && !keyLine.text.startsWith("Keep typing"));
	const missing = $derived(stripe.connected ? stripe.missing : []);
</script>

{#snippet removeButton(test: string, label: string, onclick: () => void, gapped: boolean)}
	<Button
		variant="tool"
		size="tool-small"
		class="border-destructive text-destructive aria-disabled:cursor-not-allowed aria-disabled:opacity-40"
		data-test={test}
		aria-label={label}
		disabled={writeOff.disabled}
		aria-disabled={gapped && !writeOff.disabled ? "true" : undefined}
		aria-describedby={writeOff.describedby ?? (gapped ? `${ids}-zeffy-gap` : undefined)}
		title={writeOff.title ?? (gapped ? zeffyReason : undefined)}
		onclick={() => {
			if (!gapped) onclick();
		}}
	>
		<PaneIcon name="trash" />
	</Button>
{/snippet}
{#snippet zeffyAction(label: string, primary: boolean)}
	<Button
		variant={primary ? "primary" : "tool"}
		size="tool-small"
		class="aria-disabled:cursor-not-allowed aria-disabled:opacity-40"
		data-test="zeffy-connect"
		disabled={writeOff.disabled}
		aria-disabled={zeffyGap && !writeOff.disabled ? "true" : undefined}
		aria-describedby={writeOff.describedby ?? (zeffyGap ? `${ids}-zeffy-gap` : undefined)}
		title={writeOff.title ?? (zeffyGap ? zeffyReason : undefined)}
		onclick={() => {
			if (!zeffyGap) open("zeffy");
		}}>{label}</Button
	>
{/snippet}

<h5 class={heading} id="conn" data-test="settings-section" data-section="connections">
	<PaneIcon name="plug" /> Connections <span class={[muted, sectionNote]}>you give us</span>
</h5>
<ConnectionRow icon="card" test="connection-row" attributes={{ "data-connection": "stripe" }} detailTest="connection-detail">
	{#snippet name()}<b>Stripe</b>{/snippet}
	{#snippet badges()}
		{#if stripe.connected}
			<span class={badgeClass("ok")}><Icon name="check" class="mr-0.5 size-[11px]" />Connected</span>
			<span class={badgeClass()}>{stripe.mode}</span>
			{#if stripe.missing.length > 0}
				<span class={badgeClass("warn")}>
					<Icon name="alert" class="mr-0.5 size-[11px]" />{stripe.missing.length} permission{stripe.missing.length === 1 ? "" : "s"} missing
				</span>
			{/if}
		{:else}
			<span class={badgeClass()}>Not connected</span>
		{/if}
	{/snippet}
	{#snippet detail()}
		{stripe.connected ? `${stripe.account} · key ending ${stripe.last4}` : "Sell plans and take payments through your own Stripe account."}
	{/snippet}
	{#snippet actions()}
		{#if stripe.connected}
			<Button variant="tool" size="tool-small" data-test="stripe-check" onclick={() => open("permissions")}>
				<PaneIcon name="check" />Check
			</Button>
			<Button variant="tool" size="tool-small" data-test="stripe-connect" disabled={writeOff.disabled} aria-describedby={writeOff.describedby} title={writeOff.title} onclick={() => open("stripe")}>Replace</Button>
			{@render removeButton("stripe-remove", "Remove the Stripe key", () => open("remove-stripe"), false)}
		{:else}
			<Button variant="primary" size="tool-small" data-test="stripe-connect" disabled={writeOff.disabled} aria-describedby={writeOff.describedby} title={writeOff.title} onclick={() => open("stripe")}>Connect</Button>
		{/if}
	{/snippet}
</ConnectionRow>
<ConnectionRow icon="heart" test="connection-row" attributes={{ "data-connection": "zeffy" }} detailTest="connection-detail">
	{#snippet name()}<b>Zeffy</b>{/snippet}
	{#snippet badges()}
		{#if zeffy.connected}
			<span class={badgeClass("ok")}><Icon name="check" class="mr-0.5 size-[11px]" />Connected</span>
		{:else}
			<span class={badgeClass()}>Not connected</span>
		{/if}
	{/snippet}
	{#snippet detail()}
		{zeffy.connected ? `Reads fundraising payments · key ending ${zeffy.last4}` : "Record donations from your Zeffy campaigns in your ledger."}
	{/snippet}
	{#snippet actions()}
		{#if zeffy.connected}
			{@render zeffyAction("Replace", false)}
			{@render removeButton("zeffy-remove", "Remove the Zeffy key", () => open("remove-zeffy"), zeffyGap)}
		{:else}
			{@render zeffyAction("Connect", true)}
		{/if}
	{/snippet}
</ConnectionRow>
{#if zeffyGap}
	<div class={[muted, "mb-1 text-[10.5px]"]} id="{ids}-zeffy-gap" data-test="zeffy-gap" data-kind="not_available">
		<Icon name="info" class={inlineIcon} />{zeffyReason}
	</div>
{/if}
<ConnectionRow icon="cloud" test="connection-row" attributes={{ "data-connection": "bucket" }} detailTest="connection-detail">
	{#snippet name()}<b>Your own bucket (S3 or R2)</b>{/snippet}
	{#snippet badges()}<span class={badgeClass()}>Later</span>{/snippet}
	{#snippet detail()}Send a copy of your ledger to a bucket you own. Not available yet.{/snippet}
	{#snippet actions()}
		<Button variant="tool" size="tool-small" data-test="bucket-setup" disabled>Set up</Button>
	{/snippet}
</ConnectionRow>

{#if dialog === "permissions" && stripe.connected}
	{@const account = stripe.account}
	{@const last4 = stripe.last4}
	{#snippet mark(permission: string, good: boolean)}
		<div class={good ? "flex items-center gap-1.5 text-success" : "flex items-center gap-1.5 text-destructive"} data-test="permission-item" data-permission={permission} data-ok={String(good)}>
			<Icon name={good ? "check" : "xCircle"} /><span class="text-foreground">{permission}</span>
		</div>
	{/snippet}
	<SettingsDialog cancelable={false} confirm={{ label: "Done", onConfirm: close }} onCancel={close}>
		{#snippet heading()}<PaneIcon name="card" class="mr-1 inline" /> Stripe permissions{/snippet}
		{#snippet extra()}
			<Button variant="tool" size="tool" onclick={() => notify(app, { tone: "info", title: "Opening Stripe…" })}>
				<PaneIcon name="ext" />Open Stripe
			</Button>
		{/snippet}
		<div class={muted}>{account} · key ending {last4}</div>
		<h5 class={heading}>Needed to sell plans</h5>
		<div class={permissions}>
			{#each [...stripePermissions.write, ...stripePermissions.read] as permission (permission)}{@render mark(permission, true)}{/each}
		</div>
		<h5 class={heading}>Needed for Send invoice and Refund</h5>
		<div class={permissions}>
			{#each stripePermissions.money as permission (permission)}{@render mark(permission, !missing.includes(permission))}{/each}
		</div>
		{#if missing.length > 0}
			<div class={preview}>
				<b class="text-destructive">{missing.length} missing.</b>
				{missing.join(" and ")} stay disabled until you add {missing.length === 1 ? "it" : "them"} to the key in Stripe (Developers, API keys).
			</div>
		{:else}
			<div class={[preview, "text-success"]}><Icon name="check" class={inlineIcon} />All permissions are present.</div>
		{/if}
	</SettingsDialog>
{:else if dialog === "stripe"}
	<SettingsDialog
		busy={writing.busy}
		failure={writing.failure}
		confirm={{ label: "Save key", icon: "check", disabled: !(keyLine.ok && pin.length >= pinMinimumLength), onConfirm: saveStripe }}
		onCancel={close}
	>
		{#snippet heading()}<PaneIcon name="card" class="mr-1 inline" /> {stripe.connected ? "Replace" : "Connect"} Stripe{/snippet}
		<p class={[muted, "my-2"]}>
			Paste a <b>restricted</b> key from your own Stripe account. It is stored encrypted and only its last four characters are shown afterwards.
		</p>
		<DialogField label="Restricted key" name="key" bind:value={restrictedKey} placeholder="rk_live_…" />
		<DialogField label="Your family PIN" name="pin" bind:value={pin} numeric />
		<div class={preview} data-test="dialog-message">
			{#if keyLine.ok}<Icon name="check" class={inlineIcon} />{/if}
			{#if mistake}<b class="text-destructive">{keyLine.text}</b>{:else}{keyLine.text}{/if}
		</div>
	</SettingsDialog>
{:else if dialog === "zeffy"}
	<SettingsDialog
		busy={writing.busy}
		failure={writing.failure}
		confirm={{ label: "Save key", icon: "check", disabled: apiKey.trim().length < zeffyKeyMinimumLength, onConfirm: saveZeffy }}
		onCancel={close}
	>
		{#snippet heading()}<PaneIcon name="heart" class="mr-1 inline" /> {zeffy.connected ? "Replace" : "Connect"} Zeffy{/snippet}
		<p class={[muted, "my-2"]}>
			Paste the API key a Zeffy admin created. It is stored encrypted, used only to read payments, and never shown again.
		</p>
		<DialogField label="Zeffy API key" name="apiKey" bind:value={apiKey} />
		<div class={preview}>
			<Icon name="info" class={inlineIcon} />Zeffy doesn't document webhook signing, so every payment is verified by looking it up in Zeffy before it is recorded.
		</div>
	</SettingsDialog>
{:else if dialog === "remove-stripe" || dialog === "remove-zeffy"}
	{@const stripeKey = dialog === "remove-stripe"}
	<SettingsDialog
		busy={writing.busy}
		failure={writing.failure}
		confirm={{ label: "Remove", icon: "trash", danger: true, disabled: pin.length < pinMinimumLength, onConfirm: stripeKey ? removeStripe : removeZeffy }}
		onCancel={close}
	>
		{#snippet heading()}Remove {stripeKey ? "the Stripe key" : "the Zeffy key"}?{/snippet}
		<p class={[muted, "my-2"]}>
			{stripeKey ? "Plans stop being sold and new payments can't be taken until you connect again." : "Fundraising payments stop being recorded."}
		</p>
		<DialogField label="Your family PIN" name="pin" bind:value={pin} numeric />
	</SettingsDialog>
{/if}
