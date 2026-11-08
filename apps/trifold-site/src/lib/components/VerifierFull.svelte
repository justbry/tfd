<script lang="ts">
/**
 * /verify: a link (`?r=` or `#r=`) checks itself on arrival and the result is the page. Without one, a calm drop zone:
 * drop or choose a file, paste anywhere, or try the sample. Nothing is uploaded.
 */
import { onMount, tick } from "svelte";
import { decodeReceiptParam } from "tfd-verify/link";
import { Button } from "#lib/components/ui/button";
import { Label } from "#lib/components/ui/label";
import { Textarea } from "#lib/components/ui/textarea";
import { PENDING_ROWS } from "#lib/verify/report";
import {
	preloadVerifier,
	SAMPLE_TEXT,
	TAMPERED_TEXT,
	VerifierSession,
} from "#lib/verify/session.svelte";
import CheckList from "./CheckList.svelte";
import Signet from "./Signet.svelte";

const MAX_FILE_BYTES = 256 * 1024;
const session = new VerifierSession();
/** The result UI loads beside the crypto: a link arrival fetches both at once, an empty page after first paint. */
const loadResult = () => import("./VerifierResult.svelte");

let dragging = $state(false);
let fileError = $state("");
let pasteOpen = $state(false);
let keysOpen = $state(false);

async function run(text: string, which: "sample" | "tampered" | "own" = "own") {
	session.text = text;
	session.which = which;
	document.getElementById("verify-top")?.scrollIntoView({ block: "start" });
	await session.verify();
	await tick();
	document.getElementById("result-headline")?.focus({ preventScroll: true });
}

async function readFile(file: File) {
	fileError = "";
	if (file.size > MAX_FILE_BYTES) {
		fileError = "That file is too large to be a receipt.";
		return;
	}
	await run(await file.text());
}

function onDrop(event: DragEvent) {
	event.preventDefault();
	dragging = false;
	const file = event.dataTransfer?.files?.[0];
	if (file) {
		void readFile(file);
		return;
	}
	const dropped = event.dataTransfer?.getData("text/plain");
	if (dropped) void run(dropped);
}

function onFileInput(event: Event) {
	const input = event.currentTarget as HTMLInputElement;
	const file = input.files?.[0];
	if (file) void readFile(file);
	input.value = "";
}

/** Paste anywhere on the empty page checks what was pasted (not inside a text field: that's typing). */
function onWindowPaste(event: ClipboardEvent) {
	if (session.started) return;
	const target = event.target as HTMLElement | null;
	if (target?.closest("textarea, input, [contenteditable]")) return;
	const text = event.clipboardData?.getData("text/plain")?.trim();
	if (!text) return;
	event.preventDefault();
	void run(text);
}

async function openPaste() {
	pasteOpen = true;
	await tick();
	document.getElementById("receipt-text")?.focus();
}

async function reset(openKeys = false) {
	session.reset();
	fileError = "";
	if (location.search || location.hash)
		history.replaceState(history.state, "", location.pathname);
	keysOpen = openKeys;
	await tick();
	document.getElementById("verify-top")?.scrollIntoView({ block: "start" });
	if (openKeys) document.getElementById("keys-text")?.focus();
	else document.getElementById("drop-title")?.focus();
}

onMount(() => {
	void preloadVerifier();
	void loadResult();
	const hash = new URLSearchParams(location.hash.slice(1)).get("r");
	const param = new URLSearchParams(location.search).get("r") ?? hash;
	if (!param) return;
	const decoded = decodeReceiptParam(param) ?? param;
	let sample = false;
	try {
		sample =
			decoded === JSON.stringify(JSON.parse(SAMPLE_TEXT)) ||
			JSON.stringify(JSON.parse(decoded)) ===
				JSON.stringify(JSON.parse(SAMPLE_TEXT));
	} catch {}
	session.text = decoded;
	session.which = sample ? "sample" : "own";
	void session.verify(decoded);
});

const sectionLabel =
	"font-mono text-[11px] tracking-[0.12em] text-muted-foreground uppercase";
</script>

<svelte:window onpaste={onWindowPaste} />

<div id="verify-top" class="scroll-mt-24">
	{#if session.started}
		<p class="label-mono mb-4 text-[11.5px]">Receipt check · in this browser · nothing uploaded</p>
		<h1 class="sr-only">Receipt check</h1>
		{#await loadResult() then { default: VerifierResult }}
			<VerifierResult {session} onreset={() => reset()} onkeys={() => reset(true)} />
		{/await}
	{:else}
		<div class="grid items-start gap-[clamp(28px,5vw,72px)] lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
			<div class="min-w-0">
				<p class="label-mono">Verify · no account · nothing uploaded</p>
				<h1 class="display-2 mt-4">Check a receipt.</h1>
				<p class="lede mt-4">
					Your browser checks the school's signature on the receipt, and its books and seal when it has them. The receipt
					never leaves this page.
				</p>

				<!-- The drop zone: the whole card takes a dropped file or text. -->
				<div
					class="mt-8 rounded-xl border-2 border-dashed p-[clamp(18px,3vw,32px)] transition-colors duration-300 {dragging
						? 'border-proof bg-[color-mix(in_srgb,var(--proof)_7%,var(--card))]'
						: 'border-line-strong bg-card'}"
					role="group"
					aria-labelledby="drop-title"
					ondragover={(event) => {
						event.preventDefault();
						dragging = true;
					}}
					ondragleave={() => (dragging = false)}
					ondrop={onDrop}
				>
					<div class="flex items-center gap-[clamp(16px,3vw,28px)]">
						<Signet size={112} state="unlit" class="hidden sm:block" />
						<div class="min-w-0">
							<h2 id="drop-title" tabindex="-1" class="font-display text-[clamp(22px,2.4vw,28px)] leading-tight font-[400] focus:outline-none">
								{#if dragging}Let go to check it.{:else}<span class="hidden sm:inline">Drop the receipt file here.</span><span class="sm:hidden">Open the receipt file.</span>{/if}
							</h2>
							<p class="mt-1.5 text-[15px] text-muted-foreground">
								<span class="hidden sm:inline">Or choose the file, or paste</span><span class="sm:hidden">Choose the file, or paste</span> the receipt anywhere on this page (<kbd class="font-mono text-[13px]">⌘V</kbd> /
								<kbd class="font-mono text-[13px]">Ctrl V</kbd>).
							</p>
						</div>
					</div>

					<div class="mt-5 flex flex-wrap gap-2.5">
						<label
							class="relative inline-flex h-12 cursor-pointer items-center overflow-hidden rounded-full bg-primary px-[22px] text-[15px] font-semibold text-primary-foreground transition-all duration-300 focus-within:outline-2 focus-within:outline-offset-3 focus-within:outline-ring focus-within:outline-solid hover:-translate-y-px hover:shadow-glow-seal"
						>
							Choose a file
							<input type="file" accept="application/json,.json,.txt" class="absolute inset-0 cursor-pointer opacity-0" onchange={onFileInput} />
						</label>
						<Button variant="outline" onclick={openPaste} aria-expanded={pasteOpen} aria-controls="paste-panel">Paste the text</Button>
					</div>
					{#if fileError}<p class="mt-3 text-sm text-alert-text" role="alert">{fileError}</p>{/if}

					{#if pasteOpen}
						<div id="paste-panel" class="mt-5 min-w-0">
							<Label for="receipt-text"><span class={sectionLabel}>Receipt JSON</span></Label>
							<Textarea
								id="receipt-text"
								class="mt-2 min-h-[180px] w-full max-w-full font-mono text-[13px]"
								bind:value={session.text}
								spellcheck="false"
								autocomplete="off"
								placeholder={'{ "receipt": { … }, "key_id": "…", "sig": "…" }'}
								oninput={() => (session.which = "own")}
							/>
							<div class="mt-3 flex justify-end">
								<Button onclick={() => run(session.text)} disabled={session.checking || !session.text.trim()}>Check this receipt</Button>
							</div>
						</div>
					{/if}

					<div class="mt-6 flex flex-wrap items-center gap-x-3 gap-y-2.5 border-t border-dashed border-line-strong pt-5">
						<span class="text-[14.5px] text-muted-foreground">No receipt handy?</span>
						<Button variant="subtle" size="sm" class="h-11" onclick={() => run(SAMPLE_TEXT, "sample")}>Try the sample</Button>
						<Button variant="subtle" size="sm" class="h-11" onclick={() => run(TAMPERED_TEXT, "tampered")}>Try a tampered copy</Button>
					</div>
				</div>

				<details class="mt-4 rounded-lg border border-border px-4 py-1" bind:open={keysOpen}>
					<summary class="flex min-h-11 cursor-pointer items-center text-[15px] font-semibold">Check against a school's key list</summary>
					<p class="mt-1 text-sm text-muted-foreground">
						This page checks against the sample school's published demo key. To check another school's receipts, paste the key
						list it publishes.
					</p>
					<Label for="keys-text" class="sr-only">Public keys JSON</Label>
					<Textarea
						id="keys-text"
						class="mt-2.5 mb-3 min-h-[110px] w-full max-w-full font-mono text-[12.5px]"
						bind:value={session.keysText}
						spellcheck="false"
						placeholder={'{ "key_id": "-----BEGIN PUBLIC KEY-----\\n…\\n-----END PUBLIC KEY-----\\n" }'}
					/>
					{#if session.keysError}<p class="mb-3 text-sm text-alert-text" role="alert">{session.keysError}</p>{/if}
				</details>
			</div>

			<aside class="min-w-0 rounded-xl border border-border bg-card p-[clamp(18px,2.6vw,28px)] lg:mt-[clamp(0px,7vw,104px)]" aria-labelledby="checks-title">
				<h2 id="checks-title" class="text-[19px] font-[450]">What gets checked</h2>
				<p class="mt-1 text-[14.5px] text-muted-foreground">Four checks, each shown as it runs. A month that isn't sealed yet is normal.</p>
				<div class="mt-3"><CheckList rows={PENDING_ROWS} pending compact /></div>
				<p class="mt-3 border-t border-border pt-3 text-[13.5px] text-muted-foreground">
					A check can't tell you that money moved or how a tax program will treat it. For that, ask the school.
				</p>
			</aside>
		</div>
	{/if}
</div>
