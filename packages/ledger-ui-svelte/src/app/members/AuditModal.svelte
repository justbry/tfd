<script lang="ts">
	import { onDestroy, onMount } from "svelte";
	import { jsonMediaType } from "$contract/data/ledger.ts";
	import type { MemberAudit } from "$contract/data/members.ts";
	import { read } from "../../effect/run.ts";
	import type { UiError } from "../../effect/ui-error.ts";
	import { useApp } from "../context.ts";
	import LoadFailed from "../LoadFailed.svelte";
	import { retryFor } from "../panes/retry-for.ts";
	import PaneIcon from "../PaneIcon.svelte";
	import { retryingRead } from "../retrying-read.ts";
	import { errorText, muted, okText } from "../panes/styles.ts";
	import { notifySuccess, retryingWrite } from "../panes/writes.ts";
	import ModalFrame from "./ModalFrame.svelte";
	import type { ModalContext } from "./modal-context.ts";

	/** The audit of one person (capability `audit`): the server's steps in order, then its verdict. Until the server
	 * answers there is only a loading line, never a verdict; if it cannot be read the modal says why, in the message
	 * table's words, with Retry. The read has its own toast owner and goes when the modal does. */
	let { context }: { context: ModalContext } = $props();
	const app = useApp();
	// svelte-ignore state_referenced_locally
	const { write } = context;
	const personId = write.person.id;
	let audit = $state<MemberAudit | null>(null);
	let failure = $state<UiError | null>(null);
	let busy = $state(false);
	let saving = $state(false);
	const reading = retryingRead(
		app,
		() => read((reader) => reader.auditMember({ schoolId: write.schoolId, personId })),
		{
			value: (loaded) => {
				audit = loaded;
				failure = null;
			},
			failure: (error) => {
				failure = error;
			},
			busy: (next) => {
				busy = next;
			},
		},
	);
	onMount(() => {
		reading.run();
	});
	onDestroy(() => reading.cancel());

	const plural = (count: number, noun: string): string => `${count} ${noun}${count === 1 ? "" : "s"}`;
	/** "Clean." or the count of steps the server marked as failed ("1 problem."). */
	const auditLabel = ({ clean, steps }: MemberAudit): string =>
		clean ? "Clean." : `${plural(steps.filter(({ ok }) => !ok).length, "problem")}.`;

	/** "Export report" saves the audit as JSON through the Writer (a failure is a toast with Retry). */
	const exportReport = (): void => {
		if (!audit) return;
		const report = audit;
		saving = true;
		retryingWrite(
			app,
			(writer) =>
				writer.download({
					name: report.reportFileName,
					type: jsonMediaType,
					text: JSON.stringify(report, null, 2),
				}),
			{
				value: () => {
					saving = false;
					notifySuccess(app, `${report.reportFileName} downloaded.`);
				},
				failure: () => {
					saving = false;
				},
			},
		).run();
	};
</script>

{#snippet verdict()}
	{#if audit}
		<b class={audit.clean ? okText : errorText}>{auditLabel(audit)}</b> {audit.verdict}
	{/if}
{/snippet}

<ModalFrame
	subtitle="Replays the event log and compares it with the live balance and Stripe"
	cancelLabel="Close"
	confirm={audit ? { label: "Export report", tone: "plain", icon: "download", disabled: false, onConfirm: exportReport } : undefined}
	preview={audit ? verdict : undefined}
	busy={saving}
	onCancel={context.onCancel}
>
	{#snippet heading()}<PaneIcon name="check" class="mr-1 inline" /> Audit {write.person.name}{/snippet}
	{#if failure}
		<LoadFailed error={failure} onRetry={retryFor(failure, () => reading.run())} {busy} />
	{:else if audit === null}
		<p class={[muted, "mt-2.5 mb-0"]} data-test="audit-loading" aria-live="polite">Replaying the log…</p>
	{:else}
		<ul class="mt-2.5 mb-0 list-none p-0">
			{#each audit.steps as step, index (index)}
				<li class="flex gap-2 border-t border-border py-[7px] first:border-t-0">
					<span class={step.ok ? okText : errorText}><PaneIcon name={step.ok ? "check" : "xCircle"} /></span>
					<span>{step.text}</span>
				</li>
			{/each}
		</ul>
	{/if}
</ModalFrame>
