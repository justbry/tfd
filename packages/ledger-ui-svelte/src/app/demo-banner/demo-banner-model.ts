/** Why the HTTP build shows the demo schools instead of the visitor's own (the Preact package's `DemoReason`, which
 * `HttpReader.session()` answers with once it is not `signed_in`). */
export type DemoReason = "signed_out" | "no_school";

/** The alert's sentence for each reason: the Preact package's `reasonText`, word for word (test/s9-7a compares). */
export const reasonText: Record<DemoReason, string> = {
	signed_out:
		"You are not signed in, so these are demo scenarios: fictional schools, read-only. Sign in to B4 Uni to see your own school's books.",
	no_school:
		"This account is not an owner or admin of any school, so these are demo scenarios: fictional schools, read-only.",
};

export const notSavedText =
	"Demo schools are read-only: nothing here can be changed.";
export const foldedText = "Demo data · Sign in";
/** What the second button says: a signed-out visitor says they signed in; an account with no school reloads. */
export const reloadLabel = (reason: DemoReason): string =>
	reason === "signed_out" ? "I have signed in" : "Reload";
