<script lang="ts">
	import Icon from "./Icon.svelte";
	
	/** What a demo school shows on a tab it has no data for (the Shell's `demoNoteTabs`: Promos), never an empty pane
	 * (the Preact package's `DemoTabNote`). */
</script>

<output
	class="mb-2 flex items-center gap-2 rounded-xl border border-warning px-2.5 py-[7px] text-warning"
	data-test="demo-tab-note">
	<Icon name="alert" />
	<span>Not available for demo schools: the demo scenarios hold no promo or gift events.</span>
</output>
