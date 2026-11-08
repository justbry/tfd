<script lang="ts">
	/**
	 * The "Simulated" block on an audience page: its demo org's card from src/lib/verticals.ts, with every preset, then
	 * the org's demo dashboard framed below it (`embed`), or a link to it.
	 */
	import { verticalBySlug } from "#lib/verticals";
	import OrgDashboard from "./OrgDashboard.svelte";
	import VerticalDetail from "./VerticalDetail.svelte";

	/**
	 * `lede` replaces the default paragraph, for a page citing another org's simulation (non-profits cite the church);
	 * such a page passes `embed={false}` and links the dashboard instead of framing it.
	 */
	let { slug, title, lede, embed = true }: { slug: string; title: string; lede?: string; embed?: boolean } = $props();
	const vertical = $derived(verticalBySlug(slug));
</script>

<div class="grid items-start gap-[clamp(32px,5vw,72px)] md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] [&>*]:min-w-0">
	<div>
		<p class="label-mono">Simulated · invented names · synthetic data</p>
		<h2 class="display-3 mt-3.5 mb-4">{title}</h2>
		<p class="text-muted-foreground [&_a]:underline">
			{lede ??
				`${vertical.org} is invented. A seeded scenario runs its year through the engine, hledger and DuckDB, and all three give the same KPI hash. Its demo dashboard, below, shows the KPIs from the same runs. Run it yourself with the command on the card.`}
			See <a href="/proof#simulations">every preset</a> and <a href="/proof#simplify">where the simulations simplify</a>.
		</p>
		{#if !embed}
			<p class="mt-6 text-[15px]">
				<a class="font-semibold text-foreground underline" href={vertical.dashboard} rel="noopener" target="_blank"
					>Open {vertical.org}'s demo dashboard ↗<span class="sr-only"> (opens in a new tab)</span></a
				>
			</p>
			<p class="mt-1.5 text-sm text-muted-foreground">Synthetic data. No login.</p>
		{/if}
	</div>
	<VerticalDetail {vertical} />
</div>
{#if embed}
	<div class="mt-[clamp(40px,5vw,64px)]">
		<p class="label-mono mb-4">{vertical.org} · demo dashboard</p>
		<OrgDashboard org={vertical.demoOrg} name={vertical.org} />
	</div>
{/if}
