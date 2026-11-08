<script lang="ts">
	import { onDestroy } from "svelte";
	import { reminderToast, endSentence } from "$contract/app/booking-text.ts";
	import { monthAndDay, type Period, periodName } from "$contract/app/period.ts";
	import { formatRoute, type Route, withQuery } from "$contract/app/route.ts";
	import {
		csvFileNames,
		type HistoryCsvRow,
		historyColumns,
	} from "$contract/data/ledger.ts";
	import type {
		Capabilities,
		InvoiceItem,
		Member,
		MemberBooking,
		MemberDetail,
		MembersSummary,
		Person,
		SwitchTier,
	} from "$contract/data/members.ts";
	import type { School } from "$contract/data/types.ts";
	import { Button } from "$lib/components/ui/button/index.ts";
	import { Input } from "$lib/components/ui/input/index.ts";
	import * as Table from "$lib/components/ui/table/index.ts";
	import { read } from "../../effect/run.ts";
	import type { UiError } from "../../effect/ui-error.ts";
	import { useApp } from "../context.ts";
	import { formatMoney } from "../money.ts";
	import PaneIcon from "../PaneIcon.svelte";
	import { saveCsv } from "../panes/download.ts";
	import { pendingOf } from "../panes/pending.svelte.ts";
	import { chip, headCell, link, muted, note, tools, toolsSpacer } from "../panes/styles.ts";
	import { notifySuccess, retryingWrite } from "../panes/writes.ts";
	import { type RetryingRead, retryingRead } from "../retrying-read.ts";
	import LockPanel from "../panes/LockPanel.svelte";
	import type { Viewing } from "../viewing.ts";
	import ActionModal from "./ActionModal.svelte";
	import FinanceOnly from "./FinanceOnly.svelte";
	import MemberDrawer from "./MemberDrawer.svelte";
	import MemberMenu from "./MemberMenu.svelte";
	import MemberRow from "./MemberRow.svelte";
	import {
		type BookingAction,
		type MenuAction,
		type PersonContext,
		roleActions,
	} from "./menu-items.ts";
	import type { Action, ModalContext } from "./modal-context.ts";
	import {
		type Applied,
		applyRoles,
		attentionOf,
		attentionScore,
		type Change,
		capitalized,
		formatPeriodEnd,
		insideCutoffOf,
		membershipChangesOf,
		type Standing,
		paymentsOf,
		portalChangeOf,
		roleLabels,
		roleRank,
		rosterLock,
		standingOf,
		viewerOf,
	} from "./members-model.ts";
	import { recordOutcome, releaseHold, type WriteContext } from "./members-writes.ts";

	/** The roster, once the Reader has answered (mockup `members()`): the strip, the filters, the table and what opens
	 * from it. It keeps the search, the open menu, the open modal and the writes whose effect is pending (in the app's
	 * pane store, so a tab change does not lose them). Every read and every write goes through the app's Effect layer:
	 * a person's lists are read when their drawer or menu opens (their own toast owner, let go with the pane); a write
	 * is a toast with Retry on failure and a pending effect on success. */
	let {
		route,
		school,
		viewing,
		navigate,
		period,
		members,
		people: loadedPeople,
		summary,
		capabilities,
		income,
		invoiceItems,
		switchTiers,
		onRetryIncome,
		onRendered,
	}: {
		route: Route;
		school: School;
		viewing: Viewing;
		navigate: (route: Route) => void;
		period: Period;
		members: Member[];
		people: Person[];
		summary: MembersSummary;
		capabilities: Capabilities;
		/** Minor units, or why they could not be read (the stat then says so, never a 0). Null while reading. */
		income: number | UiError | null;
		invoiceItems: InvoiceItem[] | UiError | null;
		switchTiers: SwitchTier[] | UiError | null;
		onRetryIncome: () => void;
		onRendered: (hash: string) => void;
	} = $props();

	const app = useApp();
	const store = pendingOf(app);
	const clock = app.calendar;
	const { unit } = $derived(summary);
	const viewer = $derived(viewerOf(viewing));

	type Detail = { detail: MemberDetail } | { failure: UiError };
	let details = $state<Record<string, Detail>>({});
	const detailReads = new Map<string, RetryingRead>();
	/** No lists: a role holder with no plan has no bookings, payments or history of its own. */
	const noDetail: MemberDetail = { bookings: [], payments: [], refundable: [], history: [], stripeDashboardUrl: null };

	const changes = $derived<Change[]>([
		...store.roster(school.id),
		...membershipChangesOf(members, store.membership(school.id)),
		...[...store.bookings(school.id)].map((bookingId): Change => ({ kind: "booking", bookingId })),
	]);
	let search = $state("");
	type Menu = { personId: string; place: "row" | "drawer"; anchor: HTMLElement; focusFirst: boolean };
	let menu = $state<Menu | null>(null);
	let modal = $state<{ personId: string; action: Action; opener: HTMLElement | null } | null>(null);
	/** The drawer's booking buttons whose call is on its way. */
	let busy = $state<Array<{ bookingId: string; action: BookingAction }>>([]);
	/** The pane is gone: a write that finishes then changes what is pending for its school, and says nothing. */
	let gone = false;
	onDestroy(() => {
		gone = true;
	});
	/** Whether the person is still looking at the school a write was sent for. */
	const present = (schoolId: string): boolean => !gone && school.id === schoolId;
	let drawerOpener: string | null = null;
	let topBarHeight = $state(0);

	const drawerId = $derived(route.query.get("member"));
	const menuPersonId = $derived(menu?.personId ?? null);
	$effect(() => {
		for (const id of [drawerId, menuPersonId]) {
			if (id === null || detailReads.has(id)) continue;
			if (!loadedPeople.some((person) => person.id === id && person.planHolder)) continue;
			const reading = retryingRead(app, () => read((reader) => reader.memberDetail({ schoolId: school.id, personId: id })), {
				value: (detail) => {
					details[id] = { detail };
				},
				failure: (failure) => {
					details[id] = { failure };
				},
			});
			detailReads.set(id, reading);
			reading.run();
		}
	});
	onDestroy(() => {
		for (const reading of detailReads.values()) reading.cancel();
	});

	const people = $derived(applyRoles(loadedPeople, changes));
	const detailOf = (person: Person): MemberDetail | undefined => {
		if (!person.planHolder) return noDetail;
		const kept = details[person.id];
		return kept && "detail" in kept ? kept.detail : undefined;
	};
	const failureOf = (person: Person): UiError | null => {
		const kept = person.planHolder ? details[person.id] : undefined;
		return kept && "failure" in kept ? kept.failure : null;
	};
	const drawerPerson = $derived(people.find(({ id }) => id === drawerId));
	const settled = $derived(
		drawerPerson === undefined || detailOf(drawerPerson) !== undefined || failureOf(drawerPerson) !== null,
	);
	$effect(() => {
		if (settled || !viewer.roster) onRendered(formatRoute(route));
	});
	$effect(() => {
		if (drawerId !== null || drawerOpener === null) return;
		const opener = drawerOpener;
		drawerOpener = null;
		document
			.querySelector<HTMLElement>(`[data-test=member-row][data-id="${opener}"] button[aria-haspopup=dialog]`)
			?.focus();
	});

	const go = (name: string, value: string | null): void => navigate(withQuery(route, name, value));
	const memberOf = (person: Person): Member | null =>
		members.find(({ profileId }) => profileId === person.id) ?? null;
	const renewalOf = (member: Member | null): string =>
		member ? formatPeriodEnd(member.currentPeriodEnd, school.timeZone) : "";
	const writeBaseOf = (person: Person): Omit<WriteContext, "writer"> => ({
		schoolId: school.id,
		schoolName: school.name,
		now: clock.now,
		unit,
		rules: summary.bookingRules,
		person,
		renewal: renewalOf(memberOf(person)),
	});
	const contextOf = (person: Person): PersonContext | null => {
		const detail = detailOf(person);
		const unavailable = failureOf(person) !== null;
		if (!detail && !unavailable) return null;
		return {
			person,
			people,
			member: memberOf(person),
			detail: detail ?? noDetail,
			capabilities,
			viewer,
			changes,
			creditUnit: unit.other,
			...(unavailable ? { detailUnavailable: true } : {}),
		};
	};

	type Row = { person: Person; member: Member | null; standing: Standing | null; reasons: ReturnType<typeof attentionOf> };
	const rows = $derived<Row[]>(
		people.map((person) => {
			const member = memberOf(person);
			const standing = member ? standingOf(member, changes) : null;
			return { person, member, standing, reasons: attentionOf(person, standing?.canceled ?? false, changes) };
		}),
	);
	const attentionCount = $derived(rows.filter(({ reasons }) => reasons.length > 0).length);
	const roleCounts = $derived({
		all: rows.length,
		admins: rows.filter(({ person }) => person.role !== "member").length,
		members: rows.filter(({ person }) => person.role === "member").length,
	});
	const show = $derived(route.query.get("show"));
	const shownStatus = $derived(show === "attention" || show === "canceled" ? show : null);
	const roleAsked = $derived(route.query.get("role"));
	const plan = $derived(route.query.get("plan"));
	const listed = $derived.by(() => {
		const needle = search.toLowerCase();
		return rows
			.filter(({ person, member, standing, reasons }) => {
				const plate = member ? `${member.tierName} ×${member.quantity}` : "";
				const status = standing?.canceled ? "canceled" : (member?.status ?? "");
				const text = `${person.id} ${person.name} ${plate} ${status} ${roleLabels[person.role]}`.toLowerCase();
				return (
					text.includes(needle) &&
					(show === "attention" ? reasons.length > 0 : show === "canceled" ? standing?.canceled === true : true) &&
					(plan === null || member?.tierName === plan || member?.tierId === plan) &&
					(roleAsked === "admins" ? person.role !== "member" : roleAsked === "members" ? person.role === "member" : true)
				);
			})
			.sort(
				(first, second) =>
					attentionScore(second.reasons) - attentionScore(first.reasons) ||
					roleRank(first.person) - roleRank(second.person) ||
					first.person.name.localeCompare(second.person.name),
			);
	});

	// ---- Effects of writes

	/** A write that has been answered: its pending effect goes to the school it was sent for, whatever the person looks
	 * at now; its toast only if they still look at that school. */
	const apply = ({ changes: added, toast }: Applied, schoolId: string): void => {
		const kept = added.filter((change) => change.kind !== "booking" && change.kind !== "membership");
		if (kept.length > 0) store.addRoster(schoolId, kept);
		for (const change of added) {
			const sent = portalChangeOf(change);
			if (!sent || change.kind === "booking" || change.kind === "role") continue;
			store.mergeMembership(schoolId, change.personId, sent);
		}
		const bookingIds = added.flatMap((change) => (change.kind === "booking" ? [change.bookingId] : []));
		if (bookingIds.length > 0) store.addBookings(schoolId, bookingIds);
		if (!present(schoolId)) return;
		modal = null;
		notifySuccess(app, toast);
	};
	const unbusy = (bookingId: string): void => {
		busy = busy.filter((entry) => entry.bookingId !== bookingId);
	};
	/** The drawer's booking buttons that need no modal, one write per booking at a time: never cancelled, since the
	 * request may already be at the server. */
	const quickWrites = new Set<string>();

	// ---- Menu, drawer and actions

	const closeMenu = (back: boolean): void => {
		if (back) menu?.anchor.focus();
		menu = null;
	};
	const toggleMenu =
		(personId: string, place: Menu["place"]) =>
		(anchor: HTMLElement, focusFirst: boolean): void => {
			menu = menu?.personId === personId && menu.place === place ? null : { personId, place, anchor, focusFirst };
		};
	const openDrawer = (personId: string): void => {
		drawerOpener = personId;
		go("member", personId);
	};
	const startModal = (personId: string, action: Action): void => {
		const opener = menu?.anchor ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
		menu = null;
		modal = { personId, action, opener };
	};
	const downloadPayments = (person: Person): void => {
		const detail = detailOf(person);
		if (!detail) return;
		const paymentRows = paymentsOf(detail, person.id, changes, clock.today);
		saveCsv(app, {
			name: csvFileNames.history(person.id, paymentRows.map(({ date }) => date), clock.today),
			columns: historyColumns(false),
			rows: paymentRows.map(
				(row): HistoryCsvRow => ({
					...row,
					member: person.id,
					currency: summary.currency,
					invoiceId: row.invoiceId ?? "",
					paymentId: row.paymentId ?? "",
				}),
			),
		});
	};
	/** The toast only after the server has accepted the receipt. */
	const resendReceipt = (person: Person): void => {
		const schoolId = school.id;
		retryingWrite(app, (writer) => writer.resendReceipt({ schoolId, personId: person.id }), {
			value: () => {
				if (present(schoolId)) notifySuccess(app, `Receipt resent to ${endSentence(person.name)}`);
			},
		}).run();
	};
	const modalActions: Partial<Record<MenuAction, Action>> = {
		invoice: { kind: "invoice" },
		adjust: { kind: "adjust" },
		refund: { kind: "refund", bookingId: null },
		release: { kind: "pick" },
		switch: { kind: "switch" },
		cancel: { kind: "cancel" },
		resume: { kind: "resume" },
		audit: { kind: "audit" },
	};
	const choose = (person: Person, chosen: MenuAction): void => {
		const change = roleActions[chosen];
		const opened: Action | undefined = change ? { kind: "role", change } : modalActions[chosen];
		if (opened) {
			startModal(person.id, opened);
			return;
		}
		menu = null;
		if (chosen === "view-as-member") navigate(withQuery(route, "portal", person.id));
		else if (chosen === "csv") downloadPayments(person);
		else if (chosen === "receipt") resendReceipt(person);
	};
	/** Remind host: the toast only after the server has taken the reminder. */
	const remindHost = (booking: MemberBooking): void => {
		const schoolId = school.id;
		if (quickWrites.has(booking.id)) return;
		quickWrites.add(booking.id);
		busy = [...busy, { bookingId: booking.id, action: "remind" }];
		const finished = (): void => {
			quickWrites.delete(booking.id);
			unbusy(booking.id);
		};
		retryingWrite(app, (writer) => writer.remindHost({ school: schoolId, bookingId: booking.id }), {
			value: () => {
				finished();
				if (present(schoolId)) notifySuccess(app, reminderToast(booking.hosts));
			},
			failure: finished,
		}).run();
	};
	const bookingAction = (person: Person, action: BookingAction, booking: MemberBooking): void => {
		const inside = insideCutoffOf(person, booking);
		const needsDialog = action === "release" && inside && summary.bookingRules.lateCancel === "spend";
		if (action === "remind") remindHost(booking);
		else if (action === "noshow") startModal(person.id, { kind: "noshow", bookingId: booking.id });
		else if (action === "refund") startModal(person.id, { kind: "refund", bookingId: booking.id });
		else if (needsDialog) startModal(person.id, { kind: "release", bookingId: booking.id });
		else {
			if (quickWrites.has(booking.id)) return;
			quickWrites.add(booking.id);
			const base = writeBaseOf(person);
			busy = [...busy, { bookingId: booking.id, action }];
			const finished = (): void => {
				quickWrites.delete(booking.id);
				unbusy(booking.id);
			};
			retryingWrite(
				app,
				(writer) =>
					action === "confirm"
						? recordOutcome({ ...base, writer }, booking, "attended")
						: releaseHold({ ...base, writer }, booking, { waive: false, inside, quick: true }),
				{
					value: (applied) => {
						finished();
						apply(applied, base.schoolId);
					},
					failure: finished,
				},
			).run();
		}
	};

	/** Where focus goes when a modal closes and its opener has gone: the person's row. */
	const rowButtonOf = (personId: string): HTMLElement | null =>
		document.querySelector<HTMLElement>(`[data-test=member-row][data-id="${personId}"] button[aria-haspopup=dialog]`);
	const menuPerson = $derived(menu ? people.find(({ id }) => id === menu?.personId) : undefined);
	const menuContext = $derived(menuPerson ? contextOf(menuPerson) : null);
	const modalPerson = $derived(modal ? people.find(({ id }) => id === modal?.personId) : undefined);
	const modalDetail = $derived(modalPerson ? detailOf(modalPerson) : undefined);
	const drawerContext = $derived(drawerPerson ? contextOf(drawerPerson) : null);
	const modalContext = $derived<ModalContext | null>(
		modalPerson && modalDetail
			? {
					write: writeBaseOf(modalPerson),
					member: memberOf(modalPerson),
					detail: modalDetail,
					changes,
					currency: summary.currency,
					invoiceItems,
					switchTiers,
					insideCutoff: (booking) => insideCutoffOf(modalPerson, booking),
					onDone: apply,
					returnTo: () => modal?.opener?.isConnected ? modal.opener : rowButtonOf(modalPerson.id),
					onCancel: () => {
						modal = null;
					},
				}
			: null,
	);
	$effect(() => {
		// The drawer hangs below the top bar of the app's frame, as the mockup's does.
		if (drawerId !== null)
			topBarHeight =
				app.root.querySelector<HTMLElement>('[data-test="top-bar"]')?.getBoundingClientRect().height ?? 0;
	});

	const statusFilters = [
		{ slug: "all", label: "All", show: null },
		{ slug: "attention", label: "Needs attention", show: "attention" },
		{ slug: "canceled", label: "Canceled", show: "canceled" },
	] as const;
	const roleFilters = [
		{ slug: "all", label: "All", role: null },
		{ slug: "admins", label: "Owners & admins", role: "admins" },
		{ slug: "members", label: "Members", role: "members" },
	] as const;
	const columns = [
		["member", "Member"],
		["role", "Role"],
		["plan", "Plan"],
		["available", ""],
		["bar", "Balance"],
		["expires", "Expires"],
		["actions", "Actions"],
	] as const;
	const expiring = $derived(summary.expiringGifts);
	const statClass =
		"block rounded-xl border border-border bg-card px-[11px] py-[9px] text-left text-foreground";
</script>

{#if !viewer.roster}
	<LockPanel lock={rosterLock} icon="users" hooks="roster" />
{:else}
	<div class="mb-3 grid grid-cols-3 gap-2">
		<div class={statClass} data-test="members-stat" data-stat="outstanding">
			<small class="block text-[10.5px] text-muted-foreground" data-test="stat-label"><PaneIcon name="ticket" class="mr-1 inline size-[11px]" /> {unit.other} outstanding (incl. held)</small>
			<b class="block text-[17px] tabular-nums" data-test="stat-value">{summary.creditsOutstanding}</b>
		</div>
		<div class={statClass} data-test="members-stat" data-stat="income">
			<small class="block text-[10.5px] text-muted-foreground" data-test="stat-label"><PaneIcon name="coin" class="mr-1 inline size-[11px]" /> income · {periodName(period)}</small>
			<b class="block text-[17px] tabular-nums" data-test="stat-value">
				{#if !viewer.finance}
					<FinanceOnly place="strip" />
				{:else if income === null}
					<span class="text-muted-foreground" aria-hidden="true">…</span><span class="sr-only">Loading</span>
				{:else if typeof income === "number"}
					{formatMoney(income, summary.currency)}
				{:else}
					<button type="button" class={link} data-test="income-unavailable" onclick={onRetryIncome} title={income.reason}>— Not available</button>
				{/if}
			</b>
		</div>
		<button type="button" class={[statClass, "cursor-pointer hover:border-ring"]} data-test="members-stat" data-stat="attention" onclick={() => go("show", "attention")}>
			<small class="block text-[10.5px] text-muted-foreground" data-test="stat-label"><PaneIcon name="alert" class="mr-1 inline size-[11px]" /> need attention</small>
			<b class="block text-[17px] text-destructive tabular-nums" data-test="stat-value">{attentionCount}</b>
		</button>
	</div>
	{#if expiring.length > 0}
		<div class={note} data-test="members-note">
			<PaneIcon name="alert" />
			<span>
				{expiring.length} unredeemed gift{expiring.length === 1 ? "" : "s"} expire{expiring.length === 1 ? "s" : ""} within 30 days ({expiring
					.map(({ maskedCode, expiresOn }) => `${maskedCode} · ${monthAndDay(expiresOn)}`)
					.join(", ")})
			</span>
			<span class="flex-1"></span>
			<button type="button" class={link} data-test="members-note-link" onclick={() => navigate({ ...route, tab: "promos" })}>View promos</button>
		</div>
	{/if}
	<div class={tools}>
		<span class="relative inline-block">
			<PaneIcon name="search" class="absolute top-[7px] left-2 text-muted-foreground" />
			<Input
				type="search"
				class="h-auto w-[190px] rounded-md border-border bg-card py-1 pr-2 pl-[26px] text-[12px] shadow-none md:text-[12px]"
				data-test="member-search"
				placeholder="Search name or id"
				aria-label="Search members"
				value={search}
				oninput={(event) => (search = event.currentTarget.value)}
			/>
		</span>
		{#each statusFilters as filter (filter.slug)}
			<button type="button" class={chip} data-test="member-filter" data-filter={filter.slug} aria-pressed={filter.show === shownStatus} onclick={() => go("show", filter.show)}>
				{#if filter.slug === "attention"}<PaneIcon name="alert" class="size-[11px]" />{/if}{filter.label}{filter.slug === "attention" ? ` (${attentionCount})` : ""}
			</button>
		{/each}
		{#if plan !== null}
			<span class={[chip, "border-primary text-primary"]} data-test="plan-filter">
				Plan: {plan}{" "}<button type="button" class="cursor-pointer border-0 bg-transparent p-0 text-[13px] leading-none text-inherit" data-test="plan-filter-clear" aria-label="Clear the plan filter" onclick={() => go("plan", null)}>×</button>
			</span>
		{/if}
		<span class={toolsSpacer}></span>
		<span class={muted} data-test="members-sort-note">Needs attention first</span>
	</div>
	<div class={tools} role="group" aria-label="Role">
		<span class={muted}>Role</span>
		{#each roleFilters as filter (filter.slug)}
			{@const selected = filter.role === (roleAsked === "admins" || roleAsked === "members" ? roleAsked : null)}
			<button type="button" class={chip} data-test="role-filter" data-role-filter={filter.slug} aria-pressed={selected} onclick={() => go("role", filter.role)}>
				{filter.label} <span class={muted}>{roleCounts[filter.slug]}</span>
			</button>
		{/each}
	</div>
	<div class="overflow-x-auto">
		<Table.Root class="text-[12px]">
			<Table.Header>
				<Table.Row class="hover:bg-transparent">
					{#each columns as [column, label] (column)}
						<Table.Head class={headCell} data-test="members-column" data-column={column}>
							{#if column === "available"}{capitalized(unit.other)} available{:else if column === "bar" || column === "actions"}<span class="sr-only">{label}</span>{:else}{label}{/if}
						</Table.Head>
					{/each}
				</Table.Row>
			</Table.Header>
			<Table.Body>
				{#if listed.length === 0}
					<Table.Row class="hover:bg-transparent">
						<Table.Cell colspan={columns.length} class="px-2 py-6 text-center whitespace-normal text-muted-foreground" data-test="members-empty">
							{people.length > 0 ? "No members match." : "No members yet. They appear here when someone buys a plan."}
						</Table.Cell>
					</Table.Row>
				{:else}
					{#each listed as row (row.person.id)}
						<MemberRow
							person={row.person}
							member={row.member}
							standing={row.standing}
							reasons={row.reasons}
							{changes}
							{school}
							{unit}
							menuOpen={menu?.personId === row.person.id && menu.place === "row"}
							onOpen={() => openDrawer(row.person.id)}
							onMenu={toggleMenu(row.person.id, "row")}
							onViewAs={() => choose(row.person, "view-as-member")}
						/>
					{/each}
				{/if}
			</Table.Body>
		</Table.Root>
	</div>
	<div class="mt-2 flex gap-3.5 text-[10.5px] text-muted-foreground" data-test="members-legend">
		<span class="inline-flex items-center"><i class="mr-1 inline-block h-[7px] w-2.5 rounded-xs bg-muted-foreground opacity-55"></i>used</span>
		<span class="inline-flex items-center"><i class="mr-1 inline-block h-[7px] w-2.5 rounded-xs bg-[repeating-linear-gradient(135deg,var(--warning)_0_3px,transparent_3px_6px)]"></i>held for bookings</span>
		<span class="inline-flex items-center"><i class="mr-1 inline-block h-[7px] w-2.5 rounded-xs bg-primary"></i>available</span>
	</div>
	{#if drawerPerson && drawerContext}
		{#key drawerPerson.id}
			<MemberDrawer
				context={drawerContext}
				detailFailure={failureOf(drawerPerson)}
				{school}
				{unit}
				today={clock.today}
				root={app.root}
				top={topBarHeight}
				menuOpen={menu?.personId === drawerPerson.id && menu.place === "drawer"}
				trapActive={menu === null && modal === null}
				busy={busy}
				onMenu={toggleMenu(drawerPerson.id, "drawer")}
				onClose={() => go("member", null)}
				onAction={(chosen) => choose(drawerPerson, chosen)}
				onBookingAction={(action, booking) => bookingAction(drawerPerson, action, booking)}
				onRetryDetail={() => detailReads.get(drawerPerson.id)?.run()}
			/>
		{/key}
	{/if}
	{#if menu && menuPerson && menuContext}
		<MemberMenu
			context={menuContext}
			anchor={menu.anchor}
			focusFirst={menu.focusFirst}
			onChoose={(chosen) => choose(menuPerson, chosen)}
			onClose={closeMenu}
		/>
	{/if}
	{#if modal && modalContext}
		<ActionModal
			action={modal.action}
			context={modalContext}
			onPick={(booking) => {
				if (modalPerson && modal)
					modal = { personId: modalPerson.id, action: { kind: "release", bookingId: booking.id }, opener: modal.opener };
			}}
		/>
	{/if}
{/if}
