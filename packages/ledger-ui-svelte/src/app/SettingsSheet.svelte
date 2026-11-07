<script lang="ts">
	import type { Theme } from "$contract/app/route.ts";
	import * as Sheet from "$lib/components/ui/sheet/index.ts";
	import Icon from "./Icon.svelte";
	import type { IconName } from "./icons.ts";

	/** The settings drawer (mockup `#set`, `settings()`) as a shadcn-svelte sheet: Appearance, just for you, for
	 * every school; the school's own settings arrive in S9.5. Escape and the close button shut it; focus returns to
	 * the gear button. */
	let {
		open = $bindable(),
		top,
		subtitle,
		allSchools,
		theme,
		onThemeChange,
	}: {
		open: boolean;
		/** Where the top bar ends: the sheet hangs below it, as the mockup's drawer does. */
		top: number;
		subtitle: string;
		allSchools: boolean;
		theme: Theme;
		onThemeChange: (theme: Theme) => void;
	} = $props();

	const themes: Array<{ value: Theme; label: string; icon: IconName }> = [
		{ value: "light", label: "Light", icon: "sun" },
		{ value: "dark", label: "Dark", icon: "moon" },
		{ value: "system", label: "System", icon: "monitor" },
	];
</script>

<Sheet.Root bind:open>
	<Sheet.Content
		side="right"
		class="z-(--layer-sheet) gap-0 data-[side=right]:w-[68%] max-[600px]:data-[side=right]:w-[94%] border-t border-l border-border bg-card p-3.5 text-[12px] text-foreground shadow-[-12px_0_30px_rgba(0,0,0,0.25)] data-[side=right]:h-auto data-[side=right]:sm:max-w-none"
		style={`top: ${top}px`}
		overlayClass="z-(--layer-sheet) bg-transparent supports-backdrop-filter:backdrop-blur-none"
		data-test="settings"
	>
		<Sheet.Header class="gap-0.5 p-0">
			<Sheet.Title class="flex items-center gap-1.5 text-[14px] font-semibold">
				<Icon name="gear" />Settings
			</Sheet.Title>
			<Sheet.Description class="text-[12px] text-muted-foreground">{subtitle}</Sheet.Description>
		</Sheet.Header>
		<h3
			class="mt-3.5 mb-2 flex items-center gap-1 text-[11px] font-semibold tracking-[0.05em] text-muted-foreground uppercase"
		>
			<Icon name="sun" /> Appearance
			<span class="font-normal normal-case">just for you</span>
		</h3>
		<div class="inline-flex self-start overflow-hidden rounded-lg border border-border" role="group" aria-label="Appearance">
			{#each themes as option (option.value)}
				<button
					type="button"
					class={[
						"inline-flex items-center gap-1.5 px-3 py-[5px]",
						theme === option.value ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground",
					]}
					data-theme={option.value}
					aria-pressed={theme === option.value}
					onclick={() => onThemeChange(option.value)}
				>
					<Icon name={option.icon} />{option.label}
				</button>
			{/each}
		</div>
		<div class="mt-4 flex items-start gap-1.5 text-muted-foreground" data-test="settings-note">
			<Icon name="info" class="mt-px" />
			{allSchools
				? "Accounting, keys and connections are set per school. Open a school to change them."
				: "The school's own settings (accounting, books, keys, connections) arrive in S9.5."}
		</div>
	</Sheet.Content>
</Sheet.Root>
