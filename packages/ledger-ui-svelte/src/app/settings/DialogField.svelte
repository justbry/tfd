<script lang="ts">
	import { Input } from "$lib/components/ui/input/index.ts";
	import { control, field, fieldLabel } from "./styles.ts";

	/** A labelled field of a dialog (hook `dialog-field`, by `data-field`). The key, PIN and API-key fields are
	 * passwords; a PIN takes up to 6 digits. */
	let {
		label,
		name,
		value = $bindable(),
		placeholder,
		secret = true,
		numeric = false,
	}: {
		label: string;
		name: "label" | "key" | "pin" | "apiKey";
		value: string;
		placeholder?: string;
		secret?: boolean;
		numeric?: boolean;
	} = $props();
	const id = $props.id();
</script>

<div class={field}>
	<label for={id} class={fieldLabel}>{label}</label>
	<Input
		{id}
		type={secret ? "password" : "text"}
		inputmode={numeric ? "numeric" : undefined}
		maxlength={numeric ? 6 : undefined}
		autocomplete="off"
		{placeholder}
		class={control}
		data-test="dialog-field"
		data-field={name}
		bind:value
	/>
</div>
