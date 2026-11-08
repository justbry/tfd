<script lang="ts">
	import type { School } from "$contract/data/types.ts";
	import { Button } from "$lib/components/ui/button/index.ts";
	import { Badge } from "$lib/components/ui/badge/index.ts";
	import Icon from "../Icon.svelte";
	import PaneIcon from "../PaneIcon.svelte";
	import type { PaneIconName } from "../pane-icons.ts";
	import { mockBadge, badgeTones } from "../styles.ts";
	import { exitPreviewTitle } from "./notify.ts";
	import type { PlanChange, PlansSession } from "./plans-menu.ts";
	import { emitMenu, type ParsedMenu, parseMenu } from "./plans-yaml.ts";
	import { heading, link, lock, muted } from "./styles.ts";

	const lineHeight = 18;
	const linesAboveJump = 3;

	/** Plans as YAML (mockup `kCodeHtml`, `kBind`): a toolbar, a line-numbered editor, the parse error or the problems with
	 * a jump to each line, and the changes against the published plans. The text is the draft's second view: applying it
	 * is the pane's job (`onType`, `onBlur`). */
	let {
		school,
		session,
		changes,
		problemList,
		owner,
		preview,
		onType,
		onBlur,
		onFormat,
		onReset,
		onToast,
	}: {
		school: School;
		session: PlansSession;
		/** The draft against the live menu, and the draft's problems: worked out once by the pane. */
		changes: PlanChange[];
		problemList: string[];
		/** Owners edit plans; everyone reads and copies. */
		owner: boolean;
		/** An audience other than your own is shown: Format, Reset and the text are read-only. */
		preview: boolean;
		onType: (text: string) => void;
		onBlur: () => void;
		onFormat: () => void;
		onReset: () => void;
		onToast: (text: string) => void;
	} = $props();

	let textarea = $state<HTMLTextAreaElement | null>(null);
	let gutter = $state<HTMLDivElement | null>(null);
	const helpId = $props.id();
	/** What was typed, else the draft in the standard layout. */
	const text = $derived(
		session.yamlText ??
			emitMenu({
				schoolName: school.name,
				version: session.version,
				menu: session.draft,
				stripe: session.stripe,
			}),
	);
	const parsed = $derived(
		parseMenu(text, { version: session.version, previous: session.draft }),
	);
	/** Mockup `kLocate`: the line a problem belongs to, from the plan it names; a missing name is the first unnamed
	 * plan; a limit on memberships or packs is the line of that list. */
	const lineOf = (problem: string, menu: Extract<ParsedMenu, { ok: true }>): number | null => {
		const named = menu.items.find(({ name }) => name && problem.startsWith(`${name}:`));
		if (named) return named.line;
		if (problem === "A plan needs a name.")
			return menu.items.find(({ name }) => !name.trim())?.line ?? null;
		if (/memberships/.test(problem)) return menu.membershipsLine;
		if (/packs/.test(problem)) return menu.packsLine;
		return null;
	};
	const located = $derived(
		problemList.map((problem) => ({ problem, line: parsed.ok ? lineOf(problem, parsed) : null })),
	);
	const badLines = $derived(
		new Set(parsed.ok ? located.flatMap(({ line }) => (line === null ? [] : [line])) : [parsed.line]),
	);
	const writable = $derived(owner && !preview);
	const pill = $derived<{ tone: string; icon: PaneIconName; label: string }>(
		!parsed.ok
			? { tone: "bad", icon: "xCircle", label: `Parse error at line ${parsed.line}` }
			: problemList.length > 0
				? {
						tone: "warn",
						icon: "alert",
						label: `${problemList.length} problem${problemList.length === 1 ? "" : "s"}`,
					}
				: { tone: "ok", icon: "check", label: "Valid" },
	);
	const pillClass: Record<string, string> = {
		ok: "border-success text-success",
		warn: "border-warning text-warning",
		bad: "border-destructive text-destructive",
	};

	const jumpTo = (line: number): void => {
		const area = textarea;
		if (!area) return;
		const rows = area.value.split("\n");
		const start = rows.slice(0, line - 1).reduce((offset, row) => offset + row.length + 1, 0);
		area.focus();
		area.setSelectionRange(start, start + (rows[line - 1]?.length ?? 0));
		area.scrollTop = Math.max(0, (line - linesAboveJump) * lineHeight);
		if (gutter) gutter.scrollTop = area.scrollTop;
	};
	const copy = async (): Promise<void> => {
		try {
			await navigator.clipboard.writeText(text);
			onToast("YAML copied.");
		} catch {
			textarea?.select();
			onToast("Press Ctrl or Cmd+C to copy.");
		}
	};
</script>

{#snippet jumpButton(line: number)}
	<button type="button" class={link} data-line={line} aria-label={`Go to line ${line}`} onclick={() => jumpTo(line)}>line {line}</button>
{/snippet}

<div class="flex flex-wrap items-start gap-3.5">
	<div class="min-w-0 flex-[1_1_440px] max-[640px]:flex-[1_1_100%]">
		<div class="mb-1.5 flex flex-wrap items-center gap-1.5" role="toolbar" aria-label="YAML editor">
			<Button
				variant="tool"
				size="tool-small"
				data-test="plan-yaml-format"
				title={preview ? exitPreviewTitle : "Rewrite the document in the standard layout"}
				disabled={!writable}
				onclick={onFormat}><PaneIcon name="sliders" />Format</Button
			>
			<Button variant="tool" size="tool-small" data-test="plan-yaml-copy" title="Copy the YAML" onclick={copy}
				><PaneIcon name="copy" />Copy</Button
			>
			<Button
				variant="tool"
				size="tool-small"
				data-test="plan-yaml-reset"
				title={preview ? exitPreviewTitle : "Replace the draft with what is published"}
				disabled={!(writable && changes.length > 0)}
				onclick={onReset}><PaneIcon name="undo" />Reset to published</Button
			>
			<span class="flex-1"></span>
			<span
				class={["inline-flex items-center gap-1 rounded-[9px] border px-[9px] py-0.5 text-[11px] whitespace-nowrap", pillClass[pill.tone]]}
				data-test="plan-yaml-status"
				data-tone={pill.tone}
			>
				<PaneIcon name={pill.icon} class="size-3" />{pill.label}
			</span>
		</div>
		<p class="mb-2 text-[11px] text-muted-foreground" id={helpId} data-test="plan-yaml-help">
			<Icon name="info" class="mr-[3px] inline size-3 align-[-2px]" /> Comments are not saved: plans are stored as JSON.
			Anchors, aliases and tags are not accepted.
		</p>
		{#if !owner}
			<div class={lock} data-test="plan-yaml-lock">
				<Icon name="lock" /> Owners edit plans. You can read and copy this YAML.
			</div>
		{/if}
		<div
			class="flex h-[clamp(280px,56vh,560px)] overflow-hidden rounded-[10px] border border-border bg-card focus-within:border-ring max-[640px]:h-[clamp(240px,50vh,420px)]"
		>
			<div
				bind:this={gutter}
				class="box-border w-[46px] flex-none overflow-hidden bg-secondary pt-2 pb-7 text-right font-mono text-[12px] leading-[18px] text-muted-foreground select-none"
				aria-hidden="true"
			>
				{#each text.split("\n") as _, index (index)}
					<i
						class={["block h-[18px] pr-2 not-italic", badLines.has(index + 1) && "font-bold text-destructive shadow-[inset_3px_0_var(--destructive)]"]}
						data-bad={badLines.has(index + 1) ? "" : undefined}
						data-test="plan-yaml-line">{index + 1}</i
					>
				{/each}
			</div>
			<textarea
				bind:this={textarea}
				class="box-border min-h-0 min-w-0 flex-1 resize-none overflow-auto border-0 bg-transparent px-2.5 py-2 font-mono text-[12px] leading-[18px] tab-2 whitespace-pre text-foreground outline-0 read-only:text-muted-foreground"
				spellcheck={false}
				wrap="off"
				autocomplete="off"
				autocapitalize="off"
				aria-label="Plans as YAML"
				aria-describedby={helpId}
				data-test="plan-yaml"
				readonly={!writable}
				bind:value={() => text, onType}
				onblur={onBlur}
				onscroll={(event) => {
					if (gutter) gutter.scrollTop = event.currentTarget.scrollTop;
				}}
			></textarea>
		</div>
		<!-- The one live region of the view: the status pill repeats what this says, so it is not announced twice. -->
		<div class="mt-2 grid gap-[3px]" aria-live="polite" data-test="plan-yaml-message">
			{#if !parsed.ok}
				<div class="text-destructive">
					<Icon name="xCircle" class="inline size-[13px] align-[-2px]" /> Line {parsed.line}: {parsed.message}{" "}
					{@render jumpButton(parsed.line)}
				</div>
				<div class={muted}>The draft is unchanged until this is fixed.</div>
			{:else if located.length > 0}
				{#each located as { problem, line } (problem)}
					<div class="text-destructive">
						<Icon name="alert" class="inline size-[13px] align-[-2px]" /> {problem}{" "}
						{#if line !== null}{@render jumpButton(line)}{/if}
					</div>
				{/each}
			{:else}
				<div class="text-success"><Icon name="check" class="inline size-[13px] align-[-2px]" /> No problems.</div>
			{/if}
		</div>
	</div>
	<aside class="min-w-[240px] flex-[0_1_310px] max-[640px]:flex-[1_1_100%]" aria-label="Changes vs published" data-test="plan-changes">
		<h5 class={heading}>
			<Icon name="list" /> Changes vs published{" "}
			<span class={muted} data-test="plan-changes-count">{changes.length}</span>
		</h5>{" "}
		{#each changes as change (`${change.kind}:${change.id}`)}
			<div class="border-t border-border py-[7px]" data-test="plan-change" data-plan={change.id}>
				<b>{change.name}</b>{" "}
				{#if change.status === "removed"}
					<Badge class={[mockBadge, badgeTones.bad]} data-test="plan-change-badge">Removed</Badge>
				{:else if change.status === "new"}
					<Badge class={[mockBadge, "border-success text-success"]} data-test="plan-change-badge">New</Badge>
				{/if}
				{#each change.lines as line (line.title)}
					<div>
						<div>{line.title}</div>
						<div class={muted}>{line.detail}</div>
					</div>
				{/each}
			</div>
		{:else}
			<div class={muted}>No changes yet. This matches what is published.</div>
		{/each}
	</aside>
</div>
