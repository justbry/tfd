<script lang="ts" module>
	import { type VariantProps, tv } from "tailwind-variants";

	export const alertVariants = tv({
		base: "relative grid w-full gap-0.5 rounded-lg border px-2.5 py-2 text-left text-sm",
		variants: {
			variant: {
				default: "bg-card text-card-foreground",
				// The demo alert: a 2px frame in the warning colour, the popover's fill.
				warning: "border-2 border-warning bg-popover text-foreground",
				destructive: "bg-card text-destructive *:data-[slot=alert-description]:text-destructive/90",
			},
		},
		defaultVariants: {
			variant: "default",
		},
	});

	export type AlertVariant = VariantProps<typeof alertVariants>["variant"];
</script>

<script lang="ts">
	import { cn, type WithElementRef } from "$lib/utils.js";
	import type { HTMLAttributes } from "svelte/elements";

	let {
		ref = $bindable(null),
		class: className,
		variant = "default",
		children,
		...restProps
	}: WithElementRef<HTMLAttributes<HTMLDivElement>> & {
		variant?: AlertVariant;
	} = $props();
</script>

<div
	bind:this={ref}
	data-slot="alert"
	role="alert"
	class={cn(alertVariants({ variant }), className)}
	{...restProps}
>
	{@render children?.()}
</div>
