<script lang="ts">
	import "./portal.css";
	import { Effect } from "effect";
	import { onDestroy, onMount } from "svelte";
	import { count, historyCsvColumnsOf, planOf } from "$contract/app/portal-format.ts";
	import { endSentence } from "$contract/app/booking-text.ts";
	import { formatRoute, type Route, withQuery } from "$contract/app/route.ts";
	import type { KpiDocument } from "$contract/data/kpi-document.ts";
	import {
		type HistoryPeriod,
		historyCsvFileName,
		type MemberPortal,
		type PortalBooking,
		type PortalHistoryRow,
		type PortalMember,
		portalFrameVariables,
		siteThemeIds,
		siteThemes,
	} from "$contract/data/portal.ts";
	import type { School } from "$contract/data/types.ts";
	import { read } from "../../effect/run.ts";
	import { formatMoney } from "../books-shared/books-text.ts";
	import { ReadSlot } from "../books-shared/read-slot.svelte.ts";
	import { useApp } from "../context.ts";
	import Icon from "../Icon.svelte";
	import LoadFailed from "../LoadFailed.svelte";
	import { viewerOf } from "../members/members-model.ts";
	import { saveCsv } from "../panes/download.ts";
	import { pendingOf } from "../panes/pending.svelte.ts";
	import { retryFor } from "../panes/retry-for.ts";
	import { notify, notifySuccess, retryingWrite } from "../panes/writes.ts";
	import PaneIcon from "../PaneIcon.svelte";
	import { plansStoreOf } from "../plans/plans-store.svelte.ts";
	import NotAvailable from "../plans/NotAvailable.svelte";
	import type { Viewing } from "../viewing.ts";
	import { messageFor } from "../../effect/messages.ts";
	import BillingTab from "./BillingTab.svelte";
	import BookingsTab from "./BookingsTab.svelte";
	import CancelDialog from "./CancelDialog.svelte";
	import EmbedDialog from "./EmbedDialog.svelte";
	import FamilyTab from "./FamilyTab.svelte";
	import Overview from "./Overview.svelte";
	import QuantityDialog from "./QuantityDialog.svelte";
	import ResumeDialog from "./ResumeDialog.svelte";
	import {
		bookingsOf,
		defaultPeriod,
		defaultTab,
		defaultTheme,
		familyRoleLabel,
		type Handlers,
		type HistoryControls,
		type PortalTab,
		portalParameters,
		publishedPeriod,
		readPeriod,
		readTab,
		readTheme,
		scopeText,
		tabs,
	} from "./portal-model.ts";
	import { returnFocusToRow } from "./return-focus.ts";
	import { frame, siteBody, siteHeader, tabButton, tabRow } from "./styles.ts";
	import { Button } from "$lib/components/ui/button/index.ts";
	import { Badge } from "$lib/components/ui/badge/index.ts";
	import { paneBadge } from "../panes/styles.ts";

	/** The member portal (mockup `drawVM`): one person's view as the server scopes it, in the school's site theme. The
	 * preview bar, the scope banner and the note are the admin's; inside the frame is exactly what the member sees. The
	 * portal is read apart from the figures of its School books card: each read has its own toast, and a card whose
	 * figures cannot be read says so. A change the member asks for is sent through the Writer and shown as "on its way"
	 * until the Reader says it; a write carries the school and the person at the click, is never aborted, and tells a
	 * person who has left nothing. A preview of another audience writes nothing: its buttons are off. */
	let {
		route,
		school,
		viewing,
		navigate,
		onRendered,
		onShownChange,
	}: {
		route: Route;
		school: School;
		viewing: Viewing;
		navigate: (route: Route) => void;
		onRendered: (hash: string) => void;
		onShownChange: (shown: boolean) => void;
	} = $props();

	const app = useApp();
	const pending = pendingOf(app);
	const plans = plansStoreOf(app);
	const tabsId = $props.id();
	const themeSelectId = `${tabsId}-theme`;
	const profileId = $derived(route.query.get("portal") ?? "");
	const tab = $derived(readTab(route.query));
	const themeId = $derived(readTheme(route.query));
	const period = $derived(readPeriod(route.query));
	const expanded = $derived(route.query.get("historyAll") === "1");
	const key = $derived(`${school.id}/${profileId}`);
	const preview = $derived(viewing.preview);
	const finance = $derived(viewerOf(viewing).finance);
	const clock = $derived(app.calendar);

	const portalRead = new ReadSlot<{ portal: MemberPortal | undefined }>();
	type Figures = { figures: KpiDocument | null; publicYear: string };
	const figuresRead = new ReadSlot<Figures>();
	$effect(() => {
		const asked = { school: school.id, profileId };
		return portalRead.begin(app, key, () =>
			read((reader) => reader.memberPortal(asked)).pipe(Effect.map((portal) => ({ portal }))),
		);
	});
	const loaded = $derived(portalRead.valueFor(key));
	const failed = $derived(portalRead.failureFor(key));
	const loadedPortal = $derived(loaded?.portal);
	$effect(() => {
		const portal = loadedPortal;
		if (!portal) return;
		const asked = { school: school.id, audience: portal.books.audience, guardian: portal.books.guardian !== null };
		return figuresRead.begin(app, key, () =>
			Effect.gen(function* () {
				const options = yield* read((reader) => reader.dashboardOptions());
				const preset = options.presets[0]?.id;
				if (preset === undefined) return { figures: null, publicYear: "" };
				const document = (audience: "public" | "member") =>
					read((reader) => reader.kpiDocument({ school: asked.school, preset, audience, pinLocked: false }));
				const publicDocument = yield* document("public");
				const memberDocument =
					asked.audience === "member" && !asked.guardian ? yield* document("member") : undefined;
				const booksDocument = asked.audience === "public" && !asked.guardian ? publicDocument : memberDocument;
				return {
					figures: booksDocument ?? null,
					publicYear: publicDocument ? (publishedPeriod(publicDocument)?.period ?? "") : "",
				};
			}),
		);
	});
	const figuresLoaded = $derived(figuresRead.valueFor(key));
	const figuresFailure = $derived(figuresRead.failureFor(key));

	const viewed = $derived(loadedPortal?.people.find((person) => person.profileId === profileId));
	/** A publish that gave the member's tier another audience: they read it at once, before the Reader says it. A child's
	 * books are the guardian's, so a tier's move does not reach them. */
	const move = $derived(viewed ? plans.moves[school.id]?.[viewed.tierId] : undefined);
	const portal = $derived(
		loadedPortal && move && !loadedPortal.books.guardian
			? { ...loadedPortal, books: { ...loadedPortal.books, audience: move.audience } }
			: loadedPortal,
	);
	const visible = $derived(Boolean(portal && viewed));
	/** A portal= with no such person shows the Members tab without a portal (mockup `drawVM`): that pane reports its own render. */
	const missing = $derived(loaded !== null && !visible);
	$effect(() => {
		if ((loaded && visible) || failed) onRendered(formatRoute(route));
	});
	$effect(() => {
		onShownChange(visible);
	});

	let viewingBar = $state<HTMLElement | null>(null);
	const profileShown = $derived(visible ? profileId : null);
	$effect(() => {
		if (profileShown !== null) viewingBar?.focus({ preventScroll: true });
	});
	let dialog = $state<"quantity" | "cancel" | "resume" | "embed" | null>(null);
	const exit = (): void => {
		returnFocusToRow(profileId);
		navigate(portalParameters.reduce((next, name) => withQuery(next, name, null), route));
	};
	$effect(() => {
		if (!visible) return;
		const onKeyDown = (event: KeyboardEvent): void => {
			if (event.key === "Escape" && dialog === null) exit();
		};
		// In the capture phase, before a dialog's own Escape closes it: that Escape is the dialog's, not the portal's.
		document.addEventListener("keydown", onKeyDown, true);
		return () => document.removeEventListener("keydown", onKeyDown, true);
	});
	let gone = false;
	onDestroy(() => {
		gone = true;
	});

	const change = $derived(viewed ? pending.membership(school.id)[viewed.profileId] : undefined);
	const plan = $derived(viewed ? planOf(viewed, change, school) : null);
	const theme = $derived(siteThemes[themeId]);
	const setParameter = (name: string, value: string | null): void => navigate(withQuery(route, name, value));
	const chooseTab = (id: PortalTab): void => setParameter("portalTab", id === defaultTab ? null : id);
	const onTabKeyDown = (event: KeyboardEvent & { currentTarget: HTMLElement }): void => {
		const index = tabs.findIndex(({ id }) => id === tab);
		const targets: Record<string, number> = {
			ArrowLeft: (index + tabs.length - 1) % tabs.length,
			ArrowRight: (index + 1) % tabs.length,
			Home: 0,
			End: tabs.length - 1,
		};
		const target = tabs[targets[event.key] ?? -1];
		if (!target) return;
		event.preventDefault();
		event.currentTarget.querySelector<HTMLElement>(`[data-portal-tab=${target.id}]`)?.focus();
		chooseTab(target.id);
	};

	const changeQuantity = (member: PortalMember, quantity: number): void => {
		dialog = null;
		// The school, the person and what the toast will say, as they are at the click.
		const request = { school: school.id, profileId: member.profileId, quantity };
		const endsOn = plan?.endsOn ?? "";
		const currency = school.currency;
		const unit = school.creditUnit;
		const merge = (next: Parameters<typeof pending.mergeMembership>[2]): void =>
			pending.mergeMembership(request.school, request.profileId, next);
		retryingWrite(app, (writer) => writer.portalChangeQuantity(request), {
			busy: (busy) => merge({ waiting: busy }),
			value: (result) => {
				if (result.at === "renewal") {
					merge({ waiting: true, scheduledQuantity: quantity });
					if (!gone) notifySuccess(app, `Change to ×${quantity} scheduled for ${endsOn}.`);
				} else {
					merge({ waiting: true, quantity });
					if (!gone)
						notifySuccess(
							app,
							`Upgraded to ×${quantity}. Charged ${formatMoney(result.chargedCents, currency)} and ${count(result.granted, unit)} added once it ships.`,
						);
				}
			},
		}).run();
	};
	const cancelMembership = (member: PortalMember, reason: string): void => {
		dialog = null;
		const request = {
			school: school.id,
			profileId: member.profileId,
			...(reason === "" ? {} : { reason }),
		};
		const endsOn = plan?.endsOn ?? "";
		retryingWrite(app, (writer) => writer.portalCancelMembership(request), {
			busy: (busy) => pending.mergeMembership(request.school, request.profileId, { waiting: busy }),
			value: () => {
				pending.mergeMembership(request.school, request.profileId, { waiting: true, ending: true, endsNow: false });
				if (!gone) notifySuccess(app, `Membership will end on ${endsOn}.`);
			},
		}).run();
	};
	const resumeMembership = (member: PortalMember): void => {
		dialog = null;
		const request = { school: school.id, profileId: member.profileId };
		retryingWrite(app, (writer) => writer.portalResumeMembership(request), {
			busy: (busy) => pending.mergeMembership(request.school, request.profileId, { waiting: busy }),
			value: () => {
				pending.mergeMembership(request.school, request.profileId, { waiting: true, ending: false, endsNow: false });
				if (!gone) notifySuccess(app, "Membership resumed.");
			},
		}).run();
	};
	const cancelBooking = (booking: PortalBooking, name: string): void => {
		const request = { school: school.id, profileId: booking.profileId, bookingId: booking.id };
		retryingWrite(app, (writer) => writer.portalCancelBooking(request), {
			busy: (busy) => {
				if (busy) pending.addBookings(request.school, [request.bookingId]);
			},
			value: () => {
				if (!gone) notifySuccess(app, `Hold released for ${endSentence(name)}`);
			},
			failure: () => pending.removeBookings(request.school, [request.bookingId]),
		}).run();
	};
	const copySnippet = async (snippet: string): Promise<void> => {
		try {
			await navigator.clipboard.writeText(snippet);
			notifySuccess(app, "Snippet copied.");
		} catch {
			notify(app, { tone: "warning", title: "Could not copy the snippet: the browser blocked the clipboard." });
		}
	};
	const downloadHistory = (rows: PortalHistoryRow[]): void => {
		if (!viewed || !portal) return;
		void saveCsv(app, {
			name: historyCsvFileName(viewed.profileId, rows),
			columns: historyCsvColumnsOf(portal.scope === "family"),
			rows,
		});
	};
	const controls: HistoryControls = $derived({
		finance,
		period,
		expanded,
		onPeriod: (chosen: HistoryPeriod) => setParameter("history", chosen === defaultPeriod ? null : chosen),
		onExpand: () => setParameter("historyAll", expanded ? null : "1"),
		onDownload: downloadHistory,
	});
	const handlers: Handlers = {
		onQuantity: () => {
			dialog = "quantity";
		},
		onCancel: () => {
			dialog = "cancel";
		},
		onResume: () => {
			dialog = "resume";
		},
		onCard: () => notify(app, { tone: "info", title: "Opens Stripe's billing portal. Card details stay with Stripe." }),
		onBuy: (addonId) => {
			const addon = portal?.addons.find(({ id }) => id === addonId);
			notify(app, { tone: "info", title: `Member would continue to Stripe Checkout for ${addon?.name ?? ""}.` });
		},
		onBooks: (toast) => notify(app, { tone: "info", title: toast }),
		onCancelBooking: (booking) => cancelBooking(booking, viewed?.name ?? ""),
	};
	const bookingCount = $derived(portal && viewed ? bookingsOf(portal, viewed.profileId).length : 0);
	const leave = (): void => navigate(portalParameters.reduce((next, name) => withQuery(next, name, null), route));
	const failure = $derived(failed ? messageFor(failed) : null);
</script>

{#if failed && failure}
	{#if failed.kind === "not_available"}
		<NotAvailable
			title={failure.title}
			what={`The member portal is not available from the ledger yet. ${failure.what}`}
			doThis={failure.doThis}
			onCheck={() => portalRead.retry()}
			busy={portalRead.busy}
			test="portal-not-available"
		/>
	{:else}
		<LoadFailed error={failed} onRetry={retryFor(failed, () => portalRead.retry())} busy={portalRead.busy} />
	{/if}
	<div class="px-3.5">
		<Button variant="tool" size="tool" data-test="portal-back" onclick={leave}><PaneIcon name="undo" />Back to Members</Button>
	</div>
{:else if missing}
	{#await import("../members/Members.svelte") then { default: Members }}
		<Members {route} {school} {viewing} {navigate} {onRendered} />
	{/await}
{:else if portal && viewed && plan}
	<section class="absolute inset-0 z-85 overflow-auto bg-background" aria-label="Member portal view" data-test="portal">
		<div class="sticky top-0 z-[2] flex flex-wrap items-center gap-2 border-b border-border bg-card px-3.5 py-2.5">
			<Badge
				class={[paneBadge, "border-warning text-warning outline-none focus-visible:border-warning focus-visible:ring-0"]}
				tabindex={-1}
				bind:ref={viewingBar}
				data-test="portal-viewing"
			>
				<Icon name="eye" class="mr-1" />Viewing as {viewed.name}
			</Badge>
			<span class="font-mono text-[10.5px] text-muted-foreground" data-test="portal-id">{viewed.profileId} · {school.name}</span>
			<span class="flex-1"></span>
			<label class="text-muted-foreground" for={themeSelectId}>Site theme</label>
			<select
				id={themeSelectId}
				class="rounded-md border border-border bg-card px-2 py-1 text-[12px] text-foreground"
				data-test="portal-theme"
				oninput={(event) => setParameter("siteTheme", event.currentTarget.value === defaultTheme ? null : event.currentTarget.value)}
			>
				{#each siteThemeIds as id (id)}
					<option value={id} selected={id === themeId}>{siteThemes[id].name}</option>
				{/each}
			</select>
			{#if portal.family}
				<span class="inline-flex items-center gap-1.5" role="group" aria-label="Viewing as">
					<span class="text-muted-foreground">Viewing as:</span>
					<span class="inline-flex overflow-hidden rounded-lg border border-border">
						{#each portal.family.members as member (member.profileId)}
							<button
								type="button"
								class="inline-flex items-center gap-[5px] border-0 bg-card px-3 py-[5px] text-[12px] text-muted-foreground aria-pressed:bg-primary aria-pressed:text-primary-foreground"
								aria-pressed={member.profileId === viewed.profileId}
								data-test="portal-family-switch"
								data-profile={member.profileId}
								title={member.name}
								onclick={() => setParameter("portal", member.profileId)}
							>
								{familyRoleLabel(member.familyRole)}
							</button>
						{/each}
					</span>
				</span>
			{/if}
			<Button variant="tool" size="tool-small" data-test="portal-embed" onclick={() => (dialog = "embed")}>
				<PaneIcon name="plug" />Embed…
			</Button>
			<Button variant="tool" size="tool-small" data-test="portal-exit" onclick={exit}>
				<Icon name="xCircle" />Exit
			</Button>
		</div>
		<div class="m-0 flex items-center gap-1.5 border-b border-border bg-secondary px-3.5 py-2 text-[11px]" data-test="portal-scope">
			<Icon name="lock" class="size-[13px]" />
			<b>Members see only themselves and their family.</b>
			<span class="text-muted-foreground">In this portal: {scopeText(portal, viewed)}</span>
		</div>
		<div class="px-3.5 py-2 text-[10.5px] text-muted-foreground" data-test="portal-note">
			<Icon name="info" class="mr-1 inline size-[13px] align-[-2px]" />This is the member portal as {viewed.name} sees it. This is a preview of the member's view: it shows exactly what they
			see, with no admin tools. Admin actions for this member are in the ⋯ menu on the Members tab.
		</div>
		<div class="px-3.5 pb-5">
			<div class={frame} data-test="portal-frame" data-site-theme={themeId} style={Object.entries(portalFrameVariables(theme)).map(([name, value]) => `${name}:${value}`).join(";")}>
				<div class={siteHeader} data-test="portal-header">
					<b>{school.name}</b>
					<span>Classes</span>
					<span>Schedule</span>
					<span>Shop</span>
					<span class="ml-auto">{viewed.name}</span>
				</div>
				<div class={siteBody}>
					<div class={tabRow} role="tablist" aria-label="Member portal" tabindex="-1" onkeydown={onTabKeyDown}>
						{#each tabs as { id, label, icon } (id)}
							<button
								type="button"
								role="tab"
								id="{tabsId}-{id}"
								class={tabButton}
								aria-selected={id === tab}
								aria-controls={id === tab ? `${tabsId}-panel` : undefined}
								tabindex={id === tab ? 0 : -1}
								data-test="portal-tab"
								data-portal-tab={id}
								onclick={() => chooseTab(id)}
							>
								<PaneIcon name={icon} />{id === "bookings" && bookingCount > 0 ? `${label} (${bookingCount})` : label}
							</button>
						{/each}
					</div>
					<div role="tabpanel" id="{tabsId}-panel" aria-labelledby="{tabsId}-{tab}">
						{#if tab === "overview"}
							<Overview
								{school}
								{portal}
								{viewed}
								{plan}
								{preview}
								{handlers}
								figures={portal.books.audience === loadedPortal?.books.audience ? (figuresLoaded?.figures ?? null) : null}
								{figuresFailure}
								onRetryFigures={() => figuresRead.retry()}
								audienceChangedOn={move?.on ?? null}
							/>
						{:else if tab === "bookings"}
							<BookingsTab {school} {clock} {portal} profileId={viewed.profileId} {preview} pendingBookings={pending.bookings(school.id)} {handlers} />
						{:else if tab === "billing"}
							<BillingTab {school} {clock} {portal} {plan} {preview} {handlers} {controls} />
						{:else}
							<FamilyTab {school} {portal} {viewed} />
						{/if}
					</div>
				</div>
			</div>
		</div>
	</section>
	{#if dialog === "quantity"}
		<QuantityDialog {school} {viewed} {plan} onClose={() => (dialog = null)} onConfirm={(quantity) => changeQuantity(viewed, quantity)} />
	{:else if dialog === "cancel"}
		<CancelDialog {viewed} {plan} onClose={() => (dialog = null)} onConfirm={(reason) => cancelMembership(viewed, reason)} />
	{:else if dialog === "resume"}
		<ResumeDialog {viewed} {plan} onClose={() => (dialog = null)} onConfirm={() => resumeMembership(viewed)} />
	{:else if dialog === "embed"}
		<EmbedDialog {school} {theme} publicYear={figuresLoaded?.publicYear ?? ""} onClose={() => (dialog = null)} onCopy={copySnippet} />
	{/if}
{/if}
