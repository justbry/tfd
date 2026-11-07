import type { JSX } from "preact";
import { useState } from "preact/hooks";
import type { BooksUnlock } from "../data/ledger.ts";
import { Icon } from "./icon.tsx";

const pinDigits = 4;

/** What the prompt says under the field when the server does not open the books. */
const refusalText: Record<
	Extract<BooksUnlock, { unlocked: false }>["reason"],
	string
> = {
	pin_wrong: "That is not your family PIN. Try again.",
	pin_locked:
		"Too many tries. Your PIN is locked for a while; try again later.",
};
const failedText = "Could not check your PIN. Try again.";

/** The PIN prompt (mockup `bkLock`): Unlock opens once 4 digits are typed and sends the PIN to the server
 * (`Writer.unlockBooks`); the books open only when it answers unlocked, else the prompt says why. The fixtures check no
 * PIN. The books panes show it from governance up when the route says `pin=locked`. */
export function PinLock({
	levelName,
	unlock,
	onUnlocked,
}: {
	levelName: string;
	unlock: (pin: string) => Promise<BooksUnlock>;
	onUnlocked: () => void;
}): JSX.Element {
	const [pin, setPin] = useState("");
	const [checking, setChecking] = useState(false);
	const [problem, setProblem] = useState<string | null>(null);
	const submit = async () => {
		setChecking(true);
		setProblem(null);
		try {
			const answer = await unlock(pin);
			if (answer.unlocked) {
				setChecking(false);
				onUnlocked();
				return;
			}
			setProblem(refusalText[answer.reason]);
			setPin("");
		} catch {
			setProblem(failedText);
		}
		setChecking(false);
	};
	return (
		<div class="klock" data-test="pin-lock">
			<Icon name="lock" />
			<h4>Enter your PIN to see books</h4>
			<div class="mut">
				{levelName} opens the books with your family PIN. Nothing is shown until
				you unlock.
			</div>
			<div class="fld">
				<label>
					Your family PIN
					<input
						class="bpin"
						type="password"
						inputMode="numeric"
						maxLength={6}
						autoComplete="off"
						aria-label="Your family PIN"
						data-test="pin-input"
						value={pin}
						onInput={(event) => setPin(event.currentTarget.value)}
					/>
				</label>
			</div>
			{problem ? (
				<div class="err" data-test="pin-problem" role="alert">
					{problem}
				</div>
			) : null}
			<button
				type="button"
				class="btn p"
				data-test="pin-unlock"
				disabled={checking || pin.length < pinDigits}
				onClick={submit}
			>
				<Icon name="unlock" />
				Unlock
			</button>
		</div>
	);
}
