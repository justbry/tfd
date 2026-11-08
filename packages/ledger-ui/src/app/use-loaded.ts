import { useCallback, useEffect, useRef, useState } from "preact/hooks";

/** A read the Reader rejected leaves its part as it is, still loading: the rejection is answered here, so it is never
 * left unhandled. Only for a read whose part has something else to show (a drawer's detail, a second document); a
 * pane's own read reports its failure (`useReadFailure`, `LoadFailed`), never an empty pane. */
export const keepLoading = (): void => undefined;

/** Whether the read for the current key was rejected, with what, and how to read it again. */
export type LoadStatus = { failed: boolean; error: unknown; retry: () => void };

/** A pane's own read, where it does not use `useLoaded`: what it was rejected with for the current `key`, a handler
 * for the rejection of the read for a key, and how to read again (`attempt` changes: name it in the read's
 * dependencies). */
export function useReadFailure(key: string): LoadStatus & {
	attempt: number;
	failFor: (forKey: string) => (error: unknown) => void;
} {
	const [failure, setFailure] = useState<{
		key: string;
		error: unknown;
	} | null>(null);
	const [attempt, setAttempt] = useState(0);
	const failed = failure?.key === key;
	const failFor = useCallback(
		(forKey: string) => (error: unknown) => setFailure({ key: forKey, error }),
		[],
	);
	const retry = useCallback(() => {
		setFailure(null);
		setAttempt((before) => before + 1);
	}, []);
	return {
		failed,
		error: failed ? failure.error : null,
		attempt,
		failFor,
		retry,
	};
}

/** What `load` answers for the current `key`: null while it is on its way, and for a key that has changed since.
 * `change` swaps in a newer value for the same key, such as the list after a write the Writer has answered. `load` is
 * called again only when `key` changes, so the key must name everything `load` reads. If the read is rejected, the
 * status says so (the pane shows its error state) and `retry` reads again. */
export function useLoaded<Value>(
	key: string,
	load: () => Promise<Value>,
): [Value | null, (update: (current: Value) => Value) => void, LoadStatus] {
	const [loaded, setLoaded] = useState<{ key: string; value: Value } | null>(
		null,
	);
	const [failure, setFailure] = useState<{
		key: string;
		error: unknown;
	} | null>(null);
	const [attempt, setAttempt] = useState(0);
	const latest = useRef(load);
	latest.current = load;
	useEffect(() => {
		let current = true;
		latest.current().then(
			(value) => {
				if (current) setLoaded({ key, value });
			},
			(error: unknown) => {
				if (current) setFailure({ key, error });
			},
		);
		return () => {
			current = false;
		};
	}, [key, attempt]);
	return [
		loaded?.key === key ? loaded.value : null,
		(update) =>
			setLoaded((previous) =>
				previous?.key === key
					? { key, value: update(previous.value) }
					: previous,
			),
		{
			failed: failure?.key === key,
			error: failure?.key === key ? failure.error : null,
			retry: () => {
				setFailure(null);
				setAttempt((before) => before + 1);
			},
		},
	];
}
