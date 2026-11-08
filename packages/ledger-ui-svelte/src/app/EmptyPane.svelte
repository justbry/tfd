<script lang="ts">
	import type { SchoolTab } from "$contract/app/route.ts";
	import type { School } from "$contract/data/types.ts";
	import Icon from "./Icon.svelte";
	import { tabNames } from "./shell-model.ts";

	/** A tab's pane before its slice fills it (S9.0): the route, the period and the school are live; the content
	 * arrives in the slice named. */
	let { tab, school }: { tab: SchoolTab; school: School } = $props();
	const name = $derived(tabNames[tab]);
</script>

<div class="flex flex-col items-start gap-1 py-6 text-muted-foreground" data-test="empty-pane" data-pane={tab}>
	<h2 class="m-0 flex items-center gap-1.5 text-[14px] font-semibold text-foreground">
		<Icon name={name.icon} />{name.label}
	</h2>
	<p class="m-0">{name.label} for {school.name} arrives in {name.slice}.</p>
</div>
