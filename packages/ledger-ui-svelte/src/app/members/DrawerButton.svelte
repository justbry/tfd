<script lang="ts">
	import { previewLock } from "$contract/data/members.ts";
	import { Button } from "$lib/components/ui/button/index.ts";
	import PaneIcon from "../PaneIcon.svelte";
	import type { PaneIconName } from "../pane-icons.ts";

	/** A button of the drawer: off with its reason as the title, or while a preview is on; busy while its call is on
	 * its way. `primary` is the drawer's main button, `small` the one of a booking row. */
	let {
		icon,
		label,
		reason,
		locked,
		tone = "default",
		hook,
		action,
		bookingId,
		busy = false,
		onclick,
	}: {
		icon: PaneIconName;
		label: string;
		reason: string;
		locked: boolean;
		tone?: "default" | "primary" | "small";
		hook: "drawer-action" | "booking-action";
		action: string;
		bookingId?: string;
		busy?: boolean;
		onclick: () => void;
	} = $props();
	const why = $derived(locked ? previewLock : reason);
</script>

<Button
	variant={tone === "primary" ? "primary" : "tool"}
	size={tone === "small" ? "tool-small" : "tool"}
	data-test={hook}
	data-action={action}
	data-booking={bookingId}
	disabled={why !== "" || busy}
	aria-busy={busy ? "true" : undefined}
	title={why === "" ? undefined : why}
	{onclick}
><PaneIcon name={icon} />{label}</Button>
