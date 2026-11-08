<script lang="ts">
	import "./members.css";
	import { Effect } from "effect";
	import { parsePeriod, snapPeriod } from "$contract/app/period.ts";
	import { formatRoute, type Route } from "$contract/app/route.ts";
	import type {
		Capabilities,
		InvoiceItem,
		Member,
		MembersSummary,
		Person,
		SwitchTier,
	} from "$contract/data/members.ts";
	import type { School } from "$contract/data/types.ts";
	import type { AppServices } from "../../effect/app-layer.ts";
	import { read } from "../../effect/run.ts";
	import type { UiError } from "../../effect/ui-error.ts";
	import { useApp } from "../context.ts";
	import LoadFailed from "../LoadFailed.svelte";
	import { retryFor } from "../panes/retry-for.ts";
	import LockPanel from "../panes/LockPanel.svelte";
	import { type RetryingRead, retryingRead } from "../retrying-read.ts";
	import type { Viewing } from "../viewing.ts";
	import { rosterLock, viewerOf } from "./members-model.ts";
	import Roster from "./Roster.svelte";

	/** The Members tab (mockup `members()`): loads what the roster needs for the school and the money period, then
	 * hands it to `Roster`. The money period is the hash's `month=`, else the one the school's Dashboard opens on,
	 * snapped to what the viewed audience may see. Each read is its own: the members, the people, the summary and the
	 * capabilities are what the roster cannot show without (a read that fails, `not_available` included, is the
	 * pane's message in the message table's words, with Retry where the message has one, never an empty table or a
	 * 0); the income, the invoice items and the plans are shown or offered apart, each with its own message. Leaving
	 * the pane lets every read go, with no toast. `onRendered` says when the route's roster, its lock panel or its
	 * message is on screen. */
	let {
		route,
		school,
		viewing,
		navigate,
		onRendered,
	}: {
		route: Route;
		school: School;
		viewing: Viewing;
		navigate: (route: Route) => void;
		onRendered: (hash: string) => void;
	} = $props();

	const app = useApp();
	const viewer = $derived(viewerOf(viewing));
	const period = $derived(
		snapPeriod(parsePeriod(route.query.get("month") ?? school.dashboardOpensOn ?? null, app.calendar.today), viewing.view),
	);

	type Slot<Value> = { key: string; value: Value } | { key: string; failure: UiError } | null;
	let members = $state<Slot<Member[]>>(null);
	let people = $state<Slot<Person[]>>(null);
	let summary = $state<Slot<MembersSummary>>(null);
	let capabilities = $state<Slot<Capabilities>>(null);
	let invoiceItems = $state<Slot<InvoiceItem[]>>(null);
	let switchTiers = $state<Slot<SwitchTier[]>>(null);
	let income = $state<Slot<number>>(null);
	let busy = $state<Record<string, boolean>>({});
	const readers: Record<string, RetryingRead> = {};
	const essential = ["members", "people", "summary", "capabilities"] as const;
	type Essential = (typeof essential)[number];

	/** Every page of the members list (brief A item 1 pages at 100). */
	const allMembers = (schoolId: string) =>
		Effect.gen(function* () {
			const all: Member[] = [];
			let cursor: string | undefined;
			do {
				const asked = cursor;
				const page = yield* read((reader) =>
					reader.members(asked === undefined ? { schoolId } : { schoolId, cursor: asked }),
				);
				all.push(...page.members);
				cursor = page.nextCursor ?? undefined;
			} while (cursor !== undefined);
			return all;
		});

	/** One read with its own toast owner: its value or its failure lands in `set`, tagged with what was asked. */
	function start<Value>(
		name: string,
		key: string,
		load: () => Effect.Effect<Value, UiError, AppServices>,
		set: (slot: Slot<Value>) => void,
	): RetryingRead {
		const reading = retryingRead(app, load, {
			value: (value) => set({ key, value }),
			failure: (failure) => set({ key, failure }),
			busy: (next) => {
				busy[name] = next;
			},
		});
		readers[name] = reading;
		reading.run();
		return reading;
	}

	$effect(() => {
		if (!viewer.roster) return;
		const schoolId = school.id;
		const query = { schoolId };
		const reads = [
			start("members", schoolId, () => allMembers(schoolId), (slot) => {
					members = slot;
				}),
			start("people", schoolId, () => read((reader) => reader.people(query)), (slot) => {
					people = slot;
				}),
			start("summary", schoolId, () => read((reader) => reader.membersSummary(query)), (slot) => {
					summary = slot;
				}),
			start("capabilities", schoolId, () => read((reader) => reader.capabilities(query)), (slot) => {
					capabilities = slot;
				}),
			start("invoiceItems", schoolId, () => read((reader) => reader.invoiceItems(query)), (slot) => {
					invoiceItems = slot;
				}),
			start("switchTiers", schoolId, () => read((reader) => reader.switchTiers(query)), (slot) => {
					switchTiers = slot;
				}),
		];
		return () => {
			for (const reading of reads) reading.cancel();
		};
	});
	$effect(() => {
		if (!viewer.roster) return;
		const schoolId = school.id;
		const { from, to } = period;
		const key = `${schoolId}/${from}/${to}`;
		const reading = start(
			"income",
			key,
			() => read((reader) => reader.membersIncome({ schoolId, from, to })),
			(slot) => {
					income = slot;
				},
		);
		return () => reading.cancel();
	});

	const current = (slot: Slot<unknown>): boolean => slot !== null && slot.key === school.id;
	const failures = $derived(
		essential.flatMap((name): Array<{ name: Essential; error: UiError }> => {
			const slot = { members, people, summary, capabilities }[name];
			return slot && slot.key === school.id && "failure" in slot ? [{ name, error: slot.failure }] : [];
		}),
	);
	const ready = $derived(
		members && "value" in members && current(members) &&
			people && "value" in people && current(people) &&
			summary && "value" in summary && current(summary) &&
			capabilities && "value" in capabilities && current(capabilities)
			? { members: members.value, people: people.value, summary: summary.value, capabilities: capabilities.value }
			: null,
	);
	const incomeKey = $derived(`${school.id}/${period.from}/${period.to}`);
	const incomeValue = $derived<number | UiError | null>(
		income && income.key === incomeKey ? ("value" in income ? income.value : income.failure) : null,
	);
	const listOf = <Value,>(slot: Slot<Value>, empty: Value): Value | UiError =>
		slot && slot.key === school.id ? ("value" in slot ? slot.value : slot.failure) : empty;

	$effect(() => {
		if (!viewer.roster || failures.length > 0) onRendered(formatRoute(route));
	});
</script>

{#if !viewer.roster}
	<LockPanel lock={rosterLock} icon="users" hooks="roster" />
{:else if failures.length > 0}
	{#each failures as { name, error } (name)}
		<LoadFailed {error} onRetry={retryFor(error, () => readers[name]?.run())} busy={Boolean(busy[name])} />
	{/each}
{:else if ready}
	<Roster
		{route}
		{school}
		{viewing}
		{navigate}
		{period}
		members={ready.members}
		people={ready.people}
		summary={ready.summary}
		capabilities={ready.capabilities}
		income={incomeValue}
		invoiceItems={listOf(invoiceItems, [])}
		switchTiers={listOf(switchTiers, [])}
		onRetryIncome={() => readers.income?.run()}
		{onRendered}
	/>
{:else}
	<p class="m-0 py-6 text-muted-foreground" data-test="members-loading">
		<span aria-hidden="true">…</span><span class="sr-only">Loading</span>
	</p>
{/if}
