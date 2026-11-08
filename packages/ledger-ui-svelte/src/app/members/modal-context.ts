import type {
	InvoiceItem,
	Member,
	MemberBooking,
	MemberDetail,
	SwitchTier,
} from "$contract/data/members.ts";
import type { UiError } from "../../effect/ui-error.ts";
import type { Applied, Change, RoleChange } from "./members-model.ts";
import type { WriteContext } from "./members-writes.ts";

/** What the Members tab can ask the person's modal for. */
export type Action =
	| { kind: "role"; change: RoleChange }
	| { kind: "adjust" | "invoice" | "switch" | "cancel" | "resume" | "audit" }
	/** The release picker: the person's releasable bookings. */
	| { kind: "pick" }
	/** `bookingId`: the payment of that booking is the one offered first. */
	| { kind: "refund"; bookingId: string | null }
	| { kind: "release" | "noshow"; bookingId: string };

/** Everything a modal reads and the ways it ends. A list the modal needs that could not be read is the error
 * itself (`invoiceItems`, `switchTiers`): the modal says so, in the message table's words, rather than offer an empty
 * choice. The write context has no Writer: the modal's submit runs it through the Effect layer, which supplies it. */
export type ModalContext = {
	write: Omit<WriteContext, "writer">;
	member: Member | null;
	detail: MemberDetail;
	changes: Change[];
	currency: string;
	invoiceItems: InvoiceItem[] | UiError;
	switchTiers: SwitchTier[] | UiError;
	/** Whether the booking is inside its cutoff (the server says so, in the person's attention). */
	insideCutoff: (booking: MemberBooking) => boolean;
	/** A finished write hands its effect to the tab (which closes the modal and shows the toast). */
	onDone: (applied: Applied) => void;
	onCancel: () => void;
};
