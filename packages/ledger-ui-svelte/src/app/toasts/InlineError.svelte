<script lang="ts">
	import type { FieldProblem } from "../../effect/ui-error.ts";
	import Icon from "../Icon.svelte";

	/** A field-level problem shown at the field (S9-plan section 5): the field names this element in
	 * `aria-describedby` and sets `aria-invalid`; the toast carries only the summary. Nothing renders, and nothing is
	 * announced, while there is no problem. */
	let {
		id,
		problems,
	}: { id: string; problems: readonly FieldProblem[] | string | null } = $props();

	const shown = $derived(
		problems === null || problems === ""
			? []
			: typeof problems === "string"
				? [{ path: "", message: problems }]
				: problems,
	);
</script>

<div {id} class="min-h-3.5 text-[10.5px] text-destructive" aria-live="polite" data-test="inline-error">
	{#each shown as problem (problem.path + problem.message)}
		<div class="flex items-start gap-1">
			<Icon name="alert" class="mt-px size-3" />
			<span>
				{problem.message}{#if problem.hint}{" "}<span class="text-muted-foreground">{problem.hint}</span>{/if}
			</span>
		</div>
	{/each}
</div>
