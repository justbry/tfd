/** The mockup's classes for the Bookings and Members panes (`.tools`, `.chip`, `table`, `.day`, `.badge`, `.fld`,
 * `.prev`, `.mf`, `.note`, `.link`, `.mono`, `.mut`) as Tailwind classes, shared by the two panes' components. */
export const tools = "mb-2 flex flex-wrap items-center gap-1.5";
export const toolsSpacer = "flex-1";
export const chip =
	"inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-[3px] text-[11px] text-foreground aria-pressed:border-primary aria-pressed:text-primary";
/** The mockup's `.badge`: the shell's badge (`mockBadge`) in the muted colour and the border colour, which a tone
 * (`badgeTones`) replaces. */
export const paneBadge =
	"h-auto gap-0 rounded-4xl border border-border bg-transparent px-1.5 py-px text-[10px] leading-normal font-normal text-muted-foreground";
export const muted = "text-muted-foreground";
export const mono = "font-mono text-[10.5px]";
export const link =
	"inline-flex items-center border-0 bg-transparent p-0 text-[11px] text-primary hover:underline disabled:cursor-not-allowed disabled:opacity-40 disabled:no-underline";
export const note =
	"mb-2 flex items-center gap-2 rounded-xl border border-warning px-2.5 py-[7px] text-warning";
export const headCell =
	"h-auto border-b border-border px-2 py-1.5 text-[10.5px] font-medium text-muted-foreground";
export const cell = "border-b border-border px-2 py-[7px] align-middle";
export const dayRow =
	"border-b border-border bg-card px-2 py-1.5 text-[10.5px] font-semibold text-muted-foreground";
export const rowHover = "cursor-pointer hover:[&>td]:bg-secondary";
/** `.btn.s` of the row actions and the drawer. */
export const smallButtons = "flex flex-wrap justify-end gap-1";
/** The mockup's field (`select, input, textarea`): card fill, 1px border, 6px corners. */
export const field =
	"h-auto w-full rounded-md border border-border bg-card px-2 py-1 text-[12px] text-foreground shadow-none focus-visible:ring-0 focus-visible:border-ring";
/** `.fld`: a labelled field of a dialog. */
export const fieldBox = "mt-2.5";
export const fieldLabel = "mb-[3px] block text-[10.5px] text-muted-foreground";
export const checkLabel =
	"mt-2.5 flex items-center gap-1.5 text-[11.5px] text-foreground";
/** `.prev`: the dashed box under a dialog's fields. */
export const preview =
	"mt-3 rounded-xl border border-dashed border-border bg-secondary p-[9px]";
/** `.mf`: Cancel and the action, right-aligned. */
export const modalFooter = "mt-3.5 flex justify-end gap-1.5";
export const errorText = "text-destructive";
export const okText = "text-success";
