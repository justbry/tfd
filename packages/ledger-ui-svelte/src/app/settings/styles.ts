/** The Settings drawer's mockup classes (`.drawer h5`, `.seg`, `.crow`, `.kbp`, `.kdt`, `.prev`, `.row2`, `.lock`…) as
 * Tailwind classes, shared by its components; the plans' own (plans/styles.ts) are reused where the mockup's rule is the same. */
export {
	control,
	error,
	field,
	fieldLabel,
	footer,
	heading,
	hint,
	lock,
	muted,
	ok,
	preview,
	segment,
	segmentButton,
	selectControl,
} from "../plans/styles.ts";

/** `.section-note`: the muted part of a section's heading. */
export const sectionNote = "font-normal normal-case";
/** `.sechead`: the school's name above its settings. */
export const schoolHead =
	"mt-5 mb-0.5 flex items-center gap-1.5 border-t border-border pt-3 font-semibold";
/** `.row2`. */
export const row = "flex flex-wrap items-center gap-1.5";
/** `.crow`, `.cic`, `.cm`, `.ca`: one row of Keys and Connections. */
export const connectionRow =
	"flex items-center gap-2.5 border-t border-border py-[9px] first-of-type:border-t-0";
export const connectionIcon =
	"grid size-[30px] flex-none place-items-center rounded-lg border border-border text-primary [&_svg]:size-4";
export const connectionBody = "min-w-0 flex-1";
export const connectionActions = "flex flex-wrap justify-end gap-1";
/** `.badge` and its tones (a class list is joined, not merged, so each tone is a whole string). */
const badgeBase =
	"inline-flex items-center rounded-4xl border px-1.5 py-px text-[10px] whitespace-nowrap";
const badgeTones = {
	neutral: "border-border text-muted-foreground",
	ok: "border-success text-success",
	warn: "border-warning text-warning",
} as const;
export const badgeClass = (tone: keyof typeof badgeTones = "neutral"): string =>
	`${badgeBase} ${badgeTones[tone]}`;
/** An icon inside a line of text (the SVG is a block element otherwise). */
export const inlineIcon = "mr-1 inline size-[13px] align-[-2px]";
/** `.pre` and `.codebig`. */
export const pre =
	"my-1.5 rounded-md border border-border bg-code p-2 font-mono text-[10.5px] break-all whitespace-pre-wrap";
export const codeBig =
	"mt-3 mb-2 select-all rounded-xl border border-border bg-secondary p-3.5 text-center font-mono text-[16px] tracking-[0.05em] break-all";
/** `.permg`. */
export const permissions = "mt-2 grid grid-cols-2 gap-x-3.5 gap-y-0.5";
/** `.kbp`: the override editor's box, its two-column rows and labels. */
export const overrideBox =
	"my-2 rounded-xl border border-border bg-card px-2.5 py-2";
export const overrideHint = "text-[10.5px] text-muted-foreground";
export const twoColumns = "mt-1 mb-1.5 grid grid-cols-2 gap-1.5";
export const threeColumns = "mt-1 mb-1.5 grid grid-cols-3 gap-1.5";
export const overrideLabel = "mb-0.5 block text-[10px] text-muted-foreground";
/** `.kdt`: the disclosure table. */
export const tableScroll = "overflow-x-auto";
export const tableCell = "align-top p-1 text-[10.5px]";
export const kpiCell =
	"max-w-[150px] align-top p-1 font-mono text-[9.5px] break-words";
export const customAudiences =
	"my-2 flex items-center gap-2 rounded-md border border-dashed border-border px-2 py-1.5 opacity-75";
