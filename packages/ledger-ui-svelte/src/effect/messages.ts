import type { UiError, UiErrorDetail, UiErrorKind } from "./ui-error.ts";

/** The server codes the message table answers on their own, ahead of the kind they arrive as (S9-plan section 5). */
export const serverCodes = [
	"stale_etag",
	"invalid_config",
	"step_up_required",
	"owner_only",
	"finance_required",
	"audience_not_allowed",
	"stripe_permission_missing",
	"refund_failed",
] as const;
export type ServerCode = (typeof serverCodes)[number];

/** What a toast's button does. The toaster owns the label; the caller supplies the effect for `retry` and `reload`. */
export type MessageAction =
	| "retry"
	| "reload"
	| "confirm_identity"
	| "sign_in"
	| "enter_pin"
	| "show_problems";

export const actionLabels: Record<MessageAction, string> = {
	retry: "Retry",
	reload: "Reload",
	confirm_identity: "Confirm it is you",
	sign_in: "Sign in again",
	enter_pin: "Enter the PIN",
	show_problems: "Show the problems",
};

type Text = string | ((detail: UiErrorDetail) => string);

export type MessageEntry = {
	/** The toast's first line: what happened, in a few words. */
	title: string;
	/** Why, in one sentence. */
	what: Text;
	/** What the person can do now. */
	doThis: Text;
	action?: MessageAction;
};

/** A message ready to show: the entry with its texts filled in from the error's detail. */
export type Message = {
	title: string;
	what: string;
	doThis: string;
	action?: MessageAction;
};

const minutesAndSeconds = (seconds: number): string => {
	const whole = Math.max(0, Math.ceil(seconds));
	const minutes = Math.floor(whole / 60);
	const rest = whole % 60;
	if (minutes === 0) return `${rest} second${rest === 1 ? "" : "s"}`;
	if (rest === 0) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
	return `${minutes} min ${rest} s`;
};

const waitText = ({ retryAfterSeconds }: UiErrorDetail): string =>
	retryAfterSeconds === undefined
		? "Wait a few minutes, then try again."
		: `Wait ${minutesAndSeconds(retryAfterSeconds)}, then try again.`;

const problemCount = ({ problems }: UiErrorDetail): string => {
	const count = problems?.length ?? 0;
	if (count === 0) return "The value was refused.";
	return `${count} field${count === 1 ? " needs" : "s need"} a change.`;
};

/** One entry per adapter kind and `unexpected`: the type fails the build when the contract gains a kind this table
 * lacks. */
export const kindMessages: Record<UiErrorKind, MessageEntry> = {
	step_up: {
		title: "Confirm it is you",
		what: "This change needs a fresh confirmation from the last 10 minutes.",
		doThis: "Confirm with your PIN or the link we email you, then try again.",
		action: "confirm_identity",
	},
	pin_required: {
		title: "The books are PIN locked",
		what: "This view needs the family PIN.",
		doThis: "Enter the PIN to open it.",
		action: "enter_pin",
	},
	pin_wrong: {
		title: "That PIN is not right",
		what: "The PIN did not match.",
		doThis: "Check it and type it again.",
		action: "enter_pin",
	},
	pin_locked: {
		title: "Too many PIN tries",
		what: "The PIN is locked for now after several wrong tries.",
		doThis: waitText,
	},
	unauthenticated: {
		title: "You are signed out",
		what: "Your session ended or was never started here.",
		doThis: "Sign in again; nothing you saved is lost.",
		action: "sign_in",
	},
	forbidden: {
		title: "Not allowed",
		what: "Your role in this school does not include this.",
		doThis: "Ask the school's owner if you need it.",
	},
	not_found: {
		title: "Not found",
		what: "This item is gone or was never here.",
		doThis: "Reload to see what is there now.",
		action: "reload",
	},
	no_data: {
		title: "No data yet",
		what: "The ledger has nothing for this yet.",
		doThis: "It fills in after the first events arrive.",
	},
	conflict: {
		title: "Someone changed this",
		what: "It changed after you opened it.",
		doThis: "Reload to see the change, then make yours again.",
		action: "reload",
	},
	rate_limited: {
		title: "Too many requests",
		what: "The server asked us to slow down.",
		doThis: waitText,
		action: "retry",
	},
	bad_request: {
		title: "The request was refused",
		what: "The server could not take what was sent.",
		doThis: "Check the fields and try again.",
	},
	unavailable: {
		title: "The ledger is catching up",
		what: "Try again in a minute.",
		doThis: "Retry sends the same request again; nothing is done twice.",
		action: "retry",
	},
	server: {
		title: "The server failed",
		what: "Something went wrong on our side.",
		doThis: "Retry; if it keeps failing, tell support what you were doing.",
		action: "retry",
	},
	network: {
		title: "No connection",
		what: "The request got no answer.",
		doThis: "Check your connection, then retry.",
		action: "retry",
	},
	schema_mismatch: {
		title: "Unexpected answer",
		what: "The server answered in a shape this screen cannot show.",
		doThis: "Reload; if it stays, the app needs an update.",
		action: "reload",
	},
	read_only: {
		title: "A demo school",
		what: "This school shows sample data, so nothing you do here is saved.",
		doThis: "Sign in to change your own school.",
	},
	not_available: {
		title: "Not available yet",
		what: "Nothing provides this yet.",
		doThis: "It arrives in a later release.",
	},
	not_connected: {
		title: "Ledger not connected",
		what: "The ledger service is not connected to this page yet.",
		doThis: "Ask the owner to connect it.",
	},
	unexpected: {
		title: "Something went wrong",
		what: "An unexpected error stopped this.",
		doThis: "Reload the page; if it happens again, tell support.",
		action: "reload",
	},
};

/** The server codes that say more than their kind. */
export const codeMessages: Record<ServerCode, MessageEntry> = {
	stale_etag: {
		title: "Someone changed this. Review their change",
		what: "The saved copy changed after you started editing.",
		doThis: "Reload to see their change, then apply yours on top.",
		action: "reload",
	},
	invalid_config: {
		title: "Some fields need a change",
		what: problemCount,
		doThis: "Fix the fields marked below, then save again.",
		action: "show_problems",
	},
	step_up_required: kindMessages.step_up,
	owner_only: {
		title: "Owners only",
		what: "Only the school's owner can do this.",
		doThis: "Ask the owner to make this change.",
	},
	finance_required: {
		title: "Finance access needed",
		what: "This shows money details only finance admins and the owner see.",
		doThis: "Ask the owner for finance access.",
	},
	audience_not_allowed: {
		title: "Not shown to this audience",
		what: "The school's disclosure keeps this from the audience you are viewing as.",
		doThis: "View as yourself, or ask the owner to change the disclosure.",
	},
	stripe_permission_missing: {
		title: "Stripe permission missing",
		what: "The school's Stripe account has not given atm this permission.",
		doThis: "Reconnect Stripe from the school's settings.",
	},
	refund_failed: {
		title: "Stripe refused the refund",
		what: "Stripe did not take the refund, so nothing was refunded.",
		doThis: "Look at the payment in Stripe, then try the refund again.",
	},
};

const isServerCode = (code: string | undefined): code is ServerCode =>
	code !== undefined && (serverCodes as readonly string[]).includes(code);

const fill = (text: Text, detail: UiErrorDetail): string =>
	typeof text === "function" ? text(detail) : text;

/** The message for an error: its server code's entry when the table has one, else its kind's. */
export function messageFor(error: UiError): Message {
	const entry = isServerCode(error.detail.code)
		? codeMessages[error.detail.code]
		: kindMessages[error.kind];
	return {
		title: entry.title,
		what: fill(entry.what, error.detail),
		doThis: fill(entry.doThis, error.detail),
		...(entry.action ? { action: entry.action } : {}),
	};
}
