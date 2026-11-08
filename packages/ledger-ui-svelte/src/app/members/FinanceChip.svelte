<script lang="ts">
	import type { Person } from "$contract/data/members.ts";

	/** An admin's finance grant (mockup `finPill`, `.kfin`). Owners have money implicitly and show no chip. */
	let { person }: { person: Person } = $props();
</script>

{#if person.role === "admin" && person.financeGrant}
	<span
		class="ml-1 inline-flex items-center rounded-4xl border border-dashed border-success px-1.5 py-px align-middle text-[10px] whitespace-nowrap text-success"
		data-test="finance-chip"
		data-finance
		title="Finance grant: can see money"
	>Finance</span>
{/if}
