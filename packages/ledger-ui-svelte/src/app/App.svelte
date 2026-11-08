<script lang="ts">
	import { onMount } from "svelte";
	import {
		formatRoute,
		parseRoute,
		type Route,
		themeOf,
	} from "$contract/app/route.ts";
	import type { School } from "$contract/data/types.ts";
	import { read } from "../effect/run.ts";
	import type { UiError } from "../effect/ui-error.ts";
	import { type AppContext, provideApp } from "./context.ts";
	import LoadFailed from "./LoadFailed.svelte";
	import { retryingRead } from "./retrying-read.ts";
	import { reportsItsOwnRender } from "./shell-model.ts";
	import Shell from "./Shell.svelte";
	import Toaster from "./toasts/Toaster.svelte";

	/** Follows `location.hash` (the whole UI state, protocol §3), rewrites a hash naming an unknown school or tab to
	 * the route it shows, puts the theme class on <html>, and records the rendered hash in `root.dataset.route`: at
	 * once for a pane that shows no data of its own, and for one that does (the Dashboard) once it says its data or
	 * its message is on screen. A failed schools read shows the message in place, with Retry, as well as in a toast. */
	let { root, context }: { root: HTMLElement; context: AppContext } = $props();
	// svelte-ignore state_referenced_locally
	provideApp(context); // the mount's context never changes, so its first value is the one to provide

	let hash = $state(window.location.hash);
	let schools = $state<School[] | null>(null);
	let failure = $state<UiError | null>(null);
	/** A schools read is on its way: a failed one stays on screen, its Retry busy, until the retry resolves. */
	let loading = $state(false);
	/** The bottom edge of the shell's bars (the tabs row, or the top bar on All schools): the toasts sit below it. */
	let chrome = $state<HTMLElement | null>(null);
	/** The last hash a pane that loads its own data said it has rendered. */
	let paneRendered = $state<string | null>(null);

	const schoolsRead = retryingRead(
		// svelte-ignore state_referenced_locally
		context,
		() => read((reader) => reader.schools()),
		{
			value: (loaded) => {
				schools = loaded;
				failure = null;
			},
			failure: (error) => {
				failure = error;
			},
			busy: (busy) => {
				loading = busy;
			},
		},
	);

	onMount(() => {
		const onHashChange = (): void => {
			hash = window.location.hash;
		};
		window.addEventListener("hashchange", onHashChange);
		schoolsRead.run();
		return () => {
			window.removeEventListener("hashchange", onHashChange);
			schoolsRead.cancel();
		};
	});

	const route = $derived(
		parseRoute(hash, schools?.map((school) => school.id) ?? []),
	);
	const canonical = $derived(schools ? formatRoute(route) : null);
	const theme = $derived(themeOf(route.query));

	$effect(() => {
		const { classList } = document.documentElement;
		for (const name of ["light", "dark", "system"] as const)
			classList.toggle(name, name === theme);
	});
	$effect(() => {
		if (canonical === null || canonical === hash) return;
		window.history.replaceState(null, "", canonical);
		hash = canonical;
	});
	const paneWaits = $derived(reportsItsOwnRender(route.tab));
	$effect(() => {
		if (
			canonical !== null &&
			canonical === hash &&
			(!paneWaits || paneRendered === hash)
		)
			root.dataset.route = hash;
	});

	/** Writes the route's hash and takes it at once, rather than on the `hashchange` the write queues. */
	const navigate = (next: Route): void => {
		window.location.hash = formatRoute(next);
		hash = window.location.hash;
	};
</script>

{#if failure}
	<LoadFailed error={failure} onRetry={schoolsRead.run} busy={loading} />
{:else if schools}
	<Shell
		{route}
		{schools}
		{navigate}
		onPaneRendered={(rendered) => {
			paneRendered = rendered;
		}}
		bind:chrome
	/>
{/if}
<Toaster store={context.toasts} anchor={chrome} frame={root} />
