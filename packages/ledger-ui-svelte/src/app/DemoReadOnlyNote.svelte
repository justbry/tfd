<script lang="ts">
	import { demoReadOnlyText } from "$contract/http/demo.ts";
	import PaneIcon from "./PaneIcon.svelte";

	/** Shown where a demo school's write controls would be (S8-contract section 11: a demo school refuses every write
	 * with `demo_read_only`), so the pane offers nothing that would only be refused, and says why (the Preact
	 * package's `DemoReadOnlyNote`). */
	let { class: className = "" }: { class?: string } = $props();
</script>

<span class={["text-muted-foreground", className]} data-test="demo-read-only">
	<PaneIcon name="lock" class="mr-1 inline align-[-2px]" />{demoReadOnlyText}
</span>
