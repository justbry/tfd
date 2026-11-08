<script lang="ts">
	import type { BooksUnlock } from "$contract/data/ledger.ts";
	import { Button } from "$lib/components/ui/button/index.ts";
	import { Input } from "$lib/components/ui/input/index.ts";
	import { messageFor } from "../../effect/messages.ts";
	import { write } from "../../effect/run.ts";
	import { perform, useApp } from "../context.ts";
	import Icon from "../Icon.svelte";
	import InlineError from "../toasts/InlineError.svelte";

	/** The PIN prompt (mockup `bkLock`): Unlock opens once 4 digits are typed and sends the PIN to the server
	 * (`Writer.unlockBooks`); the books open only when it answers unlocked, else the prompt says why at the field. A
	 * failed call is a toast from the message table as well, and its text stays at the field. The fixtures check no
	 * PIN. */
	let {
		schoolId,
		levelName,
		onUnlocked,
	}: { schoolId: string; levelName: string; onUnlocked: () => void } = $props();

	const app = useApp();
	const fieldId = $props.id();
	const pinDigits = 4;
	const refusalText: Record<
		Extract<BooksUnlock, { unlocked: false }>["reason"],
		string
	> = {
		pin_wrong: "That is not your family PIN. Try again.",
		pin_locked:
			"Too many tries. Your PIN is locked for a while; try again later.",
	};

	let pin = $state("");
	let checking = $state(false);
	let problem = $state<string | null>(null);
	let input = $state<HTMLInputElement | null>(null);

	const submit = async (): Promise<void> => {
		checking = true;
		problem = null;
		const outcome = await perform(
			app,
			write((writer) => writer.unlockBooks(schoolId, pin)),
			{ enter_pin: () => input?.focus() },
		);
		checking = false;
		if (!outcome.ok) {
			const message = messageFor(outcome.error);
			problem = `${message.title}. ${message.doThis}`;
			return;
		}
		if (outcome.value.unlocked) {
			onUnlocked();
			return;
		}
		problem = refusalText[outcome.value.reason];
		pin = "";
		input?.focus();
	};
</script>

<div
	class="grid justify-items-center gap-1.5 rounded-xl border border-dashed border-border bg-card px-3.5 py-[34px] text-center"
	data-test="pin-lock"
>
	<Icon name="lock" class="size-[26px] text-muted-foreground" />
	<h4 class="m-0 text-[14px] font-semibold">Enter your PIN to see books</h4>
	<div class="text-muted-foreground">
		{levelName} opens the books with your family PIN. Nothing is shown until you unlock.
	</div>
	<form
		class="mt-2.5 grid w-[180px] gap-1 text-left"
		onsubmit={(event) => {
			event.preventDefault();
			if (!checking && pin.length >= pinDigits) submit();
		}}
	>
		<label class="grid gap-[3px] text-[10.5px] text-muted-foreground" for={fieldId}>
			Your family PIN
			<Input
				id={fieldId}
				bind:ref={input}
				bind:value={pin}
				type="password"
				inputmode="numeric"
				maxlength={6}
				autocomplete="off"
				data-test="pin-input"
				aria-invalid={problem ? "true" : undefined}
				aria-describedby={`${fieldId}-problem`}
				class="h-auto rounded-md border-border bg-card px-2 py-1 text-[12px] text-foreground shadow-none md:text-[12px]"
			/>
		</label>
		<InlineError id={`${fieldId}-problem`} problems={problem} />
		<Button
			variant="primary"
			size="tool"
			class="justify-self-center"
			data-test="pin-unlock"
			disabled={checking || pin.length < pinDigits}
			aria-busy={checking}
			onclick={submit}
		>
			<Icon name="unlock" />Unlock
		</Button>
	</form>
</div>
