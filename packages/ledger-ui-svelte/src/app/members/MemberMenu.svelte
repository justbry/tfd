<script lang="ts">
	import { onMount } from "svelte";
	import PaneIcon from "../PaneIcon.svelte";
	import { type MenuAction, menuItems, type PersonContext } from "./menu-items.ts";

	/** The open ⋯ menu (mockup `#kmm`, `.kmenu`): arrows, Home and End move between the items that are on, Escape
	 * closes it and returns focus to its button, Tab or a click elsewhere closes it. Above 600px it sits under (or
	 * over) its button; below, it is a sheet at the bottom. An item that is off is disabled with its reason as the
	 * title; it stays focusable (`aria-disabled`, the click does nothing) and its reason is text it is described by; the Stripe item is a link. The menu is the
	 * app's own markup (buttons and rules in a `role=menu`), not a shadcn-svelte dropdown: its golden file addresses
	 * the items as buttons and links, in order. */
	let {
		context,
		anchor,
		focusFirst,
		onChoose,
		onClose,
	}: {
		context: PersonContext;
		anchor: HTMLElement;
		focusFirst: boolean;
		onChoose: (action: MenuAction) => void;
		/** `returnFocus`: put focus back on the button. */
		onClose: (returnFocus: boolean) => void;
	} = $props();

	/** Every item can take focus, one that is off included (its reason is read from it); the first to take it is the first
	 * that is on. */
	const allItems = "button, a[href]";
	const enabledItems = 'button:not([aria-disabled="true"]), a[href]';
	const compactWidth = 600;
	const menuGap = 4;
	const screenMargin = 8;
	const menuId = $props.id();
	let menu = $state<HTMLElement | null>(null);
	const items = $derived(menuItems(context));

	onMount(() => {
		const element = menu;
		if (!element) return;
		element.style.removeProperty("top");
		element.style.removeProperty("left");
		if (window.innerWidth > compactWidth) {
			const button = anchor.getBoundingClientRect();
			const { offsetWidth, offsetHeight } = element;
			const below =
				button.bottom + menuGap + offsetHeight <= window.innerHeight ||
				button.top < offsetHeight + screenMargin;
			const top = below ? button.bottom + menuGap : button.top - offsetHeight - menuGap;
			const left = Math.min(button.right - offsetWidth, window.innerWidth - offsetWidth - screenMargin);
			element.style.top = `${Math.max(screenMargin, top)}px`;
			element.style.left = `${Math.max(screenMargin, left)}px`;
		}
		if (focusFirst) element.querySelector<HTMLElement>(enabledItems)?.focus();
		const onClick = (event: MouseEvent): void => {
			const target = event.target;
			if (!(target instanceof Element)) return;
			/* A ⋯ button opens or closes its own menu. */
			const inside = element.contains(target) || target.closest('[aria-haspopup="menu"]') !== null;
			if (!inside) onClose(false);
		};
		const onKeyDown = (event: KeyboardEvent): void => {
			if (event.key !== "Escape") return;
			event.stopPropagation();
			onClose(true);
		};
		document.addEventListener("click", onClick);
		document.addEventListener("keydown", onKeyDown, true);
		return () => {
			document.removeEventListener("click", onClick);
			document.removeEventListener("keydown", onKeyDown, true);
		};
	});

	const onMenuKeyDown = (event: KeyboardEvent & { currentTarget: HTMLElement }): void => {
		if (event.key === "Tab") {
			/* Focus goes back to the ⋯ button first, so that Tab moves on from there, not from a menu that is gone. */
			onClose(true);
			return;
		}
		const enabled = [...event.currentTarget.querySelectorAll<HTMLElement>(allItems)];
		const current = enabled.indexOf(event.target as HTMLElement);
		const targets: Record<string, number> = { ArrowDown: current + 1, ArrowUp: current - 1, Home: 0, End: -1 };
		const target = targets[event.key];
		if (target === undefined || enabled.length === 0) return;
		event.preventDefault();
		enabled[(target + enabled.length) % enabled.length]?.focus();
	};

	const itemClass =
		"flex w-full items-center gap-1.5 rounded-sm border-0 bg-transparent px-2 py-1.5 text-left text-[12px] text-foreground hover:bg-secondary focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring aria-disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:hover:bg-transparent max-[600px]:px-2.5 max-[600px]:py-3 data-destructive:text-destructive [&_svg]:size-3.5 [&_svg]:flex-none";
</script>

<!-- svelte-ignore a11y_interactive_supports_focus -->
<div
	bind:this={menu}
	class="fixed z-85 max-h-[calc(100vh-16px)] max-w-[calc(100vw-16px)] min-w-[230px] overflow-auto rounded-xl border border-border bg-popover p-1 shadow-popover max-[600px]:inset-x-0 max-[600px]:top-auto! max-[600px]:bottom-0 max-[600px]:left-0! max-[600px]:max-h-[75vh] max-[600px]:max-w-none max-[600px]:min-w-0 max-[600px]:rounded-t-[14px] max-[600px]:rounded-b-none max-[600px]:p-2"
	role="menu"
	tabindex="-1"
	aria-label="Member actions"
	data-test="member-menu"
	onkeydown={onMenuKeyDown}
>
	{#each items as entry, index (entry ? entry.action : `rule-${index}`)}
		{#if entry === null}
			<hr class="my-1 border-0 border-t border-border" />
		{:else}
			{#if entry.href !== undefined && entry.reason === ""}
				<a
					role="menuitem"
					tabindex="-1"
					class={itemClass}
					data-test="member-menu-item"
					data-action={entry.action}
					href={entry.href}
					target="_blank"
					rel="noopener"
					title={entry.hint}
					onclick={() => onChoose(entry.action)}
				><PaneIcon name={entry.icon} />{entry.label}</a>
			{:else}
				<button
					type="button"
					role="menuitem"
					tabindex="-1"
					class={itemClass}
					data-test="member-menu-item"
					data-action={entry.action}
					data-destructive={entry.destructive ? "" : undefined}
					aria-disabled={entry.reason === "" ? undefined : "true"}
					aria-describedby={entry.reason === "" ? undefined : `${menuId}-${entry.action}-reason`}
					title={entry.reason === "" ? entry.hint : entry.reason}
					onclick={() => {
						if (entry.reason === "") onChoose(entry.action);
					}}
				><PaneIcon name={entry.icon} />{entry.label}</button>
			{/if}
			{#if entry.reason !== ""}
				<span id={`${menuId}-${entry.action}-reason`} class="sr-only">{entry.reason}</span>
			{/if}
		{/if}
	{/each}
</div>
