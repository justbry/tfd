<script lang="ts">
	import { onMount } from "svelte";
	import type { Toast } from "../../effect/toast-model.ts";
	import Icon from "../Icon.svelte";
	import type { IconName } from "../icons.ts";
	import type { ToastStore } from "../toast-store.svelte.ts";

	/** The toast region (S9-plan section 5): top right on wide screens, along the bottom on narrow ones, above
	 * dialogs (`--layer-toast`). When the focused control sits under the region, the region moves to the other edge
	 * so that it never covers it. Errors are `role=alert`, the rest `role=status`; each toast's action and Dismiss
	 * are ordinary buttons in the tab order. */
	let { store }: { store: ToastStore } = $props();

	const toneIcons: Record<Toast["tone"], IconName> = {
		error: "alert",
		warning: "alert",
		success: "check",
		info: "info",
	};
	const toneStripes: Record<Toast["tone"], string> = {
		error: "border-l-destructive",
		warning: "border-l-warning",
		success: "border-l-success",
		info: "border-l-info",
	};

	let region: HTMLElement | undefined = $state();
	/** The region has moved off its usual edge to keep clear of the focused control. */
	let moved = $state(false);

	const overlaps = (first: DOMRect, second: DOMRect): boolean =>
		first.left < second.right &&
		second.left < first.right &&
		first.top < second.bottom &&
		second.top < first.bottom;

	onMount(() => {
		const onFocus = (event: FocusEvent): void => {
			const focused = event.target;
			if (!region || !(focused instanceof Element) || region.contains(focused))
				return;
			if (
				overlaps(focused.getBoundingClientRect(), region.getBoundingClientRect())
			)
				moved = !moved;
		};
		document.addEventListener("focusin", onFocus);
		return () => document.removeEventListener("focusin", onFocus);
	});
</script>

<section
	bind:this={region}
	aria-label="Notifications"
	data-test="toasts"
	data-moved={moved ? "true" : undefined}
	class={[
		"pointer-events-none fixed z-(--layer-toast) flex w-[360px] max-w-[calc(100vw-16px)] flex-col gap-2",
		moved
			? "bottom-3 right-3 max-[600px]:inset-x-2 max-[600px]:top-2 max-[600px]:bottom-auto max-[600px]:w-auto"
			: "top-3 right-3 max-[600px]:inset-x-2 max-[600px]:top-auto max-[600px]:bottom-2 max-[600px]:w-auto",
	]}
>
	{#each store.state.visible as toast (toast.id)}
		<div
			role={toast.tone === "error" ? "alert" : "status"}
			aria-live={toast.tone === "error" ? "assertive" : "polite"}
			aria-atomic="true"
			data-test="toast"
			data-tone={toast.tone}
			class={[
				"pointer-events-auto flex items-start gap-2 rounded-lg border-l-[3px] bg-foreground px-3 py-2 text-background shadow-toast",
				toneStripes[toast.tone],
			]}
		>
			<Icon name={toneIcons[toast.tone]} class="mt-px" />
			<div class="min-w-0 flex-1">
				<div class="flex items-center gap-1.5">
					<b class="font-semibold" data-test="toast-title">{toast.title}</b>
					{#if toast.count > 1}
						<span
							class="rounded-4xl border border-background/40 px-1.5 text-[10px]"
							data-test="toast-count"
							aria-label={`${toast.count} times`}>×{toast.count}</span
						>
					{/if}
				</div>
				{#if toast.detail}
					<div data-test="toast-detail">{toast.detail}</div>
				{/if}
				{#if toast.doThis}
					<div class="opacity-75" data-test="toast-do">{toast.doThis}</div>
				{/if}
				{#if toast.action}
					<button
						type="button"
						class="mt-1 rounded-md border border-background/40 px-2 py-0.5 font-semibold hover:bg-background/10 focus-visible:outline-2 focus-visible:outline-background"
						data-test="toast-action"
						onclick={() => {
							toast.action?.run();
							store.dismiss(toast.id);
						}}>{toast.action.label}</button
					>
				{/if}
			</div>
			<button
				type="button"
				class="-mr-1 grid size-6 place-items-center rounded-md opacity-75 hover:opacity-100 focus-visible:outline-2 focus-visible:outline-background"
				aria-label={`Dismiss: ${toast.title}`}
				data-test="toast-dismiss"
				onclick={() => store.dismiss(toast.id)}
			>
				<Icon name="x" />
			</button>
		</div>
	{/each}
	{#if store.state.waiting.length > 0}
		<div
			class="pointer-events-auto self-end rounded-4xl bg-foreground px-2 py-0.5 text-[10px] text-background"
			data-test="toasts-waiting"
			role="status"
		>
			{store.state.waiting.length} more waiting
		</div>
	{/if}
</section>
