<script lang="ts">
/**
 * A check's result, result first: the signet and a fact headline, the four checks, what to do next and what a check
 * can't tell you (L1); the receipt's details as signed (L2); the raw receipt and a check-it-yourself command (L3).
 * The words for every outcome live in report.ts. "compact" is the homepage's inline verifier: L1 only.
 */
import { encodeReceiptParam } from "tfd-verify/link";
import { Button } from "#lib/components/ui/button";
import { formatAmount } from "#lib/samples/sample";
import {
	DOESNT_TELL_YOU,
	formatDate,
	formatInstant,
	KEY_CAVEAT,
	PENDING_ROWS,
} from "#lib/verify/report";
import { orgName, type VerifierSession } from "#lib/verify/session.svelte";
import { FINGERPRINT_COMMAND, groupFingerprint } from "#lib/verify/signet";
import CheckList from "./CheckList.svelte";
import Signet, { type SignetState } from "./Signet.svelte";

const {
	session,
	variant = "full",
	class: className = "",
	onreset,
	onkeys,
}: {
	session: VerifierSession;
	variant?: "full" | "compact";
	class?: string;
	/** "Check another receipt". */
	onreset?: () => void;
	/** "Check against a different key list". */
	onkeys?: () => void;
} = $props();

const full = $derived(variant === "full");
const report = $derived(session.report);
const tone = $derived(report?.tone ?? "checking");

/** The receipt's fields when the input has the shape of one; trusted only when the check passed. */
const claimed = $derived.by(() => {
	const value = session.parsed as {
		receipt?: Record<string, unknown>;
		key_id?: unknown;
		sig?: unknown;
	} | null;
	const receipt =
		value && typeof value === "object" ? value.receipt : undefined;
	if (!receipt || typeof receipt !== "object") return null;
	const text = (field: string) =>
		typeof receipt[field] === "string" ? (receipt[field] as string) : "";
	return {
		school: text("school"),
		date: text("date"),
		issuedAt: text("issued_at"),
		amount: typeof receipt.amount === "number" ? receipt.amount : null,
		currency: text("currency"),
		eventId: text("event_id"),
		eventType: text("event_type"),
		stripeId: text("stripe_id"),
		keyId: typeof value?.key_id === "string" ? value.key_id : "",
		sig: typeof value?.sig === "string" ? value.sig : "",
		version: receipt.v,
	};
});

const signetState: SignetState = $derived(
	session.checking
		? "checking"
		: tone === "pass"
			? "lit"
			: tone === "mismatch"
				? "broken"
				: "unchecked",
);
const shortOrg = $derived(
	claimed?.school ? orgName(claimed.school).split(" ")[0] : "",
);
const signetTitle = $derived(
	report
		? `Receipt signet: ${report.eyebrow.toLowerCase()}${session.fingerprint ? `, fingerprint ${groupFingerprint(session.fingerprint)}` : ""}`
		: "Receipt signet: checking",
);

const frame = $derived(
	tone === "pass"
		? "border-[color-mix(in_srgb,var(--proof)_42%,transparent)] shadow-[var(--card-shadow),var(--glow-proof)]"
		: tone === "mismatch"
			? "border-[color-mix(in_srgb,var(--alert)_45%,transparent)] bg-[color-mix(in_srgb,var(--alert)_4%,var(--card))]"
			: "border-line-strong",
);
const eyebrowTone = $derived(
	tone === "pass"
		? "text-proof-text"
		: tone === "mismatch"
			? "text-alert-text"
			: "text-muted-foreground",
);

let copied = $state(false);
const shareLink = $derived.by(() => {
	if (!session.text.trim()) return "";
	let compact = session.text.trim();
	try {
		compact = JSON.stringify(JSON.parse(session.text));
	} catch {}
	return `/verify#r=${encodeReceiptParam(compact)}`;
});
async function copyLink() {
	await navigator.clipboard.writeText(new URL(shareLink, location.href).href);
	copied = true;
	setTimeout(() => {
		copied = false;
	}, 2400);
}

const code =
	"rounded bg-foreground/[0.06] px-[5px] py-px font-mono text-[0.86em] [overflow-wrap:anywhere]";
const term =
	"font-mono text-[11px] tracking-[0.12em] text-muted-foreground uppercase";
const pretty = $derived.by(() => {
	try {
		return JSON.stringify(JSON.parse(session.text), null, 2);
	} catch {
		return session.text;
	}
});
</script>

<div class={className}>
	<!-- The announcement: one sentence when the check lands. -->
	<p class="sr-only" role="status" aria-live="polite">
		{#if session.checking}Checking the receipt.{:else if report}{report.eyebrow}. {report.headline}{/if}
	</p>

	{#if session.started}
		<article
			class="relative overflow-hidden rounded-xl border bg-card shadow-card transition-[border-color,box-shadow] duration-500 {frame} {full
				? 'p-[clamp(18px,3.4vw,40px)]'
				: 'p-4 sm:p-5'}"
			aria-busy={session.checking}
			aria-labelledby="result-headline"
		>
			<div
				class="grid items-start {full
					? 'gap-x-[clamp(24px,4vw,56px)] gap-y-5 md:grid-cols-[auto_minmax(0,1fr)]'
					: 'gap-4 sm:grid-cols-[auto_minmax(0,1fr)]'}"
			>
				<!-- The signet and its fingerprint. -->
				<div class="flex items-center gap-4 {full ? 'md:flex-col md:items-start md:gap-3' : ''}">
					{#if full}
						<Signet
							class="hidden md:block"
							size={232}
							state={signetState}
							fingerprint={session.fingerprint}
							org={shortOrg}
							keyId={claimed?.keyId ?? ""}
							date={claimed?.date ?? ""}
							title={signetTitle}
						/>
						<Signet
							class="md:hidden"
							size={104}
							state={signetState}
							fingerprint={session.fingerprint}
							org={shortOrg}
							keyId={claimed?.keyId ?? ""}
							date={claimed?.date ?? ""}
						/>
					{:else}
						<Signet size={64} state={signetState} fingerprint={session.fingerprint} />
					{/if}
					{#if session.fingerprint}
						<p class="grid gap-0.5 {full ? 'md:w-[232px] md:text-center' : 'sm:hidden'}">
							<span class={term}>Fingerprint</span>
							<span class="num text-[17px] tracking-[0.08em]">{groupFingerprint(session.fingerprint)}</span>
							{#if full}
								<span class="text-[12.5px] text-muted-foreground"><span class="md:hidden">The ring is drawn from it.</span><span class="hidden md:inline">The ring is drawn from it. A copy with any change gets another.</span></span>
							{/if}
						</p>
					{/if}
				</div>

				<div class="min-w-0">
					<p class="label-mono flex items-center gap-2 text-[11.5px] {eyebrowTone}">
						{#if session.checking}
							<span class="inline-block size-1.5 animate-pulse rounded-full bg-current" aria-hidden="true"></span>Checking in
							this browser
						{:else if report}
							<span aria-hidden="true">{tone === "pass" ? "✓" : tone === "mismatch" ? "✗" : "?"}</span>{report.eyebrow}
						{/if}
					</p>
					<h2
						id="result-headline"
						class="mt-2.5 font-display font-[380] tracking-[-0.015em] text-balance [font-variation-settings:'opsz'_144,'SOFT'_60] {full
							? 'text-[clamp(26px,3.3vw,42px)] leading-[1.1]'
							: 'text-[22px] leading-[1.15]'}"
						tabindex="-1"
					>
						{#if report}{report.headline}{:else}Checking the receipt…{/if}
					</h2>
					{#if report}
						<p class="mt-2.5 max-w-[60ch] text-muted-foreground {full ? 'text-[16.5px]' : 'text-[15px]'}">{report.body}</p>
					{/if}

					{#if report?.guidance}
						<div
							class="mt-4 rounded-md border bg-background/40 px-4 py-3 text-[15px] {tone === 'mismatch'
								? 'border-[color-mix(in_srgb,var(--alert)_35%,transparent)]'
								: 'border-border'}"
						>
							<p><span class="font-semibold">What to do:</span> {report.guidance}</p>
							{#if report.offerKeys && onkeys}
								<button type="button" class="mt-2 min-h-11 font-semibold underline underline-offset-4" onclick={onkeys}
									>Check against the school's key list</button
								>
							{/if}
						</div>
					{/if}

					<div class={full ? "mt-5" : "mt-3"}>
						<CheckList rows={report?.rows ?? PENDING_ROWS} checking={session.checking} compact={!full} />
					</div>

					{#if report}
						<p class="mt-4 border-l-2 border-line-strong pl-3 text-[14px] text-muted-foreground">
							<span class="font-semibold text-foreground">What this doesn't tell you.</span>
							{DOESNT_TELL_YOU}
							{#if full && session.keysText.trim()}{KEY_CAVEAT}{/if}
						</p>
					{/if}

					{#if full && report}
						<div class="mt-5 flex flex-wrap gap-2.5">
							<Button variant="outline" onclick={onreset}>Check another receipt</Button>
							{#if shareLink && tone === "pass"}
								<Button variant="ghost" onclick={copyLink}>{copied ? "Link copied" : "Copy a link to this check"}</Button>
							{/if}
						</div>
					{/if}
				</div>
			</div>
		</article>

		{#if full && report && claimed}
			<!-- L2: the receipt as signed. -->
			<section class="mt-6 rounded-xl border border-border bg-card p-[clamp(18px,3vw,32px)]" aria-labelledby="details-title">
				<div class="flex flex-wrap items-baseline justify-between gap-2">
					<h3 id="details-title" class="text-[19px] font-[450]">
						{tone === "pass" ? "The receipt, as signed" : "What the receipt claims"}
					</h3>
					{#if tone !== "pass"}
						<p class="text-[13.5px] text-muted-foreground">Not vouched for: the check didn't pass.</p>
					{/if}
				</div>
				<dl class="mt-4 grid gap-x-8 gap-y-3.5 sm:grid-cols-2 lg:grid-cols-3">
					{#if claimed.school}
						<div class="min-w-0"><dt class={term}>School</dt><dd class="mt-1">{orgName(claimed.school)} <span class="font-mono text-[12.5px] text-muted-foreground">{claimed.school}</span></dd></div>
					{/if}
					{#if claimed.amount !== null && claimed.currency}
						<div class="min-w-0">
							<dt class={term}>Amount as signed</dt>
							<dd class="num mt-1 text-[17px]">
								{claimed.eventType === "payment.refunded" ? "Refund " : ""}{formatAmount(claimed.amount, claimed.currency)}
								{claimed.currency.toUpperCase()}
							</dd>
						</div>
					{/if}
					{#if claimed.date}
						<div class="min-w-0"><dt class={term}>Payment date</dt><dd class="mt-1">{formatDate(claimed.date)}</dd></div>
					{/if}
					<div class="min-w-0">
						<dt class={term}>Signed at</dt>
						<dd class="mt-1">
							{#if claimed.issuedAt}{formatInstant(claimed.issuedAt)}{:else}<span class="text-muted-foreground">Not recorded (version 1 receipt)</span>{/if}
						</dd>
					</div>
					{#if claimed.keyId}
						<div class="min-w-0"><dt class={term}>Key</dt><dd class="mt-1"><code class={code}>{claimed.keyId}</code></dd></div>
					{/if}
					{#if session.fingerprint}
						<div class="min-w-0"><dt class={term}>Fingerprint</dt><dd class="mt-1"><code class={code}>{session.fingerprint}</code></dd></div>
					{/if}
					{#if claimed.eventId}
						<div class="min-w-0"><dt class={term}>Event</dt><dd class="mt-1"><code class={code}>{claimed.eventId}</code></dd></div>
					{/if}
					{#if claimed.stripeId}
						<div class="min-w-0"><dt class={term}>Stripe record</dt><dd class="mt-1"><code class={code}>{claimed.stripeId}</code></dd></div>
					{/if}
				</dl>

				<!-- L3: the raw receipt and the same check on your own machine. -->
				<details class="group mt-6 border-t border-border pt-4">
					<summary class="flex min-h-11 cursor-pointer items-center gap-2 font-semibold">
						<span class="transition-transform group-open:rotate-90" aria-hidden="true">›</span> The raw receipt, and how to
						check it yourself
					</summary>
					<div class="mt-3 grid min-w-0 gap-4 lg:grid-cols-2">
						<div class="min-w-0">
							<p class={term}>receipt.json</p>
							<pre
								class="mt-2 max-h-[340px] overflow-auto rounded-md border border-border bg-sunk p-3.5 font-mono text-[12.5px] leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]">{pretty}</pre>
						</div>
						<div class="min-w-0">
							<p class={term}>With the tfd command-line tool</p>
							<pre
								class="mt-2 overflow-x-auto rounded-md border border-border bg-sunk p-3.5 font-mono text-[12.5px] leading-relaxed"><span
									class="text-muted-foreground"># the signature, the key, and the books with --root</span
								>
tfd verify receipt receipt.json --keys keys.json

<span class="text-muted-foreground"># the fingerprint{session.fingerprint ? `: ${session.fingerprint}` : ""}</span>
{FINGERPRINT_COMMAND}</pre>
							<p class="mt-2.5 text-[13.5px] text-muted-foreground">
								The signature is Ed25519 over the receipt's exact bytes (JSON with sorted keys). The fingerprint is the first
								8 hex of their SHA-256. Get the key list from the school.
							</p>
							{#if claimed.sig}
								<p class="mt-3 {term}">Signature</p>
								<p class="mt-1 font-mono text-[12px] break-all text-muted-foreground">{claimed.sig}</p>
							{/if}
						</div>
					</div>
				</details>
			</section>
		{/if}
	{/if}
</div>
