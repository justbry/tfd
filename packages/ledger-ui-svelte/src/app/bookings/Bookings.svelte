<script lang="ts">
	import "./bookings.css";
	import {
		consequenceLine,
		endSentence,
		reminderToast,
		sentToast,
	} from "$contract/app/booking-text.ts";
	import {
		addDays,
		bookingsDays,
		bookingsLabel,
		readBookingsPeriod,
		weekdayName,
	} from "./period-model.ts";
	import { monthAndDay, parsePeriod, snapPeriod } from "$contract/app/period.ts";
	import { formatRoute, type Route, withQuery } from "$contract/app/route.ts";
	import {
		adminReleaseReason,
		type Booking,
		insideCutoff,
		needsOutcome,
	} from "$contract/data/bookings.ts";
	import type { SchoolRules } from "$contract/data/ledger.ts";
	import type { School } from "$contract/data/types.ts";
	import { Button } from "$lib/components/ui/button/index.ts";
	import * as Table from "$lib/components/ui/table/index.ts";
	import { read } from "../../effect/run.ts";
	import type { Writer } from "../../effect/services.ts";
	import type { UiError } from "../../effect/ui-error.ts";
	import { useApp } from "../context.ts";
	import LoadFailed from "../LoadFailed.svelte";
	import { retryFor } from "../panes/retry-for.ts";
	import PaneIcon from "../PaneIcon.svelte";
	import { retryingRead } from "../retrying-read.ts";
	import type { Viewing } from "../viewing.ts";
	import LockPanel from "../panes/LockPanel.svelte";
	import { pendingOf } from "../panes/pending.svelte.ts";
	import {
		chip,
		dayRow,
		headCell,
		muted,
		tools,
		toolsSpacer,
	} from "../panes/styles.ts";
	import { notifySuccess, retryingWrite } from "../panes/writes.ts";
	import {
		attendeeName,
		bookingsNote,
		byStart,
		type Check,
		dayOf,
		exitPreviewTitle,
		type Filter,
		filterOf,
		overdueDays,
	} from "./booking-model.ts";
	import BookingDialog from "./BookingDialog.svelte";
	import BookingRow from "./BookingRow.svelte";
	import BookingsPeriodControl from "./BookingsPeriodControl.svelte";
	import { mount, onDestroy, onMount, unmount } from "svelte";

	/** The Bookings pane (mockup `bookings()`): one day or week of the school's bookings in day groups, preceded by the
	 * overdue group (confirmed bookings that started before the range and have no outcome, from a second read over the
	 * 62 days before it). Which bookings need an outcome or sit inside their cutoff is the contract's `needsOutcome` and
	 * `insideCutoff`; nothing is counted but the rows shown. Writes are `recordOutcome` and `cancelBooking`, one per
	 * booking, through the app's Effect layer: a failure is a toast with Retry (the same request, so the same
	 * `Idempotency-Key`), a booking written stays `pending` until the ledger ships. Each read has its own toast
	 * owner; leaving the pane lets a read go with no toast. `onRendered` says when the list of the route, or its lock
	 * panel, is on screen. */
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
	/** The period control of the top bar on this tab (a day or a week, looking ahead) is this pane's own, so that the
	 * first page load carries none of it: the bar leaves a slot, and the control is mounted into it (and taken out
	 * with the pane). Its props follow the route, the school and the money period. */
	onMount(() => {
		const target = document.querySelector<HTMLElement>("[data-test=period-slot]");
		if (!target) return;
		const control = mount(BookingsPeriodControl, {
			target,
			props: {
				get route() {
					return route;
				},
				get today() {
					return clock.today;
				},
				get moneyPeriod() {
					return moneyPeriod;
				},
				get timeZone() {
					return school.timeZone;
				},
				onNavigate: (next: Route) => navigate(next),
			},
		});
		return () => {
			void unmount(control);
		};
	});
	const pending = pendingOf(app);
	const clock = app.calendar;
	/** The money period, which the top bar's control says comes back when this tab is left. */
	const moneyPeriod = $derived(
		snapPeriod(parsePeriod(route.query.get("month"), clock.today), viewing.view),
	);
	const preview = $derived(viewing.preview);
	const admin = $derived(viewing.option.admin);

	const bookingsLock = {
		reason: "admins_only",
		who: "Owners and admins see bookings",
		when: "Not a school-books surface: bookings carry minors' schedules (safeguarding), so they follow ManageBookings, not the audience.",
	} as const;

	const period = $derived(readBookingsPeriod(route.query));
	const filter = $derived(filterOf(route.query.get("filter")));
	const days = $derived(bookingsDays(period, clock.today));
	const { today } = clock;
	const key = $derived(`${school.id}/${days.from}/${days.to}`);

	type ReadName = "range" | "before" | "rules";
	let inRange = $state<{ key: string; bookings: Booking[] } | null>(null);
	let before = $state<{ key: string; bookings: Booking[] } | null>(null);
	let rules = $state<{ school: string; rules: SchoolRules | null } | null>(null);
	let failures = $state<Record<ReadName, { key: string; error: UiError } | null>>({
		range: null,
		before: null,
		rules: null,
	});
	let busy = $state<Partial<Record<ReadName, boolean>>>({});
	const readers: Partial<Record<ReadName, { run: () => Promise<void> }>> = {};

	$effect(() => {
		if (!admin) return;
		const asked = { key, school: school.id, from: days.from, to: days.to };
		const started = (
			name: ReadName,
			load: Parameters<typeof retryingRead>[1],
			value: (loaded: never) => void,
		) => {
			const reading = retryingRead(app, load, {
				value: (loaded) => {
					value(loaded as never);
					failures[name] = null;
				},
				failure: (error) => {
					failures[name] = { key: asked.key, error };
				},
				busy: (next) => {
					busy[name] = next;
				},
			});
			readers[name] = reading;
			reading.run();
			return reading;
		};
		const reads = [
			started(
				"range",
				() => read((reader) => reader.bookings({ school: asked.school, from: asked.from, to: asked.to })),
				(loaded: { bookings: Booking[] }) => {
					inRange = { key: asked.key, bookings: loaded.bookings };
				},
			),
			started(
				"before",
				() =>
					read((reader) =>
						reader.bookings({
							school: asked.school,
							from: addDays(asked.from, -overdueDays),
							to: addDays(asked.from, -1),
						}),
					),
				(loaded: { bookings: Booking[] }) => {
					before = { key: asked.key, bookings: loaded.bookings };
				},
			),
			started(
				"rules",
				() => read((reader) => reader.schoolRules(asked.school)),
				(loaded: { rules: SchoolRules | null }) => {
					rules = { school: asked.school, rules: loaded.rules };
				},
			),
		];
		// Leaving the week, the school or the pane lets the reads go: no toast, no log entry.
		return () => {
			for (const reading of reads) reading.cancel();
			failures = { range: null, before: null, rules: null };
		};
	});

	const shown = $derived(
		inRange?.key === key && before?.key === key && rules?.school === school.id
			? { inRange: inRange.bookings, before: before.bookings, rules: rules.rules }
			: null,
	);
	const failedRead = $derived(
		(["range", "before", "rules"] as const).find((name) => failures[name]?.key === key),
	);
	const failed = $derived(failedRead ? failures[failedRead]?.error : undefined);
	/** Retry reads again every read that failed, not only the one whose message shows. */
	const retryFailed = (): void => {
		for (const name of ["range", "before", "rules"] as const)
			if (failures[name]?.key === key) readers[name]?.run();
	};
	$effect(() => {
		if (shown || failed || !admin) onRendered(formatRoute(route));
	});

	const waiting: Check = ({ id }) => pending.bookings(school.id).has(id);
	const canRecord: Check = (booking) => needsOutcome(booking, clock) && !waiting(booking);
	const checks: Record<Filter, Check> = {
		outcome: canRecord,
		approval: ({ state }) => state === "requested",
		cutoff: (booking) => insideCutoff(booking, clock),
	};
	const overdue = $derived(
		(shown?.before ?? []).filter((booking) => needsOutcome(booking, clock)).sort(byStart),
	);
	const counted = $derived([...overdue, ...(shown?.inRange ?? [])]);
	const keep: Check = (booking) => filter === null || checks[filter](booking);

	type Group = {
		key: string;
		heading: string;
		icon: "alert" | "calendar";
		rows: Booking[];
		withDate: boolean;
	};
	const plural = (count: number, noun: string): string => `${count} ${noun}${count === 1 ? "" : "s"}`;
	const layout = $derived.by(() => {
		const groups: Group[] = [];
		const shownOverdue = overdue.filter(keep);
		if (shownOverdue.length > 0)
			groups.push({
				key: "overdue",
				heading: `Overdue: needs an outcome (${shownOverdue.length})`,
				icon: "alert",
				rows: shownOverdue,
				withDate: true,
			});
		const tomorrow = addDays(today, 1);
		let emptyDay: string | null = null;
		for (let day = days.from; day <= days.to; day = addDays(day, 1)) {
			const rows = (shown?.inRange ?? [])
				.filter((booking) => dayOf(booking) === day && keep(booking))
				.sort(byStart);
			if (rows.length === 0) {
				if (days.from === days.to && shown) emptyDay = day;
				continue;
			}
			const when = day === today ? " · Today" : day === tomorrow ? " · Tomorrow" : "";
			groups.push({
				key: day,
				heading: `${weekdayName(day)} ${monthAndDay(day)}${when} · ${plural(rows.length, "booking")}`,
				icon: "calendar",
				rows,
				withDate: false,
			});
		}
		return { groups, emptyDay };
	});

	/** The bookings whose Remind host is on its way. */
	let reminding = $state<ReadonlySet<string>>(new Set());
	let dialog = $state<{ action: "noshow" | "release"; booking: Booking } | null>(null);

	/** Where focus goes when a dialog closes: the booking's row, which is still there (it turns pending). */
	const rowOf = (id: string | undefined): HTMLElement | null =>
		id === undefined
			? null
			: document.querySelector<HTMLElement>(`[data-test=booking-row][data-booking="${id}"]`);
	/** The pane is gone: a write that finishes then changes what is pending for its school, and says nothing. */
	let gone = false;
	onDestroy(() => {
		gone = true;
	});
	/** Whether the person is still looking at the school a write was sent for. */
	const present = (schoolId: string): boolean => !gone && school.id === schoolId;

	/** Marks the bookings pending, runs one write each (in row order), and toasts when every Writer has answered; a
	 * booking whose write failed is offered again (and is pending again while its toast's Retry is on its way). The
	 * writes are for the school and the bookings of the click, whatever the app shows later; none is ever cancelled (a
	 * request may already be at the server): their failure toast, with Retry, stays; their success toasts only if the
	 * person still looks at that school, and the pending change is kept either way. `partial` words a batch that only
	 * partly went through. */
	const send = (
		bookings: Booking[],
		call: (writer: Writer["Service"], booking: Booking, schoolId: string) => Promise<unknown>,
		done: string,
		doneOne: (booking: Booking) => string,
		partial?: (succeeded: number, total: number) => string,
	): void => {
		const schoolId = school.id;
		pending.addBookings(schoolId, bookings.map(({ id }) => id));
		let outstanding = bookings.length;
		let succeeded = 0;
		let batchDone = false;
		const settle = (ok: boolean): void => {
			if (ok) succeeded += 1;
			outstanding -= 1;
			if (outstanding > 0) return;
			batchDone = true;
			if (!present(schoolId)) return;
			if (succeeded === bookings.length) notifySuccess(app, done);
			else if (succeeded > 0 && partial) notifySuccess(app, partial(succeeded, bookings.length));
		};
		for (const booking of bookings) {
			retryingWrite(app, (writer) => call(writer, booking, schoolId), {
				value: () => {
					if (!batchDone) settle(true);
					else if (present(schoolId)) notifySuccess(app, doneOne(booking));
				},
				failure: () => {
					pending.removeBookings(schoolId, [booking.id]);
					if (!batchDone) settle(false);
				},
				busy: (next) => {
					if (next) pending.addBookings(schoolId, [booking.id]);
				},
			}).run();
		}
	};
	const record = (writer: Writer["Service"], schoolId: string, booking: Booking, state: "attended" | "no_show") =>
		writer.recordOutcome({ school: schoolId, bookingId: booking.id, state });
	const release = (writer: Writer["Service"], schoolId: string, booking: Booking, waiveCutoff?: boolean) =>
		writer.cancelBooking({
			school: schoolId,
			bookingId: booking.id,
			reason: adminReleaseReason,
			...(waiveCutoff === undefined ? {} : { waiveCutoff }),
		});
	const confirm = (booking: Booking): void => {
		const text = `Attendance confirmed for ${endSentence(attendeeName(booking))}`;
		send([booking], (writer, each, schoolId) => record(writer, schoolId, each, "attended"), text, () => text);
	};
	const confirmAll = (rows: Booking[]): void => {
		send(
			rows,
			(writer, each, schoolId) => record(writer, schoolId, each, "attended"),
			`Attendance confirmed for ${rows.length} bookings.`,
			(each) => `Attendance confirmed for ${endSentence(attendeeName(each))}`,
			(succeeded, total) => `Attendance confirmed for ${succeeded} of ${total} bookings.`,
		);
	};
	const startRelease = (booking: Booking): void => {
		const forfeits = insideCutoff(booking, clock) && shown?.rules?.lateCancel === "spend";
		if (forfeits) {
			dialog = { action: "release", booking };
			return;
		}
		const text = `Hold released for ${endSentence(attendeeName(booking))}`;
		send([booking], (writer, each, schoolId) => release(writer, schoolId, each), text, () => text);
	};
	const confirmDialog = (waiveCutoff: boolean): void => {
		if (!dialog) return;
		const { action, booking } = dialog;
		dialog = null;
		send(
			[booking],
			(writer, each, schoolId) =>
				action === "noshow" ? record(writer, schoolId, each, "no_show") : release(writer, schoolId, each, waiveCutoff),
			sentToast,
			() => sentToast,
		);
	};

	/** The toast only after the server has taken the reminder. */
	const remind = (booking: Booking): void => {
		const { id, hosts } = booking;
		const schoolId = school.id;
		reminding = new Set([...reminding, id]);
		const clear = (): void => {
			reminding = new Set([...reminding].filter((each) => each !== id));
		};
		retryingWrite(app, (writer) => writer.remindHost({ school: schoolId, bookingId: id }), {
			value: () => {
				clear();
				if (present(schoolId)) notifySuccess(app, reminderToast(hosts.map(({ name }) => name)));
			},
			failure: clear,
		}).run();
	};
	/** The member's drawer is the Members tab's; the shared parameters stay and this tab's `filter=` goes. */
	const openMember = ({ attendee }: Booking): void => {
		if (!attendee) return;
		const { query } = withQuery(route, "filter", null);
		query.set("member", attendee.key);
		navigate({ ...route, tab: "members", query });
	};

	/** A chip's count is the rows counted, so it waits for the read rather than showing 0. */
	const counting = (label: string, check: Check): string =>
		shown ? `${label} (${counted.filter(check).length})` : label;
	const chips = $derived([
		{ slug: "all", filter: null, label: "All" },
		{ slug: "outcome", filter: "outcome" as const, label: counting("Needs outcome", checks.outcome) },
		{ slug: "approval", filter: "approval" as const, label: counting("Waiting for approval", checks.approval) },
		{ slug: "cutoff", filter: "cutoff" as const, label: counting("Inside cutoff", checks.cutoff) },
	]);
	const onThisWeek = $derived(period.range === "week" && period.offset === 0);
	const dialogLine = $derived(
		dialog
			? [dialog.booking.service, dialog.booking.id, attendeeName(dialog.booking), dialog.booking.attendee?.key]
					.filter(Boolean)
					.join(" · ")
			: "",
	);
	const emptyCell = `px-2 py-[7px] text-muted-foreground [&_svg]:mr-1 [&_svg]:inline`;
</script>

{#if !admin}
	<LockPanel lock={bookingsLock} icon="calendar" />
{:else}
	<div class={tools}>
		<b data-test="booking-range-label">{bookingsLabel(period, days.from)}</b>
		<span class={muted} data-test="booking-range-dates">
			{monthAndDay(days.from)}{days.from === days.to ? "" : ` – ${monthAndDay(days.to)}`} · change it in the period control
		</span>
		<span class={toolsSpacer}></span>
		{#each chips as option (option.slug)}
			<button
				type="button"
				class={chip}
				aria-pressed={option.filter === filter}
				data-test="booking-filter"
				data-filter={option.slug}
				onclick={() => navigate(withQuery(route, "filter", option.filter))}
			>
				{option.label}
			</button>
		{/each}
	</div>
	{#if failed}
		<LoadFailed
			error={failed}
			onRetry={retryFor(failed, retryFailed)}
			busy={failedRead ? Boolean(busy[failedRead]) : false}
		/>
	{:else}
		<Table.Root class="text-[12px]">
			<Table.Header>
				<Table.Row class="hover:bg-transparent">
					<Table.Head class={headCell}>When</Table.Head>
					<Table.Head class={headCell}>Booking</Table.Head>
					<Table.Head class={headCell}>Member</Table.Head>
					<Table.Head class={headCell}>Billing</Table.Head>
					<Table.Head class={headCell}>Status</Table.Head>
					<Table.Head class={headCell}><span class="sr-only">Actions</span></Table.Head>
				</Table.Row>
			</Table.Header>
			<Table.Body>
				{#each layout.groups as group (group.key)}
					{@const needing = group.rows.filter(canRecord)}
					<Table.Row class="hover:bg-transparent" data-test="booking-day" data-day={group.key}>
						<Table.Cell class={dayRow} colspan={6}>
							<!-- Sticky and no wider than the screen: on a narrow one the table scrolls, and the heading and its
							     bulk button stay where they can be seen. -->
							<div class="sticky left-0 flex max-w-[calc(100vw-3.5rem)] flex-wrap items-center justify-between gap-1.5">
								<span>
									<PaneIcon name={group.icon} class="mr-1 inline align-[-2px]" />{group.heading}
								</span>
								{#if needing.length > 1}
									<Button
										variant="tool"
										size="tool-small"
										data-test="booking-bulk"
										data-day={group.key}
										disabled={preview}
										title={preview ? exitPreviewTitle : undefined}
										onclick={() => confirmAll(needing)}
									><PaneIcon name="check" />Confirm all attended ({needing.length})</Button>
								{/if}
							</div>
						</Table.Cell>
					</Table.Row>
					{#each group.rows as booking (booking.id)}
						<BookingRow
							{booking}
							withDate={group.withDate}
							pending={waiting(booking)}
							reminding={reminding.has(booking.id)}
							{preview}
							{school}
							{clock}
							onConfirm={confirm}
							onNoShow={(chosen) => (dialog = { action: "noshow", booking: chosen })}
							onRelease={startRelease}
							onRemind={remind}
							onOpenMember={openMember}
						/>
					{/each}
				{/each}
				{#if layout.emptyDay}
					<Table.Row class="hover:bg-transparent" data-test="booking-empty">
						<Table.Cell colspan={6} class={[emptyCell, "py-6 text-center"]}>
							Nothing booked on {monthAndDay(layout.emptyDay)}.
						</Table.Cell>
					</Table.Row>
				{:else if shown && layout.groups.length === 0}
					<Table.Row class="hover:bg-transparent" data-test="booking-empty">
						<Table.Cell colspan={6} class={[emptyCell, "py-6 text-center"]}>
							<PaneIcon name="check" /> No bookings {filter ? "match" : "in this period"}.{onThisWeek ? "" : " Try This week."}
						</Table.Cell>
					</Table.Row>
				{/if}
			</Table.Body>
		</Table.Root>
		<p class="mt-2.5 mb-0 flex items-start gap-1 text-muted-foreground" data-test="booking-note">
			<PaneIcon name="info" class="mt-px" /> {bookingsNote}
		</p>
	{/if}
	{#if dialog}
		{@const dialogBooking = dialog.booking.id}
		<BookingDialog
			title={`${dialog.action === "noshow" ? "Mark no-show" : "Release hold"} · ${school.name}`}
			detail={dialogLine}
			confirmLabel={dialog.action === "noshow" ? "Mark no-show" : "Release hold"}
			consequence={(waive) =>
				shown && dialog
					? consequenceLine({
							action: dialog.action,
							waive,
							rules: shown.rules,
							booking: dialog.booking,
							creditUnit: school.creditUnit,
							memberName: attendeeName(dialog.booking),
						})
					: null}
			waiveLabel={dialog.action === "release"
				? `Waive the late-cancel forfeit (return the ${school.creditUnit.other})`
				: undefined}
			returnTo={() => rowOf(dialogBooking)}
			onConfirm={confirmDialog}
			onCancel={() => (dialog = null)}
		/>
	{/if}
{/if}
