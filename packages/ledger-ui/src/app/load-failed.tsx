import type { JSX } from "preact";
import { CoreIcon } from "./core-icon.tsx";

/** The Reader's `not_available` (`http/errors.ts`): nothing provides this read yet, so trying again cannot help. */
const isNotAvailable = (error: unknown): boolean =>
	typeof error === "object" &&
	error !== null &&
	"kind" in error &&
	error.kind === "not_available";

/** A pane whose read the Reader rejected: it says what it could not load and offers to read again, or, when nothing
 * provides the read (`not_available`), says so and offers nothing. Never an empty pane. */
export function LoadFailed({
	what,
	onRetry,
	error,
}: {
	/** "the ledger". */
	what: string;
	onRetry: () => void;
	/** The rejection, when the pane has it. */
	error?: unknown;
}): JSX.Element {
	if (isNotAvailable(error))
		return (
			<output class="note" data-test="not-available">
				<CoreIcon name="info" />
				<span>Not available yet: nothing provides {what} here.</span>
			</output>
		);
	return (
		<div class="note" role="alert">
			<CoreIcon name="alert" />
			<span>Could not load {what}.</span>
			<span class="sp" />
			<button type="button" class="btn s" onClick={onRetry}>
				Try again
			</button>
		</div>
	);
}
