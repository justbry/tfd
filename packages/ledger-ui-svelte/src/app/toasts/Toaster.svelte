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

	const trailingStop = /\.$/;
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
	/** The control that had focus before it went into the stack: it gets focus back when a toast leaves. */
	let focusBefore: HTMLElement | null = null;

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
	/** The failure sentence: announced when the toast appears and when a merge bumps its count, never for progress. */
	const announce = (toast: Toast): string =>
		`${[toast.title, toast.detail, toast.doThis, toast.count > 1 ? `${toast.count} times` : ""]
			.filter(Boolean)
			.map((part) => part?.replace(trailingStop, ""))
			.join(". ")}.`;
	/** A run's progress on a toast, announced politely at each step. */
	const withProgress = $derived(visible.filter((toast) => Boolean(toast.progress)));
	/** Neither the page nor the frame is a control to come back to, nor a place the stack must avoid. */
	const isControl = (element: Element): element is HTMLElement =>
		element instanceof HTMLElement && element !== document.body && element !== frame;
	let sentinel: HTMLElement | undefined = $state();

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
			active instanceof Element && isControl(active) && !region?.contains(active)
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

	/** Focus never falls to the page's body when a toast leaves, whatever takes it down (its own button, the read it
	 * reported recovering, its timer): before the stack redraws, if focus is inside a toast that is leaving, it goes
	 * back to the control that had it before the stack, else to the Dismiss of a toast that stays, else to the stack's
	 * own sentinel (never the app's frame, which the stack would then take for a control to avoid). Each candidate is
	 * kept only if it took focus: a control disabled meanwhile does not. */
	const moveFocusOut = (staying: ReadonlySet<string>): void => {
		const neighbour = [
			...(region?.querySelectorAll<HTMLElement>("[data-toast-id]") ?? []),
		].find((element) => staying.has(element.dataset.toastId ?? ""));
		const candidates = [
			focusBefore?.isConnected ? focusBefore : null,
			neighbour?.querySelector<HTMLElement>("[data-test=toast-dismiss]") ?? null,
			sentinel ?? null,
		];
		for (const candidate of candidates) {
			if (!candidate) continue;
			candidate.focus();
			if (document.activeElement === candidate) return;
		}
	};
	$effect.pre(() => {
		const staying = new Set(visible.map((toast) => toast.id));
		untrack(() => {
			const active = document.activeElement;
			const holder =
				active instanceof HTMLElement && region?.contains(active)
					? active.closest<HTMLElement>("[data-toast-id]")
					: null;
			if (holder && !staying.has(holder.dataset.toastId ?? "")) moveFocusOut(staying);
		});
	});

	onMount(() => {
		const onFocusIn = (event: FocusEvent): void => {
			const target = event.target;
			if (!(target instanceof Element) || !isControl(target) || region?.contains(target)) return;
			focused = boxOf(target);
			focusBefore = target;
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
	<span bind:this={sentinel} class="sr-only" tabindex="-1" data-test="toasts-sentinel">Notifications</span>
	<div class="sr-only" role="alert" data-test="toasts-assertive">
		{#each visible.filter((toast) => toast.tone === "error") as toast (`${toast.id}-${toast.count}`)}
			<p>{announce(toast)}</p>
		{/each}
	</div>
	<div class="sr-only" role="status" data-test="toasts-polite">
		{#each visible.filter((toast) => toast.tone !== "error") as toast (`${toast.id}-${toast.count}-${toast.detail ?? ""}`)}
			<p>{announce(toast)}</p>
		{/each}
		{#each withProgress as toast (`${toast.id}-progress-${toast.progress}`)}
			<p>{toast.title.replace(trailingStop, "")}. {toast.progress}.</p>
		{/each}
	</div>
	{#each visible as toast (toast.id)}
		<div
			data-test="toast"
			data-toast-id={toast.id}
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
				{#if toast.progress}
					<div data-test="toast-progress">{toast.progress}</div>
				{:else if toast.detail}
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
						aria-disabled={toast.busy ? "true" : undefined}
						aria-busy={toast.busy ? "true" : undefined}
						onclick={() => {
							// While a run it started is on its way, the action stays focusable but does nothing.
							if (toast.busy) return;
							toast.action?.run();
							if (!toast.action?.keep) store.dismiss(toast.id);
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
