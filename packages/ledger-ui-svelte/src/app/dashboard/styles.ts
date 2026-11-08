/** The Dashboard's mockup classes as Tailwind classes (mockup `.kcards`, `.kgrid`, `.krow`, `.kmonths`, `.seg`,
 * `.chip`, `.kcaption`), shared by its components. */
export const cardsGrid =
	"mb-2.5 grid grid-cols-[repeat(auto-fit,minmax(122px,1fr))] gap-2";
export const boxGrid =
	"grid grid-cols-[repeat(auto-fit,minmax(min(300px,100%),1fr))] gap-2.5";
/** A row of a breakdown or a series: its name, a track with its bar, its figure. */
export const row =
	"my-[7px] grid grid-cols-[minmax(70px,max-content)_1fr_minmax(72px,max-content)] items-center gap-2";
export const track = "h-2 overflow-hidden rounded bg-border";
export const bar = "block h-full rounded";
/** A withheld figure keeps to one line in a row (mockup `.krow .khid`). */
export const figure =
	"text-right font-medium tabular-nums [&_[data-hid]]:whitespace-nowrap";
export const footnote = "mt-2 text-muted-foreground";
export const muted = "text-muted-foreground";
/** The mockup's segmented control (`.seg`): joined buttons, the pressed one filled. */
export const segment =
	"inline-flex overflow-hidden rounded-lg border border-border max-[640px]:flex max-[640px]:max-w-full max-[640px]:flex-wrap max-[640px]:gap-px max-[640px]:bg-border";
export const segmentButton =
	"inline-flex items-center gap-[5px] border-0 bg-card px-3 py-[5px] text-[12px] text-muted-foreground aria-pressed:bg-primary aria-pressed:text-primary-foreground max-[640px]:flex-auto max-[640px]:justify-center max-[640px]:whitespace-nowrap [&_svg]:size-[13px]";
export const chip =
	"inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-[3px] text-[11px] text-foreground aria-pressed:border-primary aria-pressed:text-primary";
export const caption =
	"mb-2.5 flex items-start gap-[7px] rounded-xl border border-border bg-secondary px-2.5 py-[7px] text-[11.5px] [&_svg]:mt-px [&_svg]:size-[13px]";
export const link =
	"inline-flex items-center border-0 bg-transparent p-0 text-[11px] text-primary hover:underline";
