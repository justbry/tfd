<script lang="ts">
	import { financeOnly } from "$contract/data/members.ts";
	import PaneIcon from "../PaneIcon.svelte";

	/** What a viewer without finance sees in place of money (mockup `data-hid="no_grant"`): `strip` is the stat's
	 * (with the lock), `person` a payment in the drawer (its title says per person). */
	let { place }: { place: "strip" | "person" } = $props();
</script>

<span
	class="inline-flex items-center gap-[3px] text-left text-[10.5px] font-medium whitespace-normal text-muted-foreground"
	data-hid="no_grant"
	title={place === "strip" ? financeOnly.title : financeOnly.personTitle}
>
	{#if place === "strip"}<PaneIcon name="lock" class="size-[11px]" />{/if}{financeOnly.text}
</span>
