<script lang="ts">
	import type { Snippet } from "svelte";
	import { fieldBox, fieldLabel } from "../panes/styles.ts";

	/** A labelled field of a modal (mockup `.fld`); `children` gets the id the label points to. */
	let {
		field,
		label,
		children,
	}: { field: string; label: Snippet; children: Snippet<[string]> } = $props();
	const id = $props.id();
</script>

<div class={fieldBox}>
	<label for={id} class={fieldLabel} data-test="modal-field-label" data-field={field}>{@render label()}</label>
	{@render children(id)}
</div>
