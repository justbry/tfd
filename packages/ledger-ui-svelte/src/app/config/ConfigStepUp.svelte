<script lang="ts">
	import { Button } from "$lib/components/ui/button/index.ts";
	import type { ConfigName } from "../../effect/config-client.ts";
	import Icon from "../Icon.svelte";
	import { control, error as errorText, muted } from "../plans/styles.ts";
	import type { ConfigEditor } from "./config-editor.svelte.ts";

	/** A 403 `step_up_required` (S9-plan D22): saving needs the family PIN from the last 10 minutes. "Confirm it is you"
	 * opens the books with the PIN, takes a new ledger token and sends the save again. A wrong PIN or a locked one is
	 * said at the field, in the message table's words. With `flush`, the save checks the value first. The hooks are
	 * `<prefix>-step-up`, `-pin` and `-confirm`. */
	let {
		editor,
		prefix,
		flush = false,
	}: { editor: ConfigEditor<ConfigName>; prefix: string; flush?: boolean } = $props();

	let pin = $state("");
	let pinProblem = $state<string | null>(null);
	let confirming = $state(false);
	let pinField = $state<HTMLInputElement | null>(null);
	const confirm = async (): Promise<void> => {
		confirming = true;
		pinProblem = (await editor.confirmAndSave(pin, { flush })).problem;
		confirming = false;
		if (pinProblem === null) pin = "";
	};
	$effect(() => {
		if (editor.stepUp) pinField?.focus();
	});
</script>

{#if editor.stepUp}
	<div class="mt-3 rounded-[10px] border border-warning p-2.5" role="alert" data-test="{prefix}-step-up">
		<b class="text-warning"><Icon name="lock" class="mr-1 inline align-[-2px]" />Confirm it is you</b>
		<div class={muted}>Saving needs your family PIN from the last 10 minutes.</div>
		<div class="mt-1.5 flex items-center gap-1.5">
			<input
				class={[control, "w-32 rounded-md border border-border bg-card px-2 py-1"]}
				type="password"
				inputmode="numeric"
				maxlength={6}
				autocomplete="off"
				aria-label="Your family PIN"
				aria-invalid={pinProblem !== null}
				data-test="{prefix}-pin"
				bind:this={pinField}
				bind:value={pin}
			/>
			<Button variant="primary" size="tool" data-test="{prefix}-confirm" disabled={pin.length < 4 || confirming} onclick={confirm}>Confirm it is you</Button>
		</div>
		{#if pinProblem}<div class={[errorText, "mt-1"]} role="alert">{pinProblem}</div>{/if}
	</div>
{/if}
