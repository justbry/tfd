<script lang="ts">
	import { Button } from "$lib/components/ui/button/index.ts";
	import PaneIcon from "../PaneIcon.svelte";

	/** The ⋯ button of a row or the drawer (mockup `.btn.ico.s`). `focusFirst`: opened from the keyboard, so focus
	 * moves into the menu. */
	let {
		name,
		expanded,
		onOpen,
	}: {
		/** Empty in the drawer, whose heading already names the person. */
		name: string;
		expanded: boolean;
		onOpen: (button: HTMLElement, focusFirst: boolean) => void;
	} = $props();
</script>

<Button
	variant="tool"
	size="tool-small"
	class="px-1.5"
	data-test="member-menu-button"
	aria-label={name === "" ? "More actions" : `More actions for ${name}`}
	aria-haspopup="menu"
	aria-expanded={expanded}
	title="More actions"
	onclick={(event) => onOpen(event.currentTarget, event.detail === 0)}
	onkeydown={(event) => {
		if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
		event.preventDefault();
		onOpen(event.currentTarget, true);
	}}
>
	<PaneIcon name="more" />
</Button>
