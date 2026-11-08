/** The member portal's mockup classes (`.vm`, `.vmbar`, `.mpf`, `.mp-card`, `.mp-btn`, `.mp-pill`…) as Tailwind classes. The
 * frame takes the school's site theme: its custom properties (`--mp-bg`, `--mp-fg`…) are set on the frame element
 * (portalFrameVariables), and everything inside reads them, so a theme changes the portal and nothing else. */
export const frame =
	"overflow-hidden rounded-xl border border-border bg-(--mp-bg) font-(family-name:--mp-font) text-[13px] text-(--mp-fg)";
export const siteHeader =
	"flex items-center gap-4 border-b border-(--mp-border) bg-(--mp-card) px-4 py-2.5 [&_b]:mr-1.5 [&_b]:text-[14px] [&_span]:text-(--mp-muted)";
export const siteBody = "mx-auto max-w-[640px] p-4";
export const tabRow =
	"mb-3.5 flex gap-1 overflow-x-auto border-b border-(--mp-border)";
export const tabButton =
	"inline-flex cursor-pointer items-center gap-[5px] border-0 border-b-2 border-transparent bg-transparent px-2.5 py-2 whitespace-nowrap text-(--mp-muted) aria-selected:border-(--mp-pri) aria-selected:text-(--mp-fg) [&_svg]:size-3.5";
/** Tailwind classes that set the same property do not merge here (a class list is joined, not merged), so each variant is
 * a whole string and no list holds two of them. */
export const card =
	"mb-3 rounded-(--mp-rad) border border-(--mp-border) bg-(--mp-card) p-3.5";
export const cardFlat =
	"m-0 rounded-(--mp-rad) border border-(--mp-border) bg-(--mp-card) p-3.5";
export const cardTitle =
	"m-0 mb-0.5 flex items-center gap-1 text-[16px] font-semibold [&_svg]:size-4";
export const cardTitleLoose =
	"m-0 mb-2 flex items-center gap-1 text-[16px] font-semibold [&_svg]:size-4";
export const rowBetween = "flex items-start justify-between gap-2.5";
export const rowWrap = "flex flex-wrap items-center justify-between gap-2.5";
export const muted = "text-(--mp-muted)";
export const big = "text-[30px] leading-[1.1] font-bold";
export const bigSmall = "text-[20px] leading-[1.1] font-bold";
export const actions = "mt-2.5 flex flex-wrap gap-2";
export const actionsInline =
	"m-0 flex flex-wrap items-center gap-2 max-[520px]:w-full [&>*]:max-[520px]:flex-auto";
const buttonBase =
	"inline-flex cursor-pointer items-center gap-1.5 rounded-(--mp-rad) border px-3 py-1.5 disabled:cursor-not-allowed disabled:opacity-45 [&_svg]:size-3.5";
const buttonTones = {
	plain:
		"border-(--mp-border) bg-(--mp-bg) text-(--mp-fg) hover:border-(--mp-muted)",
	primary: "border-(--mp-pri) bg-(--mp-pri) text-(--mp-prifg)",
	danger: "border-(--mp-warn) bg-(--mp-bg) text-(--mp-warn)",
} as const;
export const buttonClass = (tone: keyof typeof buttonTones = "plain"): string =>
	`${buttonBase} ${buttonTones[tone]}`;
const pillBase =
	"inline-flex items-center gap-1 rounded-full px-[9px] py-px text-[11px] whitespace-nowrap";
const pillTones = {
	ok: "bg-(--mp-pri) text-(--mp-prifg)",
	neutral: "border border-(--mp-border) bg-transparent text-(--mp-muted)",
	warn: "border border-(--mp-warn) bg-transparent text-(--mp-warn)",
} as const;
export const pillClass = (tone: keyof typeof pillTones = "ok"): string =>
	`${pillBase} ${pillTones[tone]}`;
export const note =
	"mt-2 flex items-center gap-1.5 rounded-(--mp-rad) border border-(--mp-warn) px-2.5 py-[7px] text-(--mp-warn)";
export const bar =
	"mt-2.5 flex h-2.5 overflow-hidden rounded-full bg-(--mp-border)";
export const list = "grid gap-0";
export const item =
	"flex items-center justify-between gap-2.5 border-t border-(--mp-border) py-2.5 first:border-t-0 first:pt-0";
export const select =
	"rounded-(--mp-rad) border border-(--mp-border) bg-(--mp-bg) px-2 py-1.5 text-(--mp-fg)";
export const headCell =
	"border-b border-(--mp-border) p-[6px_4px] text-left text-[11px] font-medium text-(--mp-muted) max-[520px]:p-0";
export const headCellRight =
	"border-b border-(--mp-border) p-[6px_4px] text-right text-[11px] font-medium text-(--mp-muted) max-[520px]:p-0";
export const bodyCell =
	"border-b border-(--mp-border) p-[8px_4px] align-middle max-[520px]:border-0 max-[520px]:p-0";
export const bodyCellRight =
	"border-b border-(--mp-border) p-[8px_4px] text-right align-middle max-[520px]:border-0 max-[520px]:p-0";
export const groupHeading =
	"border-b border-(--mp-border) p-[12px_4px_4px] text-left text-[11px] font-semibold tracking-[0.04em] text-(--mp-muted) uppercase max-[520px]:block";
/** The dialogs' field, line and preview, as the app's dialogs draw them. */
export const dialogFooter = "mt-3.5 flex justify-end gap-1.5";
