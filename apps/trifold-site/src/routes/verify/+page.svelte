<script lang="ts">
import ProofLimits from "#lib/components/ProofLimits.svelte";
import Seo from "#lib/components/Seo.svelte";
import Signet from "#lib/components/Signet.svelte";
import VerifierFull from "#lib/components/VerifierFull.svelte";
import WitnessSeal from "#lib/components/WitnessSeal.svelte";

const STEPS = [
	[
		"The signature",
		"sig · Ed25519",
		"A signature over the receipt's exact bytes (JSON with sorted keys). Change one character, even a space inside a value, and it fails.",
	],
	[
		"The key",
		"key_id",
		"The key the receipt names is on the school's published list, meant for receipts, not revoked, and in use when the receipt was signed.",
	],
	[
		"In the school's books",
		"event_hash",
		"When this page holds the school's books (here, the sample school's), it makes the receipt again from the payment in the books and compares.",
	],
	[
		"The month's seal",
		"seal",
		"A closed month is sealed: one signature over every entry in it. The seal must match the books and list this receipt. An unsealed month isn't a problem.",
	],
] as const;
const section = "border-t border-border py-[clamp(48px,6vw,88px)]";
</script>

<Seo
	title="Verify a receipt"
	description="Check a Trifold receipt in your browser: the signature, the key, the books and the seal. No account, nothing uploaded."
/>

<section class="pt-[clamp(28px,5vw,72px)] pb-[clamp(48px,6vw,80px)]">
	<div class="container-page"><VerifierFull /></div>
</section>

<section class={section} aria-labelledby="how-title">
	<div class="container-page grid gap-10 md:grid-cols-[minmax(0,0.7fr)_minmax(0,1.3fr)]">
		<div>
			<h2 id="how-title" class="display-3">How the check works</h2>
			<p class="mt-3 text-muted-foreground">
				Everything runs in this page with open code: no account, nothing uploaded. The same checks run anywhere with
				<code class="font-mono text-[0.9em]">tfd verify receipt</code>.
			</p>
		</div>
		<ol class="grid gap-5">
			{#each STEPS as [label, technical, text], index (label)}
				<li class="grid grid-cols-[32px_minmax(0,1fr)] gap-3.5">
					<span class="num pt-0.5 text-[13px] text-muted-foreground">0{index + 1}</span>
					<div>
						<p class="font-semibold">{label} <span class="ml-1 font-mono text-[11px] tracking-[0.06em] text-muted-foreground">{technical}</span></p>
						<p class="mt-1 text-muted-foreground">{text}</p>
					</div>
				</li>
			{/each}
		</ol>
	</div>
</section>

<section class={section} aria-labelledby="signet-title">
	<div class="container-page grid items-center gap-[clamp(28px,5vw,72px)] md:grid-cols-[auto_minmax(0,1fr)]">
		<div class="flex items-end gap-5">
			<Signet size={200} state="ink" fingerprint="48bf5377" org="Juniper" keyId="juniper-demo-2026-10" date="2026-10-03" title="The Trifold signet on the sample receipt" />
			<Signet size={48} state="ink" fingerprint="48bf5377" title="" />
		</div>
		<div>
			<p class="label-mono">The signet</p>
			<h2 id="signet-title" class="display-3 mt-3">Every receipt carries its own mark.</h2>
			<p class="mt-3 max-w-[60ch] text-muted-foreground">
				A receipt folded in thirds, ringed by the school, the key, the date and a fingerprint of the signed bytes. The
				pattern around it is drawn from that fingerprint, so no two receipts share one, and a copy with any change gets a
				different ring. A printed signet is only a picture: the check above is what counts. It lights up green here when
				every check holds.
			</p>
			<div class="mt-6 max-w-[720px]"><ProofLimits /></div>
		</div>
	</div>
</section>

<section class={section} aria-labelledby="witness-title">
	<div class="container-page">
		<div
			class="grid items-center gap-[clamp(24px,4vw,56px)] rounded-xl border border-dashed border-line-strong p-[clamp(20px,4vw,48px)] md:grid-cols-[minmax(0,1fr)_auto]"
		>
			<div>
				<p class="label-mono text-ember-text">Next · not available yet</p>
				<h2 id="witness-title" class="display-3 mt-3">Coming: witnessed receipts.</h2>
				<p class="mt-3 max-w-[60ch] text-muted-foreground">
					Today a receipt is signed by the school's key. Next on the roadmap, Trifold will act as an independent witness
					that countersigns receipts and seals, so a receipt can show that a second party saw it. No receipt carries this mark yet, and this page
					never shows it as a result.
				</p>
				<p class="mt-4"><a class="link-arrow text-foreground" href="/roadmap">See the roadmap</a></p>
			</div>
			<figure class="m-0 grid justify-items-center gap-2 opacity-80">
				<WitnessSeal size={168} title="The future witness seal, not in use yet" />
				<figcaption class="font-mono text-[11px] tracking-[0.12em] text-muted-foreground uppercase">Preview · not in use</figcaption>
			</figure>
		</div>
		<p class="mt-10 text-muted-foreground">
			Run a school on books like these? <a class="link-arrow text-foreground" href="/early-access">Get early access</a>
		</p>
	</div>
</section>
