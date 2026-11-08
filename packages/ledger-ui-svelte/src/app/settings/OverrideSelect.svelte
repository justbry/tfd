<script lang="ts">
	import { overrideLabel, selectControl } from "./styles.ts";

	/** One select of the override editor (hooks `override-field` and `override-label`, by `data-field`). It reacts to
	 * `input`, as the mockup's `data-dov` selects do. */
	let {
		field,
		label,
		value,
		options,
		disabled,
		describedby,
		onChange,
	}: {
		field: string;
		label: string;
		value: string;
		options: Array<[string, string]>;
		disabled: boolean;
		describedby?: string | undefined;
		onChange: (value: string) => void;
	} = $props();
	const id = $props.id();
</script>

<div>
	<label for={id} class={overrideLabel} data-test="override-label" data-field={field}>{label}</label>
	<select
		{id}
		class={selectControl}
		data-test="override-field"
		data-field={field}
		{disabled}
		aria-describedby={disabled ? describedby : undefined}
		oninput={(event) => onChange(event.currentTarget.value)}
	>
		{#each options as [optionValue, text] (optionValue)}
			<option value={optionValue} selected={optionValue === value}>{text}</option>
		{/each}
	</select>
</div>
