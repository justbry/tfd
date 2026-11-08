<script lang="ts">
	import PaneIcon from "../PaneIcon.svelte";
	import { exitPreviewTitle } from "./notify.ts";
	import type { SetupStep, SetupStepKey } from "./overview-model.ts";
	import { Button } from "$lib/components/ui/button/index.ts";
	import { card } from "./styles.ts";

	/** Get started (mockup `setupHtml`): the steps, how many are done, and the next one. Writes are off in a preview. */
	let {
		steps,
		preview,
		onStep,
	}: { steps: SetupStep[]; preview: boolean; onStep: (key: SetupStepKey) => void } = $props();

	const done = $derived(steps.filter((step) => step.done).length);
	const next = $derived(steps.find((step) => !step.done));
	const title = $derived(preview ? exitPreviewTitle : undefined);
</script>

{#if next}
	<div class={[card, "mb-3"]} data-test="plan-setup">
		<div class="mb-1.5 flex items-baseline justify-between">
			<b class="flex items-center"><PaneIcon name="check" class="mr-1" /> Get started</b>
			<span class="text-muted-foreground" data-test="plan-setup-count">{done} of {steps.length} done</span>
		</div>
		<div class="mt-1.5 mb-2.5 h-1.5 overflow-hidden rounded-[3px] bg-secondary">
			<i class="block h-full bg-success" style={`width: ${(done / steps.length) * 100}%`}></i>
		</div>
		<div class="grid grid-cols-2 gap-1.5 max-[640px]:grid-cols-1">
			{#each steps as step (step.key)}
				<button
					type="button"
					class={[
						"flex cursor-pointer items-center gap-2 rounded-[10px] border bg-background p-2 text-left text-foreground disabled:cursor-default",
						step.done ? "border-border opacity-55" : step === next ? "border-primary" : "border-border",
					]}
					data-test="plan-setup-step"
					data-step={step.key}
					data-next={step === next ? "" : undefined}
					data-done={step.done ? "" : undefined}
					title={step.done ? undefined : title}
					disabled={step.done || preview}
					onclick={() => onStep(step.key)}
				>
					<PaneIcon
						name={step.done ? "check" : step === next ? "chevronRight" : "dot"}
						class={step.done ? "text-success" : step === next ? "text-primary" : ""}
					/>
					<span>
						<b>{step.title}</b>
						<small class="block text-[10.5px] text-muted-foreground">{step.detail}</small>
					</span>
				</button>
			{/each}
		</div>
		<div class="mt-2 flex flex-wrap items-center gap-1.5">
			<Button
				variant="primary"
				size="tool"
				data-test="plan-setup-next"
				{title}
				disabled={preview}
				onclick={() => onStep(next.key)}
			>
				Next: {next.title}<PaneIcon name="chevronRight" />
			</Button>
		</div>
	</div>
{/if}
