/** The mockup's popover (`.pop`) and its rows (`.pop .it`), as Tailwind classes for the shadcn-svelte popover. */
export const popoverPanel =
	"z-(--layer-popover) w-auto min-w-[260px] max-w-[calc(100vw-16px)] gap-0 rounded-xl border border-border bg-popover p-1 text-[12px] shadow-[0_10px_30px_rgba(0,0,0,0.25)] ring-0";

export const popoverRow =
	"flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-foreground hover:bg-secondary focus-visible:bg-secondary focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent";

export const popoverRule = "my-1 border-0 border-t border-border";

/** The mockup's badges (`.badge`, `.b-warn`, `.b-bad`). */
export const badgeTones = {
	plain: "border-border text-muted-foreground",
	warning: "border-warning text-warning",
	bad: "border-destructive text-destructive",
	good: "border-success text-success",
} as const;
export const mockBadge =
	"h-auto gap-0 rounded-4xl border bg-transparent px-1.5 py-px text-[10px] font-normal leading-normal";
