<script lang="ts">
	import type { Route } from "$contract/app/route.ts";
	import type { School } from "$contract/data/types.ts";
	import { formatRoute } from "$contract/app/route.ts";
	import { onMount } from "svelte";
	import { rosterLock } from "../members/members-model.ts";
	import LockPanel from "../panes/LockPanel.svelte";
	import type { Viewing } from "../viewing.ts";
	import PortalView from "./PortalView.svelte";

	/** What takes the Members pane while `portal=` is in the route (mockup `#vm`): the member portal for the audiences that
	 * see the roster, else the lock panel that stands in for it. */
	let {
		route,
		school,
		viewing,
		navigate,
		onRendered,
		onShownChange,
	}: {
		route: Route;
		school: School;
		viewing: Viewing;
		navigate: (route: Route) => void;
		onRendered: (hash: string) => void;
		onShownChange: (shown: boolean) => void;
	} = $props();

	$effect(() => {
		if (!viewing.option.admin) onRendered(formatRoute(route));
	});
	onMount(() => () => onShownChange(false));
</script>

{#if viewing.option.admin}
	<PortalView {route} {school} {viewing} {navigate} {onRendered} {onShownChange} />
{:else}
	<LockPanel lock={rosterLock} icon="users" hooks="roster" />
{/if}
