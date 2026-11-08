import {
	type Capabilities,
	type Member,
	type MemberDetail,
	type Person,
	previewLock,
} from "$contract/data/members.ts";
import type { PaneIconName } from "../pane-icons.ts";
import {
	type Change,
	capabilityReason,
	changeWaiting,
	pendingBookingIds,
	type RoleChange,
	roleGuard,
	standingOf,
	type Viewer,
} from "./members-model.ts";
import { releasable } from "./members-writes.ts";

/** The actions of the ⋯ menu and the drawer's buttons (the golden file's `data-action`). */
export type MenuAction =
	| "view-as-member"
	| "invoice"
	| "adjust"
	| "refund"
	| "release"
	| "switch"
	| "cancel"
	| "resume"
	| "make-admin"
	| "remove-admin"
	| "remove-owner"
	| "grant-finance"
	| "revoke-finance"
	| "csv"
	| "audit"
	| "stripe"
	| "receipt";

/** A booking button of the drawer (the golden file's `data-action`). */
export type BookingAction =
	| "confirm"
	| "noshow"
	| "release"
	| "refund"
	| "remind";

export const roleActions: Partial<Record<MenuAction, RoleChange>> = {
	"make-admin": "make",
	"remove-admin": "remove",
	"remove-owner": "remove",
	"grant-finance": "grant",
	"revoke-finance": "revoke",
};
/** What a preview leaves on: the portal link, the CSV, Stripe and the receipt (mockup `WRITE_SEL`). */
export const previewKeeps: ReadonlySet<MenuAction> = new Set([
	"view-as-member",
	"csv",
	"stripe",
	"receipt",
]);

export type MenuItem = {
	action: MenuAction;
	label: string;
	icon: PaneIconName;
	/** Why it is off, or "". */
	reason: string;
	destructive?: boolean;
	/** A hint on an item that is on. */
	hint?: string;
	/** Where an item that is a link goes (it opens in a new tab). */
	href?: string;
};

/** Everything the menu and the drawer's buttons need to know about one person. */
export type PersonContext = {
	person: Person;
	people: Person[];
	member: Member | null;
	detail: MemberDetail;
	capabilities: Capabilities;
	viewer: Viewer;
	changes: Change[];
	creditUnit: string;
	/** The person's lists could not be read: what needs them says "Not available yet", never that there is none. */
	detailUnavailable?: boolean;
};

const notAvailableYet = "Not available yet";
const noPlanReason = "No plan, so there is no member portal to view";

/** The menu's items in order, `null` between groups (mockup `kMenuHtml`, `roleMenu`). Every per-member action lives
 * here; the rows and the drawer share it. */
export function menuItems(context: PersonContext): Array<MenuItem | null> {
	const { person, member, capabilities, viewer, changes, detail } = context;
	const reasonOf = (reason: string, action: MenuAction): string =>
		viewer.preview && !previewKeeps.has(action) ? previewLock : reason;
	const item = (
		action: MenuAction,
		label: string,
		icon: PaneIconName,
		reason = "",
		extra: Partial<MenuItem> = {},
	): MenuItem => ({
		action,
		label,
		icon,
		reason: reasonOf(reason, action),
		...extra,
	});
	const financeOnly = (reason: string): string =>
		viewer.finance ? reason : "Finance only";
	const items: Array<MenuItem | null> = [
		item("view-as-member", "View as member", "eye", member ? "" : noPlanReason),
	];
	if (member) {
		const standing = standingOf(member, changes);
		const waiting = changeWaiting(changes, person.id);
		const waitReason = waiting ? "A change is already on its way" : "";
		const held = releasable(detail, person, pendingBookingIds(changes)).length;
		/** The mockup's `cx`: canceled, or ending at the period's end. Resume replaces Cancel, and Switch waits. */
		const ended = standing.canceled || standing.cancelsAtPeriodEnd;
		items.push(
			null,
			item(
				"invoice",
				"Send invoice…",
				"mail",
				financeOnly(capabilityReason(capabilities, "invoice", "menu")),
			),
			item(
				"adjust",
				`Adjust ${context.creditUnit}…`,
				"sliders",
				financeOnly(capabilityReason(capabilities, "adjustCredits", "menu")),
			),
			item(
				"refund",
				"Refund a payment…",
				"undo",
				capabilityReason(capabilities, "refund", "menu"),
			),
			item(
				"release",
				"Release a booking…",
				"unlock",
				context.detailUnavailable
					? notAvailableYet
					: held > 0
						? capabilityReason(capabilities, "releaseBooking", "menu")
						: "No held bookings to release",
			),
			item(
				"switch",
				"Switch plan…",
				"layers",
				ended
					? "Resume the membership first"
					: waitReason || capabilityReason(capabilities, "switchTier", "menu"),
			),
			ended
				? item(
						"resume",
						"Resume membership…",
						"undo",
						waitReason ||
							capabilityReason(capabilities, "cancelMembership", "menu"),
					)
				: item(
						"cancel",
						"Cancel membership…",
						"ban",
						waitReason ||
							capabilityReason(capabilities, "cancelMembership", "menu"),
						{ destructive: true },
					),
		);
	}
	const roleItem = (
		action: MenuAction,
		label: string,
		icon: PaneIconName,
		change: RoleChange,
		destructive = false,
	): MenuItem =>
		item(
			action,
			label,
			icon,
			roleGuard(capabilities, context.people, person, change),
			{ destructive },
		);
	items.push(null);
	if (person.role === "owner")
		items.push(
			roleItem("remove-owner", "Remove owner role", "ban", "remove", true),
		);
	else if (person.role === "admin")
		items.push(
			roleItem("remove-admin", "Remove admin", "ban", "remove", true),
			person.financeGrant
				? roleItem("revoke-finance", "Revoke finance", "coin", "revoke", true)
				: roleItem("grant-finance", "Grant finance", "coin", "grant"),
		);
	else items.push(roleItem("make-admin", "Make admin", "key", "make"));
	items.push(
		null,
		item(
			"csv",
			"Download CSV",
			"download",
			!viewer.finance
				? "Finance admins only"
				: member
					? context.detailUnavailable
						? notAvailableYet
						: ""
					: "No plan, so no payment history",
			{ hint: "Download this member's payment history as CSV" },
		),
	);
	if (member) {
		const { stripeDashboardUrl } = detail;
		items.push(
			null,
			item(
				"audit",
				"Audit member",
				"check",
				capabilityReason(capabilities, "audit", "menu"),
			),
			item(
				"stripe",
				"View in Stripe",
				"ext",
				context.detailUnavailable
					? notAvailableYet
					: stripeDashboardUrl === null
						? "Not on Stripe"
						: "",
				stripeDashboardUrl === null ? {} : { href: stripeDashboardUrl },
			),
			item(
				"receipt",
				"Resend receipt",
				"mail",
				capabilityReason(capabilities, "resendReceipt", "menu"),
			),
		);
	}
	return items;
}
