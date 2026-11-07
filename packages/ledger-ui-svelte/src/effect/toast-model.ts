/** The toast queue's state, as pure functions (S9-plan section 5): the `Toasts` service keeps it in a `Ref`, the
 * Svelte rune store mirrors it, and the tests drive it directly. */

export type ToastTone = "error" | "warning" | "success" | "info";

export type ToastAction = {
	label: string;
	run: () => void;
};

export type ToastInput = {
	tone: ToastTone;
	title: string;
	/** The second line. Two toasts with the same title and detail are one toast with a count. */
	detail?: string;
	/** What the person can do now (the message table's `doThis`). */
	doThis?: string;
	action?: ToastAction;
	/** Stays until dismissed or updated whatever its tone (a retry in progress). */
	sticky?: boolean;
};

export type ToastPatch = Partial<ToastInput>;

export type Toast = ToastInput & {
	id: string;
	/** How many identical messages this toast stands for. */
	count: number;
};

export type ToastState = {
	visible: readonly Toast[];
	/** Waiting for a visible toast to leave, oldest first. */
	waiting: readonly Toast[];
	nextNumber: number;
};

export const maximumVisible = 4;
export const autoDismissMilliseconds = 5000;

export const emptyToastState: ToastState = {
	visible: [],
	waiting: [],
	nextNumber: 1,
};

/** Errors and warnings stay until dismissed; success and info leave on their own unless sticky. */
export const staysUntilDismissed = (toast: ToastInput): boolean =>
	toast.sticky === true || toast.tone === "error" || toast.tone === "warning";

const sameMessage = (toast: Toast, input: ToastInput): boolean =>
	toast.title === input.title &&
	(toast.detail ?? "") === (input.detail ?? "") &&
	toast.tone === input.tone;

export type Added = {
	state: ToastState;
	id: string;
	/** The toast it joined, when it merged into one already there. */
	merged: boolean;
	/** It is on screen now (not waiting). */
	shown: boolean;
};

/** Adds a toast: merges it into an identical one (visible or waiting) with a count, else shows it, or queues it when
 * four are on screen. A merged toast takes the newer action. */
export function addToast(state: ToastState, input: ToastInput): Added {
	const bump = (toast: Toast): Toast =>
		sameMessage(toast, input)
			? {
					...toast,
					count: toast.count + 1,
					...(input.action ? { action: input.action } : {}),
				}
			: toast;
	const shownMatch = state.visible.find((toast) => sameMessage(toast, input));
	if (shownMatch)
		return {
			state: { ...state, visible: state.visible.map(bump) },
			id: shownMatch.id,
			merged: true,
			shown: true,
		};
	const waitingMatch = state.waiting.find((toast) => sameMessage(toast, input));
	if (waitingMatch)
		return {
			state: { ...state, waiting: state.waiting.map(bump) },
			id: waitingMatch.id,
			merged: true,
			shown: false,
		};
	const toast: Toast = { ...input, id: `toast-${state.nextNumber}`, count: 1 };
	const nextNumber = state.nextNumber + 1;
	if (state.visible.length < maximumVisible)
		return {
			state: { ...state, visible: [...state.visible, toast], nextNumber },
			id: toast.id,
			merged: false,
			shown: true,
		};
	return {
		state: { ...state, waiting: [...state.waiting, toast], nextNumber },
		id: toast.id,
		merged: false,
		shown: false,
	};
}

export type Dismissed = {
	state: ToastState;
	/** The waiting toasts that came on screen. */
	promoted: readonly Toast[];
};

/** Removes a toast wherever it is; waiting toasts fill the free places in order. */
export function dismissToast(state: ToastState, id: string): Dismissed {
	const visible = state.visible.filter((toast) => toast.id !== id);
	const waiting = state.waiting.filter((toast) => toast.id !== id);
	const free = Math.max(0, maximumVisible - visible.length);
	const promoted = waiting.slice(0, free);
	return {
		state: {
			...state,
			visible: [...visible, ...promoted],
			waiting: waiting.slice(promoted.length),
		},
		promoted,
	};
}

/** Changes a toast in place (a retry counting up, a failure becoming final). */
export function updateToast(
	state: ToastState,
	id: string,
	patch: ToastPatch,
): ToastState {
	const change = (toast: Toast): Toast =>
		toast.id === id ? { ...toast, ...patch } : toast;
	return {
		...state,
		visible: state.visible.map(change),
		waiting: state.waiting.map(change),
	};
}

export const findToast = (state: ToastState, id: string): Toast | undefined =>
	state.visible.find((toast) => toast.id === id) ??
	state.waiting.find((toast) => toast.id === id);
