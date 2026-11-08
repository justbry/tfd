<script lang="ts">
	import { field as fieldClass } from "../panes/styles.ts";
	import Field from "./Field.svelte";

	/** The note a money or credit change needs (3 or more characters). It reports what is typed through `onInput`; a
	 * plain textarea, so that the first page load carries none of Svelte's textarea runtime. */
	let { onInput }: { onInput: (note: string) => void } = $props();
</script>

<Field field="note">
	{#snippet label()}Note (required){/snippet}
	{#snippet children(id)}
		<textarea
			{id}
			class={[fieldClass, "min-h-11 resize-y"]}
			data-test="modal-field"
			data-field="note"
			placeholder="Why, and who asked"
			oninput={(event) => onInput(event.currentTarget.value)}
		></textarea>
	{/snippet}
</Field>
