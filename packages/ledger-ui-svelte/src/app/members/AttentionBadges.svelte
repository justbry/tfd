<script lang="ts">
	import type { AttentionReason } from "$contract/data/members.ts";
	import { Badge } from "$lib/components/ui/badge/index.ts";
	import { paneBadge } from "../panes/styles.ts";
	import { badgeTones } from "../styles.ts";
	import { attentionLabel } from "./members-model.ts";

	/** Why the person needs attention (mockup `badges`): worst first, each reason its own badge. */
	let { reasons, unitPlural }: { reasons: AttentionReason[]; unitPlural: string } = $props();
</script>

{#each reasons as reason, index (`${reason.kind}-${reason.bookingId}`)}
	{#if index > 0}{" "}{/if}<Badge
		class={[paneBadge, reason.tone === "bad" ? badgeTones.bad : badgeTones.warning]}
		data-test="attention-badge"
		data-kind={reason.kind}>{attentionLabel(reason, unitPlural)}</Badge
	>
{/each}
