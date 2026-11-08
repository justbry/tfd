<script lang="ts">
	import { audienceNames } from "$contract/data/disclosure.ts";
	import type { Person } from "$contract/data/members.ts";
	import PaneIcon from "../PaneIcon.svelte";
	import { audienceIcons } from "./members-model.ts";

	/** The audience the person reads the books at (mockup `audPill`, `.kbk`: the mockup colours Member and Owner only); its title is the server's reason. */
	let { person }: { person: Person } = $props();
	const tones = {
		public: "border-border text-muted-foreground",
		member: "border-chart-2 text-chart-2",
		governance: "border-border text-muted-foreground",
		finance: "border-border text-muted-foreground",
		owner: "border-primary text-primary",
	} as const;
	const { audience } = $derived(person);
</script>

<span
	class={[
		"ml-1 inline-flex items-center rounded-4xl border px-[7px] py-px align-middle text-[10px] font-medium whitespace-nowrap",
		tones[audience],
	]}
	data-test="audience-chip"
	data-audience={audience}
	title={`Audience: ${person.audienceReason}`}
>
	<PaneIcon name={audienceIcons[audience]} class="mr-[3px] size-[11px]" />Audience:{" "}
	{audience === "owner" ? "Owner · everything" : audienceNames[audience]}
</span>
