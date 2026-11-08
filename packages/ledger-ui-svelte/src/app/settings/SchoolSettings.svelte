<script lang="ts">
	import "./settings.css";
		import { onDestroy } from "svelte";
	import type { School } from "$contract/data/types.ts";
	import type { ApiKey, StripeConnection, ZeffyConnection } from "$contract/data/settings.ts";
	import { read } from "../../effect/run.ts";
	import { ConfigEditor } from "../config/config-editor.svelte.ts";
	import { useApp } from "../context.ts";
	import Icon from "../Icon.svelte";
	import type { Viewing } from "../viewing.ts";
	import BasisSection from "./BasisSection.svelte";
	import BooksSection from "./BooksSection.svelte";
	import ConnectionsSection from "./ConnectionsSection.svelte";
	import KeysSection from "./KeysSection.svelte";
	import RulesSection from "./RulesSection.svelte";
	import {
		disclosureSeed,
		exitPreviewTitle,
		knownGaps,
		moneyOf,
		rulesSeed,
		type SettingsAction,
		settingsSeed,
		withSessionChanges,
	} from "./settings-model.ts";
	import { lock, muted, schoolHead, sectionNote } from "./styles.ts";

	/** The school's settings in the drawer (mockup `settings()`): the school's heading, the owners-only line, Accounting
	 * basis, Booking rules, School books (the disclosure table and its override editor, or a lock panel for a viewer
	 * below the admins), Keys and access, Connections. The basis, the rules and the disclosure are three objects of the
	 * ledger's config, read with their ETags (a school with none stored yet starts from the Reader's) and written by the
	 * Worker's verify and PUT; owners only. The keys and connections go through the Writer. An admin reads; while
	 * previewing, every write control is disabled. */
	let { school, viewing }: { school: School; viewing: Viewing } = $props();

	const app = useApp();
	const readonlyId = $props.id();
	// svelte-ignore state_referenced_locally
	const schoolId = school.id;
	// The three objects of this school; a school switch makes a new component, so the id is one for its life.
	const settings = new ConfigEditor({
		app,
		school: schoolId,
		name: "settings",
		seed: { read: () => read(async (reader) => settingsSeed(await reader.settings(schoolId))) },
		owner: `settings-${schoolId}-settings`,
		verifySeed: false,
	});
	const rules = new ConfigEditor({
		app,
		school: schoolId,
		name: "booking-rules",
		seed: { read: () => read(async (reader) => rulesSeed(await reader.settings(schoolId))) },
		owner: `settings-${schoolId}-rules`,
		verifySeed: false,
	});
	const books = new ConfigEditor({
		app,
		school: schoolId,
		name: "disclosure",
		seed: { value: () => disclosureSeed(viewing.disclosure) },
		owner: `settings-${schoolId}-books`,
		verifySeed: false,
	});
	settings.load();
	rules.load();
	books.load();
	onDestroy(() => {
		for (const editor of [settings, rules, books]) editor.dispose();
	});

	const own = $derived(viewing.option.value === "owner");
	const writeOff = $derived({
		disabled: !own,
		title: viewing.preview ? exitPreviewTitle : undefined,
		/** What explains an off control to a screen reader: the owners-only line. */
		describedby: own ? undefined : readonlyId,
	});
	const money = $derived(moneyOf(school.currency));
	const httpBuild = import.meta.env.VITE_LEDGER_SOURCE === "http";
	let learned = $state<SettingsAction[]>([]);
	const gaps = $derived([...knownGaps(httpBuild), ...learned]);
	const learn = (action: SettingsAction): void => {
		if (!learned.includes(action)) learned = [...learned, action];
	};

	/** What this session has done through the Writer, applied once it answered. */
	let added = $state<ApiKey[]>([]);
	let revoked = $state<string[]>([]);
	let stripeNow = $state<StripeConnection | null>(null);
	let zeffyNow = $state<ZeffyConnection | null>(null);
	const ready = $derived(settings.phase === "ready" && settings.value !== null);
	const view = $derived(
		settings.value ? withSessionChanges(settings.value, { added, revoked, stripe: stripeNow, zeffy: zeffyNow }) : null,
	);
</script>

<div class={schoolHead} data-test="settings-school">
	<Icon name="building" /> {school.name} <span class={[muted, sectionNote]}>school settings</span>
</div>
{#if !own}
	<div class={lock} id={readonlyId} data-test="settings-readonly">
		<Icon name="lock" /> Owners only. You are an admin here: you can look, not change.
	</div>
{/if}
<BasisSection editor={settings} {money} {writeOff} />
<BooksSection editor={books} {school} {viewing} {own} {money} publicOpening={!gaps.includes("disclosure-public")} />
{#if view}
	<KeysSection
		{school}
		keys={view.keys}
		{writeOff}
		{gaps}
		onCreated={(key) => (added = [...added, key])}
		onRevoked={(id) => (revoked = [...revoked, id])}
		onNotAvailable={learn}
	/>
	<ConnectionsSection
		{school}
		stripe={view.stripe}
		zeffy={view.zeffy}
		{writeOff}
		{gaps}
		onStripe={(stripe) => (stripeNow = stripe)}
		onZeffy={(zeffy) => (zeffyNow = zeffy)}
		onNotAvailable={learn}
	/>
{/if}
<RulesSection editor={rules} unit={school.creditUnit.one} {writeOff} />
