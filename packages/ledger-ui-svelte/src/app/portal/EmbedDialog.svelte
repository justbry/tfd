<script lang="ts">
	import {
		embedAllowedSitesDefault,
		embedBooksAudienceLabels,
		embedSnippets,
		type PortalAudience,
		type SiteTheme,
	} from "$contract/data/portal.ts";
	import type { School } from "$contract/data/types.ts";
	import { Badge } from "$lib/components/ui/badge/index.ts";
	import { Button } from "$lib/components/ui/button/index.ts";
	import Icon from "../Icon.svelte";
	import PaneIcon from "../PaneIcon.svelte";
	import { checkLabel, field, fieldBox, fieldLabel, paneBadge, preview as previewClass } from "../panes/styles.ts";
	import PortalDialog from "./PortalDialog.svelte";

	/** The embed modal (mockup `embedModal`): the three steps for the host page, the theme picked in the preview as the CSS
	 * the page sets, and the public school-books document, the only one that may be embedded. */
	let {
		school,
		theme,
		publicYear,
		onClose,
		onCopy,
	}: {
		school: School;
		theme: SiteTheme;
		publicYear: string;
		onClose: () => void;
		onCopy: (snippet: string) => void;
	} = $props();

	const snippets = $derived(embedSnippets(school.name, theme, publicYear));
	const ids = $props.id();
	const originsId = `${ids}-origins`;
	const audienceId = `${ids}-audience`;
	const audienceOrder = Object.keys(embedBooksAudienceLabels) as PortalAudience[];
	const publicAudience: PortalAudience = "public";
	const heading5 = "mt-3.5 mb-2 flex items-center gap-1 text-[11px] font-semibold tracking-[0.05em] text-muted-foreground uppercase";
	const pre = "my-1.5 rounded-md border border-border bg-code p-2 font-mono text-[10.5px] break-all whitespace-pre-wrap";
</script>

<PortalDialog detail={`${school.name} · the portal you are viewing, on your own site`} {onClose}>
	{#snippet heading()}
		<PaneIcon name="plug" class="mr-1 inline" /> Embed the member portal <Badge class={[paneBadge, "border-warning text-warning"]}>Proposed</Badge>
	{/snippet}
	<h5 class={heading5}>1. Add it to your page</h5>
	<div class={pre} data-test="embed-snippet" data-step="page">{snippets.page}</div>
	<h5 class={heading5}>2. Mint a session on your server</h5>
	<div class={pre} data-test="embed-snippet" data-step="server">{snippets.server}</div>
	<h5 class={heading5}>3. Match your site</h5>
	<div class="mb-1 text-muted-foreground">
		With <span class="font-mono text-[10.5px]">data-theme="inherit"</span> the portal reads these from your page. This is the theme you picked:
	</div>
	<div class={pre} data-test="embed-snippet" data-step="theme">{snippets.theme}</div>
	<div class={fieldBox}>
		<label for={originsId} class={fieldLabel}>Allowed sites (sets frame-ancestors)</label>
		<input id={originsId} type="text" class={field} data-test="embed-origins" value={embedAllowedSitesDefault} />
	</div>
	<div class={previewClass}>
		<Icon name="info" class="mr-1 inline size-[13px] align-[-2px]" />Sign-in is yours: your server proves who the member is with a secret key and gets a short-lived token. Changes run in the
		family service, the same as here. Card changes hand off to Stripe. Tier switches stay admin-only until atm and the Stripe portal support them.
	</div>
	<h5 class={heading5}><Icon name="scale" class="size-[13px]" /> School books on your site</h5>
	<div class={fieldBox}>
		<label for={audienceId} class={fieldLabel}>Document</label>
		<select id={audienceId} class={field} data-test="embed-books-audience">
			{#each audienceOrder as audience (audience)}
				<option value={audience} selected={audience === publicAudience} disabled={audience !== publicAudience}>
					{embedBooksAudienceLabels[audience]}
				</option>
			{/each}
		</select>
	</div>
	<div class={pre} data-test="embed-snippet" data-step="books">{snippets.books}</div>
	<div class="mt-2 flex items-center gap-2 rounded-xl border border-warning px-2.5 py-[7px] text-warning">
		<Icon name="alert" />
		<span>
			Only the public document may be embedded. Member, governance and finance figures need a signed-in session (<span class="font-mono text-[10.5px]">Cache-Control: private, no-store</span>)
			and are never embeddable; the embedded portal leaves the School books card out.
		</span>
	</div>
	{#snippet footer()}
		<Button variant="tool" size="tool" data-test="embed-copy" onclick={() => onCopy(snippets.page)}>
			<PaneIcon name="copy" />Copy snippet
		</Button>
		<Button variant="primary" size="tool" data-test="embed-done" data-autofocus onclick={onClose}>Done</Button>
	{/snippet}
</PortalDialog>
