/** The Plans and Promos panes' mockup classes (`.tools`, `.note`, `.card`, `h5`, `th`, `td`, `.fld`, `.mf`, `.prev`,
 * `.lock`, `.badge`…) as Tailwind classes, shared by their components. Both panes load as their own chunks, each with the
 * utilities it uses (plans.css, promos.css). */
export const tools = "mb-2 flex flex-wrap items-center gap-1.5";
export const spacer = "flex-1";
/** `.note`: a warning line above a table. */
export const note =
	"mb-2 flex items-center gap-2 rounded-[10px] border border-warning px-2.5 py-[7px] text-warning";
/** `.lock`: why a control is off. */
export const lock =
	"my-2 flex items-center gap-1.5 rounded-[10px] border border-warning px-2.5 py-[7px] text-warning";
export const muted = "text-muted-foreground";
/** `h5`. */
export const heading =
	"mt-3.5 mb-2 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] font-semibold tracking-[0.05em] text-muted-foreground uppercase";
/** `.card`. */
export const card = "rounded-[10px] border border-border bg-card p-2.5";
/** Table: `th`, `td`. */
export const headCell =
	"h-auto border-b border-border px-2 py-1.5 text-left text-[10.5px] font-medium whitespace-normal text-muted-foreground";
export const bodyCell =
	"whitespace-normal border-b border-border p-[7px_8px] align-middle";
/** The empty row's cell: the same shorthand, so that it replaces the cell's own (a longhand beside it would depend on which
 * stylesheet comes last: gate K). */
export const emptyCell = "p-[24px_8px] text-center";
export const rowStart = "border-0 hover:bg-transparent";
export const figureCell = "text-right tabular-nums";
/** `.link`. */
export const link =
	"inline-flex cursor-pointer items-center border-0 bg-transparent p-0 text-[11px] text-primary hover:underline disabled:cursor-not-allowed disabled:opacity-45";
/** The mockup's segmented control (`.seg`: joined buttons, the pressed one filled) and chip (`.chip`), as the Dashboard's
 * (dashboard/styles.ts), which sits in the Dashboard's own chunk. */
export const segment =
	"inline-flex overflow-hidden rounded-lg border border-border max-[640px]:flex max-[640px]:max-w-full max-[640px]:flex-wrap max-[640px]:gap-px max-[640px]:bg-border";
export const segmentButton =
	"inline-flex items-center gap-[5px] border-0 bg-card px-3 py-[5px] text-[12px] text-muted-foreground aria-pressed:bg-primary aria-pressed:text-primary-foreground max-[640px]:flex-auto max-[640px]:justify-center max-[640px]:whitespace-nowrap [&_svg]:size-[13px]";
export const chip =
	"inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-[3px] text-[11px] text-foreground aria-pressed:border-primary aria-pressed:text-primary";
/** `.fld`, its label, and the mockup's bare form controls (card fill, 1px border, 6px corner). */
export const field = "mt-2.5";
export const fieldLabel = "mb-[3px] block text-[10.5px] text-muted-foreground";
export const control =
	"h-auto w-full rounded-md border border-border bg-card px-2 py-1 text-[12px] text-foreground disabled:bg-card disabled:opacity-100 md:text-[12px]";
export const selectControl =
	"w-full rounded-md border border-border bg-card px-2 py-1 text-[12px] text-foreground";
/** `.mf`: a dialog's or drawer's buttons. */
export const footer = "mt-3.5 flex justify-end gap-1.5";
/** `.prev`: a dashed explanatory box. */
export const preview =
	"mt-3 rounded-[10px] border border-dashed border-border bg-secondary p-[9px]";
export const error = "text-destructive";
export const ok = "text-success";
export const hint = "mt-[3px] text-[10.5px] text-muted-foreground";
/** `.add-row` under a table. */
export const addRow = "mt-2";
/** The panel the dialogs and the drawer share (the mockup's `.modal` and `.drawer` fill, border and corner). */
export const modal =
	"w-[460px] max-w-[calc(100vw-24px)] gap-0 overflow-auto rounded-[10px] border border-border bg-popover p-4 text-[12px] text-foreground shadow-[0_20px_50px_rgba(0,0,0,0.35)] ring-0 sm:max-w-none";
