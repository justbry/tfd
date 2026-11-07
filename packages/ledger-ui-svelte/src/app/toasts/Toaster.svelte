<script lang="ts">
	import { onMount, untrack } from "svelte";
	import type { Toast } from "../../effect/toast-model.ts";
	import Icon from "../Icon.svelte";
	import type { IconName } from "../icons.ts";
	import type { ToastStore } from "../toast-store.svelte.ts";
	import {
		type Box,
		edgeFor,
		type Layout,
		positionStyle,
		usualBox,
		visiblePart,
	} from "./placement.ts";

	/** The toast stack (S9-plan section 5). Two live regions exist from mount: `role=alert` (assertive) announces
	 * errors, `role=status` (polite) the rest, each line re-announced when a merge bumps its count; the visible toasts
	 * are plain content with ordinary buttons for their action and Dismiss. Top right below the top bar on wide
	 * screens, along the bottom on narrow ones, above dialogs (`--layer-toast`); while a toast covers the focused
	 * control the stack takes the other edge (placement.ts). */
	let {
		store,
		anchor,
		frame,
	}: {
		store: ToastStore;
		/** The last of the bars: the stack sits below it on wide screens. */
		anchor: HTMLElement | null;
		/** The app's frame: the stack stays inside it; the viewport when there is none. */
		frame: HTMLElement | null;
	} = $props();

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
	let regionHeight = $state(0);
	let viewport = $state({ width: 0, height: 0 });
	let frameBox = $state<Box>({ left: 0, top: 0, right: 0, bottom: 0 });
	let barsBottom = $state(0);
	let focused = $state<Box | null>(null);

	const visible = $derived(store.state.visible);
	const layout = $derived<Layout>({
		viewport,
		frame: frameBox,
		barsBottom,
		height: regionHeight,
	});
	const edge = $derived(
		edgeFor({ toastCount: visible.length, focused, usual: usualBox(layout) }),
	);
	const announce = (toast: Toast): string =>
		[toast.title, toast.detail, toast.doThis, toast.count > 1 ? `${toast.count} times` : ""]
			.filter(Boolean)
			.join(". ");

	const boxOf = (element: Element): Box => {
		const { left, top: boxTop, right, bottom } = element.getBoundingClientRect();
		return { left, top: boxTop, right, bottom };
	};
	/** Reads the page's geometry into the stack's state; it reads none of that state, so it never loops. */
	const measure = (): void => {
		const nextViewport = { width: window.innerWidth, height: window.innerHeight };
		const nextFrame = visiblePart(
			frame
				? boxOf(frame)
				: { left: 0, top: 0, right: nextViewport.width, bottom: nextViewport.height },
			nextViewport,
		);
		const active = document.activeElement;
		viewport = nextViewport;
		frameBox = nextFrame;
		barsBottom = Math.max(
			nextFrame.top,
			anchor ? anchor.getBoundingClientRect().bottom : nextFrame.top,
		);
		focused =
			active instanceof Element && active !== document.body && !region?.contains(active)
				? boxOf(active)
				: null;
	};

	$effect(() => {
		// Measured again when the bars appear (the shell renders), the frame changes, or the stack's toasts change.
		void anchor;
		void frame;
		void visible.length;
		untrack(measure);
	});

	onMount(() => {
		const onFocusIn = (event: FocusEvent): void => {
			const target = event.target;
			if (!(target instanceof Element) || region?.contains(target)) return;
			focused = boxOf(target);
		};
		const onFocusOut = (event: FocusEvent): void => {
			if (event.relatedTarget === null) focused = null;
		};
		document.addEventListener("focusin", onFocusIn);
		document.addEventListener("focusout", onFocusOut);
		window.addEventListener("resize", measure);
		window.addEventListener("scroll", measure, true);
		return () => {
			document.removeEventListener("focusin", onFocusIn);
			document.removeEventListener("focusout", onFocusOut);
			window.removeEventListener("resize", measure);
			window.removeEventListener("scroll", measure, true);
		};
	});
</script>

<section
	bind:this={region}
	bind:clientHeight={regionHeight}
	aria-label="Notifications"
	data-test="toasts"
	data-edge={edge}
	class="pointer-events-none fixed z-(--layer-toast) flex max-w-[calc(100vw-16px)] flex-col gap-2"
	style={positionStyle(edge, layout)}
>
	<div class="sr-only" role="alert" data-test="toasts-assertive">
		{#each visible.filter((toast) => toast.tone === "error") as toast (`${toast.id}-${toast.count}`)}
			<p>{announce(toast)}</p>
		{/each}
	</div>
	<div class="sr-only" role="status" data-test="toasts-polite">
		{#each visible.filter((toast) => toast.tone !== "error") as toast (`${toast.id}-${toast.count}`)}
			<p>{announce(toast)}</p>
		{/each}
	</div>
	{#each visible as toast (toast.id)}
		<div
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
							data-test="toast-count"><span aria-hidden="true">×{toast.count}</span><span class="sr-only"
								>{toast.count} times</span
							></span
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
		>
			{store.state.waiting.length} more waiting
		</div>
	{/if}
</section>
