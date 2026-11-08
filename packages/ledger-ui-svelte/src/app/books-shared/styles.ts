/** The mockup's classes for the Ledger and Reports panes (`.card`, `.stat`, `.kpis`, `.okline`, `.two2`, `h5`, `.krow`,
 * `.khid`, `.kapprox`, `.klock`, `tr.day`, `tr.dt`) as Tailwind classes, shared by the two panes' components. The
 * Bookings and Members panes' (`../panes/styles.ts`) are used as they are. */

/** `.card`: the card fill, a 1px border and the radius, 10px inside. */
export const card =
	"gap-0 overflow-visible rounded-[var(--radius)] border border-border px-2.5 py-2.5 text-[12px] ring-0";
/** `.stat`: a KPI tile that is a button. */
export const stat =
	"block rounded-[var(--radius)] border border-border bg-card px-[11px] py-[9px] text-left font-[inherit] text-foreground enabled:hover:border-ring disabled:cursor-not-allowed";
export const statValue =
	"block text-[17px] font-bold tabular-nums data-[negative]:text-destructive";
export const statNote = "block text-[10.5px] not-italic text-muted-foreground";
export const kpis =
	"mb-2.5 grid grid-cols-[repeat(auto-fit,minmax(120px,1fr))] gap-2";
/** `h5`: a card's small upper-case heading. */
export const heading =
	"mt-3.5 mb-2 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] font-semibold tracking-[.05em] text-muted-foreground uppercase";
/** `.sphead`, `.spax`. */
export const sparkHead = "mb-1.5 flex items-baseline justify-between";
export const sparkAxis =
	"mt-0.5 flex justify-between text-[10px] text-muted-foreground";
/** `.krow`: a label, a bar and a figure. */
export const barRow =
	"my-[7px] grid grid-cols-[minmax(70px,max-content)_1fr_minmax(72px,max-content)] items-center gap-2 data-[waiting]:-mx-1 data-[waiting]:rounded-sm data-[waiting]:bg-[repeating-linear-gradient(135deg,transparent_0_5px,color-mix(in_srgb,var(--ring)_45%,transparent)_5px_6px)] data-[waiting]:px-1 data-[waiting]:py-px data-[waiting]:text-muted-foreground";
export const barTrack =
	"h-2 overflow-hidden rounded-sm bg-border group-data-[waiting]:bg-transparent";
/** `.khid`: a figure that is not shown, with its lock or clock. */
export const hidden =
	"inline-flex items-center gap-[3px] text-left text-[10.5px] font-medium whitespace-normal text-muted-foreground";
/** `.kapprox`: a rounded count, underlined with dots. */
export const approximate =
	"cursor-help border-b border-dotted border-muted-foreground";
export const okLine = "mt-0 mb-2.5";
export const okText = "text-success";
/** `.two2`: the statement and the rules, side by side until 600px. */
export const twoColumns =
	"grid grid-cols-[1.5fr_1fr] items-start gap-2 max-[600px]:grid-cols-1";
/** `tr.day td`, `tr.dt td`. */
export const detailsCell = "bg-code px-2 py-[7px] text-[10.5px]";
/** `#stmt tr[data-dd]`: a statement line that opens the ledger. */
export const drillRow = "cursor-pointer hover:[&>td]:bg-secondary";
/** A bare button that reads as the text it holds (a drill-down's label). */
export const drillButton =
	"cursor-pointer border-0 bg-transparent p-0 text-left font-[inherit] text-[inherit] text-inherit hover:underline";
