<script lang="ts">
	import "./plans.css";
	import { onDestroy, untrack } from "svelte";
	import { parsePeriod, snapPeriod } from "$contract/app/period.ts";
	import { formatRoute, type Route, type SchoolTab, withQuery } from "$contract/app/route.ts";
	import { type Menu, type PlanSummary, planLimits } from "$contract/data/plans.ts";
	import type { School } from "$contract/data/types.ts";
	import { Badge } from "$lib/components/ui/badge/index.ts";
	import { Button } from "$lib/components/ui/button/index.ts";
	import { withRetry } from "../../effect/retry.ts";
	import { write } from "../../effect/run.ts";
	import { toUiError, type UiError } from "../../effect/ui-error.ts";
	import { useApp } from "../context.ts";
	import { perform } from "../context.ts";
	import DemoReadOnlyNote from "../DemoReadOnlyNote.svelte";
	import Icon from "../Icon.svelte";
	import LedgerCopySheet from "./LedgerCopy.svelte";
	import LoadFailed from "../LoadFailed.svelte";
	import PlanDrawer from "./PlanDrawer.svelte";
	import PlanPublishDialog from "./PlanPublishDialog.svelte";
	import NotAvailable from "./NotAvailable.svelte";
	import PaneIcon from "../PaneIcon.svelte";
	import { type RetryingRead, retryingRead } from "../retrying-read.ts";
	import { badgeTones, mockBadge } from "../styles.ts";
		import type { Viewing } from "../viewing.ts";
	import { LedgerCopy } from "./ledger-copy.svelte.ts";
	import { seedFromMenu } from "./ledger-seed.ts";
	import { exitPreviewTitle, notify } from "./notify.ts";
	import { reviewReason, setupSteps, type SetupStepKey, viewedMonthOf } from "./overview-model.ts";
	import PlanCode from "./PlanCode.svelte";
	import PlanPreview from "./PlanPreview.svelte";
	import PlanSetup from "./PlanSetup.svelte";
	import PlanStrip from "./PlanStrip.svelte";
	import PlanTables from "./PlanTables.svelte";
	import { loadMenu, loadSummary, type LoadedMenu, readPublished, sessionOf } from "./plans-load.ts";
	import {
		audienceMoves,
		canonical,
		changeCount,
		diffMenus,
		type PlanKind,
		type PlansSession,
		plansViewOf,
		problems,
		slug,
		stripeFactsOf,
		tierCount,
		withDraft,
	} from "./plans-menu.ts";
	import { plansStoreOf } from "./plans-store.svelte.ts";
	import { parseMenu } from "./plans-yaml.ts";
	import type { PreviewSource } from "./preview-model.ts";
	import { muted, note, segment, segmentButton, tools } from "./styles.ts";

	type Mode = "edit" | "preview" | "code";
	const savedToast = "Saved to the draft. Nothing is live until you publish.";
	const saveFirstToast = "The draft is not saved yet. Retry the save, then publish.";
	/** The route parameters only the Plans tab reads: left behind when a link goes to another tab. */
	const planParameters = ["mode", "show", "billing"];
	const yamlPauseMilliseconds = 250;
	const modes: Array<{ mode: Mode; label: string; icon: "edit" | "eye" | "code" }> = [
		{ mode: "edit", label: "Edit", icon: "edit" },
		{ mode: "preview", label: "Preview", icon: "eye" },
		{ mode: "code", label: "Code", icon: "code" },
	];

	/** The Plans pane (mockup `plans()`): one draft shown three ways, Edit (the tables and the plan drawer), Preview (the
	 * purchase page) and Code (YAML), chosen by `?mode=` and `?show=`, `?billing=`. The draft and the live menu are the
	 * session; a change to the draft is saved whole with `saveMenu` unless it has problems, and Review and publish calls
	 * `publishMenu` and then shows the draft as the new live version. The menu save and publish stay in buzz-school (D19),
	 * through the Writer: it creates the Stripe objects. The audience is `?as=`: the owner and finance admins see
	 * everything, an admin the structure, governance banded counts of the live plans, below it prices only; any other
	 * audience than your own turns every write off.
	 *
	 * Reads go through the Effect layer as two independent reads (the menu and the summary), each with its toast owner,
	 * Retry and message; where the summary has no source (the HTTP build) the pane says so in place. Writes carry the
	 * Writer's own Idempotency-Key (its pending store reuses it for the same request), so a Retry is the same write. */
	let {
		route,
		school,
		viewing,
		navigate,
		onRendered,
		onOpenSettings,
		onDraftChange,
	}: {
		route: Route;
		school: School;
		viewing: Viewing;
		navigate: (route: Route) => void;
		onRendered: (hash: string) => void;
		/** Get started's Connect Stripe: the settings drawer. */
		onOpenSettings: () => void;
		/** Says whether the school's draft differs from its live menu: the tabs row's draft badge follows it. */
		onDraftChange: (school: string, changed: boolean) => void;
	} = $props();

	const app = useApp();
	const store = plansStoreOf(app);
	const { today } = app.calendar;
	const reasonId = $props.id();

	const session = $derived<PlansSession | undefined>(store.sessions[school.id]);
	let editing = $state<{ kind: PlanKind; id: string | null } | null>(null);
	let reviewing = $state(false);
	let publishing = $state(false);
	let ledgerCopy = $state<LedgerCopy | null>(null);
	let pinField = $state<HTMLInputElement | null>(null);

	// ---- reads: the menu and the summary, each its own retrying read
	let menuFailure = $state<{ school: string; error: UiError } | null>(null);
	let summaryFailure = $state<{ school: string; error: UiError } | null>(null);
	let menuBusy = $state(false);
	let summaryBusy = $state(false);
	let menuRead: RetryingRead | null = null;
	let summaryRead: RetryingRead | null = null;
	$effect(() => {
		const asked = school;
		if (untrack(() => store.sessions[asked.id])) return;
		let menu: LoadedMenu | null = null;
		let summary: PlanSummary | null = null;
		const assemble = (): void => {
			if (menu && summary) store.set(asked.id, sessionOf(asked, menu, summary));
		};
		const reading = retryingRead(app, () => loadMenu(asked), {
			value: (loaded) => {
				menu = loaded;
				menuFailure = null;
				assemble();
			},
			failure: (error) => {
				menuFailure = { school: asked.id, error };
			},
			busy: (busy) => {
				menuBusy = busy;
			},
		});
		const summaryReading = retryingRead(app, () => loadSummary(asked), {
			value: (loaded) => {
				summary = loaded;
				summaryFailure = null;
				assemble();
			},
			failure: (error) => {
				summaryFailure = { school: asked.id, error };
			},
			busy: (busy) => {
				summaryBusy = busy;
			},
		});
		menuRead = reading;
		summaryRead = summaryReading;
		reading.run();
		summaryReading.run();
		return () => {
			reading.cancel();
			summaryReading.cancel();
			if (menuRead === reading) menuRead = null;
			if (summaryRead === summaryReading) summaryRead = null;
		};
	});
	const failures = $derived(
		session
			? []
			: [
					menuFailure?.school === school.id ? { error: menuFailure.error, retry: () => menuRead?.run(), busy: menuBusy, which: "menu" } : null,
					summaryFailure?.school === school.id ? { error: summaryFailure.error, retry: () => summaryRead?.run(), busy: summaryBusy, which: "summary" } : null,
				].filter((failure) => failure !== null),
	);
	$effect(() => {
		const hash = formatRoute(route);
		if (session || failures.length > 0) onRendered(hash);
	});

	// ---- saves and the draft
	let saveToast: string | null = null;
	let actions = 0;
	/** One save: the whole menu through the Writer, retried (same request, so the same Idempotency-Key) while it may
	 * be; a failure is a toast with Retry and the pane's "Retry save". Resolves to whether the server took it. */
	const persist = async (schoolId: string, menu: Menu): Promise<boolean> => {
		actions += 1;
		const owner = `plans-save-${schoolId}`;
		const outcome = await perform(
			app,
			withRetry(
				write((writer) => writer.saveMenu(schoolId, menu)),
				{ kind: "write", idempotencyKey: `save-${schoolId}-${actions}` },
				{ owner },
			),
			{
				owner,
				handlers: { retry: () => retrySave() },
			},
		);
		if (saveToast !== null) app.toasts.dismiss(saveToast);
		saveToast = outcome.ok || outcome.interrupted ? null : outcome.toastId;
		return outcome.ok;
	};
	const saveDraft = (menu: Menu): void => {
		const schoolId = school.id;
		const current = store.sessions[schoolId];
		if (!current) return;
		const mine = current.savesStarted + 1;
		const attempt = current.lastSave.then(() => persist(schoolId, menu));
		store.set(schoolId, { ...current, saveStatus: "saving", savesStarted: mine, lastSave: attempt });
		void attempt.then((saved) => {
			store.set(schoolId, (before) =>
				before.savesStarted === mine ? { ...before, saveStatus: saved ? "saved" : "failed" } : before,
			);
		});
	};
	const retrySave = (): void => {
		const current = store.sessions[school.id];
		if (current) saveDraft(current.draft);
	};
	/** Makes `menu` the draft; a draft with problems stays on screen, unsaved. */
	const changeDraft = (menu: Menu): void => {
		const current = store.sessions[school.id];
		if (!current) return;
		store.set(school.id, withDraft(current, menu));
		if (problems(menu).length === 0) saveDraft(menu);
	};

	// ---- the Code view's typing (mockup `kApply`, `kFlush`)
	let yamlTimer: ReturnType<typeof setTimeout> | null = null;
	const cancelYaml = (): void => {
		if (yamlTimer !== null) clearTimeout(yamlTimer);
		yamlTimer = null;
	};
	onDestroy(cancelYaml);
	const applyYaml = (): void => {
		cancelYaml();
		const current = store.sessions[school.id];
		if (!current || current.yamlText === null) return;
		const parsed = parseMenu(current.yamlText, { version: current.version, previous: current.draft });
		if (!parsed.ok || canonical(parsed.menu) === canonical(current.draft)) return;
		store.set(school.id, withDraft(current, parsed.menu, current.yamlText));
		if (problems(parsed.menu).length === 0) saveDraft(parsed.menu);
	};
	const typeYaml = (text: string): void => {
		const current = store.sessions[school.id];
		if (!current) return;
		store.set(school.id, { ...current, yamlText: text });
		cancelYaml();
		yamlTimer = setTimeout(applyYaml, yamlPauseMilliseconds);
	};
	const flushYaml = (): void => {
		if (yamlTimer !== null) applyYaml();
	};
	const formatYaml = (): void => {
		applyYaml();
		const current = store.sessions[school.id];
		if (!current) return;
		const parsed =
			current.yamlText === null
				? null
				: parseMenu(current.yamlText, { version: current.version, previous: current.draft });
		if (parsed && !parsed.ok) {
			notify(app, `Fix line ${parsed.line} before formatting.`);
			return;
		}
		store.set(school.id, { ...current, yamlText: null });
		notify(app, "Formatted.");
	};

	// ---- what the route and the session say
	const view = $derived(plansViewOf(viewing));
	const owner = $derived(school.role === "owner");
	/** A demo school refuses every write: it shows the tables alone, with no control that would write. */
	const readOnly = $derived(school.demo);
	const modeAsked = $derived(route.query.get("mode"));
	const mode = $derived<Mode>(
		!readOnly && (modeAsked === "preview" || modeAsked === "code") ? modeAsked : "edit",
	);
	const changes = $derived(session ? diffMenus(session.live, session.draft) : []);
	$effect(() => {
		if (session) onDraftChange(school.id, changes.length > 0);
	});
	const problemList = $derived(session ? problems(session.draft) : []);
	const askedShow = $derived(route.query.get("show"));
	const show = $derived<PreviewSource>(
		askedShow === "live" || askedShow === "draft" ? askedShow : changes.length > 0 ? "draft" : "live",
	);
	const yamlBroken = $derived(
		session !== undefined &&
			session.yamlText !== null &&
			!parseMenu(session.yamlText, { version: session.version, previous: session.draft }).ok,
	);
	const reason = $derived(
		session
			? reviewReason({
					preview: view.preview,
					yamlBroken,
					problemCount: problemList.length,
					stripeConnected: session.summary.stripeConnected,
					saveStatus: session.saveStatus,
					changeCount: changes.length,
				})
			: undefined,
	);
	const canPublish = $derived(reason === undefined);
	const writeTitle = $derived(view.preview ? exitPreviewTitle : undefined);
	const viewedMonth = $derived(
		viewedMonthOf(
			snapPeriod(parsePeriod(route.query.get("month") ?? school.dashboardOpensOn ?? null, today), viewing.view),
			today,
		),
	);
	const shownTiers = $derived(
		session
			? view.admin
				? session.draft.tiers
				: session.live.tiers.filter(({ public: onSale }) => onSale || view.audience === "governance")
			: [],
	);
	const editedItem = $derived(
		session && editing !== null && editing.id !== null
			? ((editing.kind === "tiers" ? session.draft.tiers : session.draft.addons).find(({ id }) => id === editing?.id) ?? null)
			: null,
	);
	const affectedMembers = $derived(
		session
			? changes.reduce(
					(sum, { kind, id, status }) => (kind === "tiers" && status !== "new" ? sum + tierCount(session.summary, id).active : sum),
					0,
				)
			: 0,
	);

	const chooseMode = (chosen: Mode): void => navigate(withQuery(route, "mode", chosen === "edit" ? null : chosen));
	/** To another tab, leaving the plans' own parameters behind and putting `first` ahead of the rest. */
	const leave = (tab: SchoolTab, first?: [string, string]): void => {
		const query = new URLSearchParams(first ? [first] : []);
		for (const [name, value] of route.query) if (!planParameters.includes(name)) query.append(name, value);
		navigate({ schoolId: school.id, tab, query });
	};
	const open = (kind: PlanKind, id: string | null): void => {
		editing = { kind, id };
	};

	/** Publishes once the last save has settled, with the family PIN typed in the review: the Writer opens the PIN with
	 * it (buzz-school checks it on the session) and keeps it nowhere. */
	const publish = async (pin: string): Promise<void> => {
		const schoolId = school.id;
		const current = store.sessions[schoolId];
		if (!current) return;
		publishing = true;
		if (!(await current.lastSave)) {
			publishing = false;
			notify(app, saveFirstToast);
			return;
		}
		actions += 1;
		const owner = `plans-publish-${schoolId}`;
		const published = await perform(
			app,
			withRetry(
				write((writer) => writer.publishMenu(schoolId, pin)),
				{ kind: "write", idempotencyKey: `publish-${schoolId}-${actions}` },
				{ owner },
			),
			{ owner, handlers: { enter_pin: () => pinField?.focus() } },
		);
		if (!published.ok) {
			publishing = false;
			return;
		}
		const version = (store.sessions[schoolId]?.version ?? 0) + 1;
		const body = await app.runtime.runPromise(readPublished(schoolId, version));
		const after = store.sessions[schoolId];
		if (after) {
			const moves = audienceMoves(after.live, after.draft, today);
			if (Object.keys(moves).length > 0) store.move(schoolId, moves);
			store.set(schoolId, {
				...after,
				version,
				live: after.draft,
				stripe: body && body.publishedAt !== null ? body.stripe : stripeFactsOf(after.draft, after.stripe),
				yamlText: null,
			});
			notify(app, `Published v${version}. The Stripe prices are being updated.`);
		}
		// The review is the school's it was opened for: another school's is not this publish's to close.
		if (school.id === schoolId) {
			publishing = false;
			reviewing = false;
		}
	};
	const copyPurchaseLink = async (): Promise<void> => {
		const schoolId = school.id;
		const link = `https://b4uni.com/join/${slug(school.name)}`;
		try {
			await navigator.clipboard.writeText(link);
		} catch {
			notify(app, "Could not copy the link: the browser blocked the clipboard.");
			return;
		}
		const current = store.sessions[schoolId];
		if (current) store.set(schoolId, { ...current, summary: { ...current.summary, purchaseLinkShared: true } });
		notify(app, `Purchase link copied: ${link}`);
	};
	/** Mockup `doSetup`. */
	const runStep = (key: SetupStepKey): void => {
		if (!session) return;
		if (key === "stripe") onOpenSettings();
		else if (key === "plan") open("tiers", null);
		else if (key === "link") void copyPurchaseLink();
		else if (!session.summary.stripeConnected) {
			notify(app, "Connect Stripe first.");
			onOpenSettings();
		} else if (changes.length === 0) {
			notify(app, "Add a membership first.");
			open("tiers", null);
		} else if (yamlBroken) notify(app, "Fix the YAML first.");
		else if (problemList.length > 0) notify(app, "Fix the problems in the plan first.");
		else reviewing = true;
	};

	// ---- the copy in the ledger (R2 config, D18)
	const openLedgerCopy = (): void => {
		const current = store.sessions[school.id];
		if (!current) return;
		const copy = new LedgerCopy({
			app,
			school: school.id,
			seed: () =>
				seedFromMenu(current.draft, {
					draftVersion: changes.length > 0 ? current.version + 1 : null,
					purchaseLinkShared: current.summary.purchaseLinkShared,
				}),
		});
		ledgerCopy = copy;
		copy.load();
	};
	const closeLedgerCopy = (): void => {
		ledgerCopy?.dispose();
		ledgerCopy = null;
	};
	/** Another school (Back, Forward, a typed hash): what was open for the one before leaves with it, so that a sheet, a
	 * dialog or a save never speaks for the school now on screen. The copy in the ledger is disposed: its verify, load and
	 * save in flight are let go, with their toasts. */
	$effect(() => {
		void school.id;
		return () => {
			closeLedgerCopy();
			editing = null;
			reviewing = false;
			publishing = false;
		};
	});
	const ledgerCopyTitle = $derived(
		view.preview ? exitPreviewTitle : owner ? undefined : "Owners write the copy in the ledger",
	);
</script>

{#if failures.length > 0}
	{#each failures as failure (failure.which)}
		{#if failure.error.kind === "not_available"}
			<NotAvailable
				test="plans-unavailable"
				title="Plans are not available yet"
				what={failure.which === "summary"
					? "The counts, the month's gross and the Get started facts behind this tab have no source yet: buzz-school's members route is not built. Nothing is shown in their place, never a 0 or a sample."
					: "The menu versions have no source yet, so nothing is shown here, never a 0 or a sample."}
				doThis="Your plans are safe in buzz-school and nothing here was changed. Check again once the route ships."
				onCheck={failure.retry}
				busy={failure.busy}
			/>
		{:else}
			<LoadFailed error={failure.error} onRetry={failure.retry} busy={failure.busy} />
		{/if}
	{/each}
{:else if session}
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div onclickcapture={flushYaml} data-test="plans">
		<div inert={editing !== null || reviewing || ledgerCopy !== null}>
			{#if view.admin && !readOnly}
				<PlanSetup
					steps={setupSteps({
						stripeConnected: session.summary.stripeConnected,
						hasDraftMembership: session.draft.tiers.length > 0,
						hasPublishedPlans: session.live.tiers.length + session.live.addons.length > 0,
						purchaseLinkShared: session.summary.purchaseLinkShared,
					})}
					preview={view.preview}
					onStep={runStep}
				/>
			{/if}
			{#if mode === "edit" && view.admin && session.live.tiers.length > 0}
				<PlanStrip
					{view}
					summary={session.summary}
					currency={session.live.currency}
					attentionCount={school.attentionCount}
					{viewedMonth}
					onMembers={() => leave("members")}
					onDashboard={() => leave("dashboard")}
				/>
			{/if}
			{#if !view.finance}
				<p class={[muted, "mb-2"]} data-test="plan-books-note">
					<Icon name="info" class="inline align-[-2px]" /> Per-plan members and revenue are a breakdown: finance admins, the
					owner and governance see them.{view.audience === "admin"
						? " Admins without the finance grant see the plan structure; this default is the owner's to change."
						: ""}
				</p>
			{/if}
			<div class={tools}>
				<b>Plans</b>
				<Badge class={[mockBadge, "text-muted-foreground"]} variant="outline" data-test="plan-version"
					>{session.version > 0 ? `v${session.version} published` : "Not published yet"}</Badge
				>
				{#if changes.length > 0}
					<Badge class={[mockBadge, badgeTones.warning]} data-test="plan-draft-badge"
						><PaneIcon name="edit" class="mr-[3px] size-[11px] align-[-1px]" />Draft · {changeCount(changes.length)}</Badge
					>
				{/if}
				<!-- On the left: the demo alert covers the toolbar's right end. -->
				{#if readOnly}
					<DemoReadOnlyNote />
				{:else}
					<span class="flex-1"></span>
					<div class={segment} role="group" aria-label="Plans view">
						{#each modes as option (option.mode)}
							<button
								type="button"
								class={segmentButton}
								aria-pressed={option.mode === mode}
								data-test="plan-mode"
								data-mode={option.mode}
								onclick={() => chooseMode(option.mode)}><PaneIcon name={option.icon} />{option.label}</button
							>
						{/each}
					</div>
					{#if changes.length > 0}
						<Button
							variant="tool"
							size="tool"
							data-test="plan-discard"
							title={writeTitle}
							disabled={view.preview}
							onclick={() => {
								changeDraft(session.live);
								notify(app, "Draft discarded.");
							}}><PaneIcon name="undo" />Discard draft</Button
						>
					{/if}
					<Button
						variant="primary"
						size="tool"
						data-test="plan-review"
						title={reason}
						aria-describedby={reason ? reasonId : undefined}
						disabled={!canPublish}
						onclick={() => (reviewing = true)}><PaneIcon name="upload" />Review and publish</Button
					>
					{#if reason}<span class="sr-only" id={reasonId}>{reason}</span>{/if}
					{#if session.saveStatus === "failed" && problemList.length === 0}
						<Button variant="tool" size="tool-small" data-test="plan-retry-save" onclick={retrySave}
							><PaneIcon name="undo" />Retry save</Button
						>
					{/if}
				{/if}
			</div>
			{#if problemList.length > 0 && mode !== "code"}
				<div class={note}>
					<Icon name="alert" />
					<span data-test="plan-problems"
						>{problemList.length} problem{problemList.length === 1 ? "" : "s"}: {problemList[0]}{problemList.length > 1
							? ` (+${problemList.length - 1} more)`
							: ""}</span
					>
				</div>
			{/if}
			{#if mode === "edit"}
				<PlanTables
					{view}
					menu={view.admin ? session.draft : session.live}
					tiers={shownTiers}
					summary={session.summary}
					changedIds={new Set(changes.map(({ id }) => id))}
					removedNames={changes.filter(({ status }) => status === "removed").map(({ name }) => name)}
					full={{
						tiers: session.draft.tiers.length >= planLimits.tiers,
						addons: session.draft.addons.length >= planLimits.addons,
					}}
					{owner}
					{readOnly}
					onOpen={open}
					onMembers={(tierId) => leave("members", ["plan", tierId])}
				/>
				{#if view.admin && !readOnly}
					<div class={[muted, "mt-2 flex flex-wrap items-center gap-1.5"]} data-test="plan-ledger-copy-row">
						<PaneIcon name="layers" />
						<span>The copy kept in the ledger: names, descriptions, order and audiences, never prices.</span>
						<Button
							variant="tool"
							size="tool-small"
							data-test="plan-ledger-copy"
							title={ledgerCopyTitle}
							disabled={!owner || view.preview}
							onclick={openLedgerCopy}><PaneIcon name="edit" />Edit ledger copy</Button
						>
					</div>
				{/if}
			{:else if mode === "preview"}
				<PlanPreview
					schoolId={school.id}
					schoolName={school.name}
					audience={viewing.option.audience}
					version={session.version}
					live={session.live}
					draft={session.draft}
					{changes}
					{show}
					yearly={route.query.get("billing") === "year"}
					onShow={(chosen) => navigate(withQuery(route, "show", chosen))}
					onBilling={(yearly) => navigate(withQuery(route, "billing", yearly ? "year" : null))}
					onEdit={open}
					onToast={(text) => notify(app, text)}
				/>
			{:else}
				<PlanCode
					{school}
					{session}
					{changes}
					{problemList}
					{owner}
					preview={view.preview}
					onType={typeYaml}
					onBlur={flushYaml}
					onFormat={formatYaml}
					onReset={() => {
						cancelYaml();
						changeDraft(session.live);
						notify(app, "Draft reset to the published plans.");
					}}
					onToast={(text) => notify(app, text)}
				/>
			{/if}
		</div>
		{#if editing && (editing.id === null || editedItem)}
			{#key `${editing.kind}:${editing.id ?? "new"}`}
									<PlanDrawer
						{school}
						root={app.root}
						menu={session.draft}
						kind={editing.kind}
						item={editedItem}
						activeMembers={editing.kind === "tiers" && editedItem ? tierCount(session.summary, editedItem.id).active : null}
						{viewing}
						onSave={(menu) => {
							changeDraft(menu);
							editing = null;
							notify(app, savedToast);
						}}
						onClose={() => (editing = null)}
					/>
			{/key}
		{/if}
		{#if reviewing}
							<PlanPublishDialog
					schoolName={school.name}
					fromVersion={session.version}
					{changes}
					{affectedMembers}
					{owner}
					pending={publishing}
					onPublish={publish}
					onCancel={() => (reviewing = false)}
					bind:pinField
				/>
		{/if}
		{#if ledgerCopy}
							<LedgerCopySheet {school} root={app.root} copy={ledgerCopy} onClose={closeLedgerCopy} />
		{/if}
	</div>
{/if}
