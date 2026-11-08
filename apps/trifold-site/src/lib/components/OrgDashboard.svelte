<script lang="ts">
	/**
	 * A demo org's KPI dashboard (static/demo/orgs/<org>.html), framed in the page. The frame is made after mount, so
	 * the prerendered page and a visitor without JavaScript get a plain link instead. It takes the site's theme, and
	 * reloads in the other one when the visitor flips it (the page reads its theme from the URL only).
	 *
	 * The page posts { type: "tfd-demo:height", height } after each render. That height never drops below the frame's
	 * own (it is the document's scrollHeight), so on each message, and when the frame's width changes, the frame is
	 * sized to the page's body instead, read directly: same origin. The message height is the fallback.
	 *
	 * The frame is skipped in the .md mirrors; the links under it are what an agent reads.
	 */
	import { onMount } from "svelte";
	import { DASHBOARDS_GALLERY, type DemoOrg, dashboardPath } from "#lib/verticals";

	let { org, name }: { org: DemoOrg; name: string } = $props();

	/** Until the page's first message: about a desktop dashboard's height, so the page jumps little. */
	const INITIAL_HEIGHT = 1100;
	const page = $derived(dashboardPath(org));

	let frame: HTMLIFrameElement | undefined = $state();
	let mounted = $state(false);
	let theme: "light" | "dark" = $state("light");
	let height = $state(INITIAL_HEIGHT);
	/** Set by the page's first message: until then the frame may still hold its blank document. */
	let sized = false;
	const src = $derived(`${page}?embed=1&theme=${theme}`);

	/** The page's content height, or null when its document isn't readable. */
	function measure(): number | null {
		try {
			const body = frame?.contentDocument?.body;
			const content = body ? Math.ceil(body.getBoundingClientRect().height) : 0;
			return content > 0 ? content : null;
		} catch {
			return null;
		}
	}

	onMount(() => {
		const root = document.documentElement;
		const readTheme = () => {
			theme = root.classList.contains("dark") ? "dark" : "light";
		};
		readTheme();
		mounted = true;
		// ThemeToggle and the system setting both flip the .dark class on <html>.
		const themeObserver = new MutationObserver(readTheme);
		themeObserver.observe(root, { attributes: true, attributeFilter: ["class"] });

		const onMessage = (event: MessageEvent) => {
			if (event.origin !== location.origin || !frame || event.source !== frame.contentWindow) return;
			const data: unknown = event.data;
			if (typeof data !== "object" || data === null) return;
			const { type, height: posted } = data as { type?: unknown; height?: unknown };
			if (type !== "tfd-demo:height" || typeof posted !== "number" || !(posted > 0)) return;
			sized = true;
			height = measure() ?? Math.ceil(posted);
		};
		addEventListener("message", onMessage);

		return () => {
			themeObserver.disconnect();
			removeEventListener("message", onMessage);
		};
	});

	// A narrower or wider frame reflows the page, which posts nothing then: re-measure it.
	$effect(() => {
		if (!frame) return;
		let width = 0;
		const observer = new ResizeObserver(([entry]) => {
			const next = Math.round(entry?.contentRect.width ?? 0);
			if (next === width) return;
			width = next;
			if (sized) height = measure() ?? height;
		});
		observer.observe(frame);
		return () => observer.disconnect();
	});
</script>

<figure class="grid gap-3">
	<div class="overflow-hidden rounded-lg border border-border bg-card" data-agent="skip">
		{#if mounted}
			<iframe
				bind:this={frame}
				{src}
				title="{name} KPIs, demo"
				loading="lazy"
				style="width:100%;border:0;display:block;height:{height}px"
			></iframe>
		{:else}
			<p class="px-5 py-4 text-[15px]">
				<a class="font-semibold text-foreground underline" href={page}>{name} KPI dashboard, demo</a>
			</p>
		{/if}
	</div>
	<figcaption class="flex flex-wrap items-baseline gap-x-5 gap-y-1.5 text-sm text-muted-foreground">
		<span>Demo, synthetic data.</span>
		<a class="font-semibold text-foreground underline" href={page} rel="noopener" target="_blank"
			>Open the dashboard full screen ↗<span class="sr-only"> (opens in a new tab)</span></a
		>
		<a class="text-foreground underline" href={DASHBOARDS_GALLERY} rel="noopener" target="_blank"
			>All five demo dashboards ↗<span class="sr-only"> (opens in a new tab)</span></a
		>
	</figcaption>
</figure>
