<script lang="ts">
	import Icon from "../Icon.svelte";

	/** A figure the audience may not see, with why (mockup `kFigHtml`). */
	let { text }: { text: string } = $props();
</script>

<span
	class="inline-flex items-center gap-[3px] text-left text-[10.5px] font-medium whitespace-normal text-muted-foreground"
	data-test="plan-hid"
	data-hid="no_grant"
	title={text}
><Icon name="lock" class="size-[11px]" />{text}</span>
