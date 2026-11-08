<script lang="ts">
	import type { Person } from "$contract/data/members.ts";
	import PaneIcon from "../PaneIcon.svelte";
	import { roleLabels } from "./members-model.ts";

	/** The person's role at the school (mockup `rolePill`, `.krole`): the colour follows the role. */
	let { role }: { role: Person["role"] } = $props();
	const tones = {
		owner: "border-primary text-primary",
		admin: "border-chart-1 text-chart-1",
		member: "border-border text-muted-foreground",
	} as const;
</script>

<span
	class={[
		"inline-flex items-center rounded-4xl border px-[7px] py-px align-middle text-[10px] font-medium whitespace-nowrap",
		tones[role],
	]}
	data-test="role-chip"
	data-role={role}
>
	<PaneIcon name={role === "member" ? "user" : "key"} class="mr-[3px] size-[11px]" />{roleLabels[role]}
</span>
