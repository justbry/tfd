<script lang="ts">
	import { onMount } from "svelte";
	import { maxLiveKeysPerKind, type ApiKey, type ApiKeyKind, type CreatedKey } from "$contract/data/settings.ts";
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
	import {
		copyFailedToast,
		gapError,
		keyBadges,
		keyHints,
		keyIcons,
		keyKinds,
		keyMenuLabels,
		keyNames,
		type SettingsAction,
	} from "./settings-model.ts";
	import { badgeClass, codeBig, heading, muted, pre, row, sectionNote } from "./styles.ts";

	/** Keys and access we give you (mockup `newItem`, `crow`): the school's keys and ledger read credentials. Create asks
	 * for a label, then shows the secret once; Revoke asks first. These go through the Writer (buzz-school's key routes),
	 * not the config: the list is the stored settings plus what this session has done since, applied when the Writer
	 * answered. A kind the build cannot create says so before the dialog, never after a made-up key. */
	let {
		school,
		keys,
		writeOff,
		gaps,
		onCreated,
		onRevoked,
		onNotAvailable,
	}: {
		school: { id: string };
		keys: ApiKey[];
		writeOff: { disabled: boolean; title: string | undefined; describedby: string | undefined };
		gaps: readonly SettingsAction[];
		onCreated: (key: ApiKey) => void;
		onRevoked: (id: string) => void;
		onNotAvailable: (action: SettingsAction) => void;
	} = $props();

	const app = useApp();
	const menuId = $props.id();
	let menuOpen = $state(false);
	let menuButton = $state<HTMLButtonElement | null>(null);
	let menu = $state<HTMLElement | null>(null);
	/** The dialog on screen; a write that answers for a dialog that is gone finds a different ticket and shows nothing more. */
	let step = $state<
		| { kind: "create"; keyKind: ApiKeyKind; ticket: number }
		| { kind: "created"; created: CreatedKey; ticket: number }
		| { kind: "revoke"; key: ApiKey; ticket: number }
		| null
	>(null);
	let ticket = 0;
	const writing = new DialogWrite(app);
	let label = $state("");
	$effect(() => () => writing.leave());

	const reasonOf = (kind: ApiKeyKind): string | null => {
		if (kind !== "rd" || !gaps.includes("ledger-read-credential")) return null;
		const message = messageFor(gapError("ledger-read-credential"));
		return `${message.title}: ledger read credentials have no route yet`;
	};

	const closeMenu = (returnFocus: boolean): void => {
		menuOpen = false;
		if (returnFocus) menuButton?.focus();
	};
	onMount(() => {
		const onClick = (event: MouseEvent): void => {
			const target = event.target;
			if (menuOpen && target instanceof Node && !menu?.contains(target) && !menuButton?.contains(target))
				closeMenu(false);
		};
		document.addEventListener("click", onClick);
		return () => document.removeEventListener("click", onClick);
	});
	const onMenuKeyDown = (event: KeyboardEvent): void => {
		if (event.key === "Escape") {
			event.stopPropagation();
			closeMenu(true);
			return;
		}
		const items = [...(menu?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? [])];
		const at = items.indexOf(document.activeElement as HTMLElement);
		const moves: Record<string, number> = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: items.length - 1 };
		const to = moves[event.key];
		if (to === undefined || items.length === 0) return;
		event.preventDefault();
		items[(to + items.length) % items.length]?.focus();
	};

	const startCreate = (kind: ApiKeyKind): void => {
		closeMenu(false);
		const live = keys.filter((key) => key.kind === kind).length;
		if (kind !== "rd" && live >= maxLiveKeysPerKind) {
			notify(app, { tone: "info", title: "Two live keys of this kind already. Revoke one first." });
			return;
		}
		label = "";
		ticket += 1;
		step = { kind: "create", keyKind: kind, ticket };
	};
	const create = (keyKind: ApiKeyKind, ofTicket: number): void => {
		// The school and the label as they were at the click: a retry sends the same request to the same school.
		const request = { school: school.id, kind: keyKind, label: label || "No label" };
		writing.run(
			(writer) => writer.createKey(request),
			(created) => {
				onCreated(created.key);
				if (step?.ticket === ofTicket) {
					ticket += 1;
					step = { kind: "created", created, ticket };
				}
			},
		);
	};
	const revoke = (key: ApiKey, ofTicket: number): void => {
		const request = { school: school.id, keyId: key.id };
		writing.run(
			(writer) => writer.revokeKey(request),
			() => {
				onRevoked(key.id);
				if (step?.ticket === ofTicket) step = null;
				notifySuccess(app, "Revoked.");
			},
		);
	};
	const copy = async (text: string, done: string): Promise<void> => {
		try {
			await navigator.clipboard.writeText(text);
			notifySuccess(app, done);
		} catch {
			notify(app, { tone: "warning", title: copyFailedToast });
		}
	};
	const close = (): void => {
		step = null;
		writing.failure = null;
	};
	$effect(() => {
		if (writing.failure?.kind === "not_available" && step?.kind === "create" && step.keyKind === "rd")
			onNotAvailable("ledger-read-credential");
	});
</script>

<h5 class={heading} data-test="settings-section" data-section="keys">
	<Icon name="key" /> Keys and access <span class={[muted, sectionNote]}>we give you</span>
</h5>
{#each keys as key (key.id)}
	<ConnectionRow
		icon={keyIcons[key.kind]}
		test="key-row"
		attributes={{ "data-key": key.id }}
		detailTest="key-detail"
	>
		{#snippet name()}<b data-test="key-label">{key.label}</b>{/snippet}
		{#snippet badges()}<span class={badgeClass()}>{keyBadges[key.kind]}</span>{/snippet}
		{#snippet detail()}<span class="font-mono text-[10.5px]">{key.prefix}…</span> · used {key.used}{/snippet}
		{#snippet actions()}
			<Button
				variant="tool"
				size="tool-small"
				class="border-destructive px-1.5 py-1 text-destructive"
				data-test="key-revoke"
				data-key={key.id}
				aria-label={`Revoke ${key.label}`}
				disabled={writeOff.disabled}
				aria-describedby={writeOff.describedby}
				title={writeOff.title ?? "Revoke"}
				onclick={() => {
					ticket += 1;
					writing.failure = null;
					step = { kind: "revoke", key, ticket };
				}}
			>
				<PaneIcon name="trash" />
			</Button>
		{/snippet}
	</ConnectionRow>
{/each}
{#if keys.length === 0}
	<div class={muted} data-test="keys-empty">No keys yet.</div>
{/if}
<div class="relative mt-2 inline-block">
	<Button
		variant="tool"
		size="tool"
		bind:ref={menuButton}
		data-test="key-create"
		aria-haspopup="menu"
		aria-expanded={menuOpen}
		aria-controls={menuId}
		disabled={writeOff.disabled}
		aria-describedby={writeOff.describedby}
		title={writeOff.title}
		onclick={() => (menuOpen = !menuOpen)}
	>
		<Icon name="plus" />Create<Icon name="chevronDown" />
	</Button>
	{#if menuOpen}
		<!-- svelte-ignore a11y_interactive_supports_focus -->
		<div
			bind:this={menu}
			id={menuId}
			role="menu"
			class="absolute top-full left-0 z-(--layer-popover) mt-1 grid min-w-[210px] gap-px rounded-lg border border-border bg-popover p-1 shadow-popover"
			tabindex="-1"
			onkeydown={onMenuKeyDown}
		>
			{#each keyKinds as kind (kind)}
				{@const reason = reasonOf(kind)}
				<button
					type="button"
					role="menuitem"
					class="flex items-center gap-2 rounded-sm border-0 bg-transparent px-2 py-1.5 text-left text-foreground hover:bg-secondary focus-visible:bg-secondary aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
					data-test="key-create-option"
					data-kind={kind}
					aria-disabled={reason ? "true" : undefined}
					title={reason ?? undefined}
					onclick={() => {
						if (!reason) startCreate(kind);
					}}
				>
					<PaneIcon name={keyIcons[kind]} />{keyMenuLabels[kind]}
					{#if reason}<span class={muted}>Not available yet</span>{/if}
				</button>
			{/each}
		</div>
	{/if}
</div>

{#if step?.kind === "create"}
	{@const current = step}
	<SettingsDialog
		busy={writing.busy}
		failure={writing.failure}
		confirm={{ label: "Create", onConfirm: () => create(current.keyKind, current.ticket) }}
		onCancel={close}
	>
		{#snippet heading()}<PaneIcon name="key" class="mr-1 inline" /> Create {keyNames[current.keyKind]}{/snippet}
		<p class={[muted, "my-2"]}>{keyHints[current.keyKind]}</p>
		<DialogField label="Label" name="label" bind:value={label} placeholder="For example: Website" secret={false} />
	</SettingsDialog>
{:else if step?.kind === "created"}
	{@const created = step.created}
	{#if created.kind === "rd"}
		{@const credential = created.credential}
		{@const text = `endpoint  ${credential.endpoint}\nbucket    ${credential.bucket}\nprefix    ${credential.prefix}\nkey id    ${credential.keyId}\nsecret    ${credential.secret}`}
		<SettingsDialog cancelable={false} confirm={{ label: "I stored it", onConfirm: close }} onCancel={close}>
			{#snippet heading()}Credential created{/snippet}
			<div class={muted}>The secret is shown once.</div>
			<div class={pre}>{text}</div>
			<div class={row}>
				<Button variant="primary" size="tool" onclick={() => copy(text, "Credential copied.")}><PaneIcon name="copy" />Copy all</Button>
			</div>
		</SettingsDialog>
	{:else}
		<SettingsDialog cancelable={false} confirm={{ label: "I stored it", onConfirm: close }} onCancel={close}>
			{#snippet heading()}Key created{/snippet}
			<div class={muted}>Shown once. Copy it now.</div>
			<div class={codeBig}>{created.secret}</div>
			<div class={row}>
				<Button variant="primary" size="tool" onclick={() => copy(created.secret, "Key copied.")}><PaneIcon name="copy" />Copy key</Button>
			</div>
			<p class={[muted, "my-2"]}>Only the SHA-256 and the first 15 characters are stored.</p>
		</SettingsDialog>
	{/if}
{:else if step?.kind === "revoke"}
	{@const current = step}
	<SettingsDialog
		busy={writing.busy}
		failure={writing.failure}
		confirm={{ label: "Revoke", icon: "trash", danger: true, onConfirm: () => revoke(current.key, current.ticket) }}
		onCancel={close}
	>
		{#snippet heading()}Revoke this {current.key.kind === "rd" ? "credential" : "key"}?{/snippet}
		<p class={[muted, "my-2"]}>
			<span class="font-mono text-[10.5px]">{current.key.prefix}…</span> ({current.key.label}). Anything using it stops working at once.
			This can't be undone.
		</p>
	</SettingsDialog>
{/if}
