import type { JSX } from "preact";
import { useState } from "preact/hooks";

/** Why the HTTP build shows the demo schools instead of the visitor's own. */
export type DemoReason = "signed_out" | "no_school";

const reasonText: Record<DemoReason, string> = {
	signed_out:
		"You are not signed in, so these are demo scenarios: fictional schools, read-only. Sign in to B4 Uni to see your own school's books.",
	no_school:
		"This account is not an owner or admin of any school, so these are demo scenarios: fictional schools, read-only.",
};

/**
 * The large alert pinned to the top right while the HTTP build shows only the demo schools (the ledger Worker's demo
 * scenarios: fictional schools and people). It says they are demo scenarios and read-only, and links to B4 Uni's sign-in page;
 * B4 Uni cannot send a visitor back to the ledger after signing in, so "I have signed in" reloads the page. It folds to a
 * small pill so it never hides the controls under it for good.
 */
export function DemoBanner({
	reason,
	signInUrl,
	reload,
}: {
	reason: DemoReason;
	signInUrl: string;
	reload: () => void;
}): JSX.Element {
	const [folded, setFolded] = useState(false);
	const frame =
		"position:fixed;top:12px;right:12px;z-index:1000;background:var(--popover);color:var(--foreground);border:2px solid var(--warning);border-radius:var(--radius);box-shadow:0 8px 24px rgba(0,0,0,.18);font-family:var(--font-sans)";
	if (folded)
		return (
			<button
				type="button"
				class="btn s"
				data-test="demo-banner-folded"
				style={`${frame};padding:6px 12px;font-weight:600`}
				onClick={() => setFolded(false)}
			>
				Demo data · Sign in
			</button>
		);
	return (
		<aside
			role="alert"
			aria-label="Demo data"
			data-test="demo-banner"
			style={`${frame};width:min(380px,calc(100vw - 24px));padding:16px 18px`}
		>
			<div style="display:flex;align-items:center;gap:8px">
				<strong style="font-size:17px;color:var(--warning)">Demo data</strong>
				<span style="flex:1" />
				<button
					type="button"
					class="btn s"
					aria-label="Fold the demo alert"
					onClick={() => setFolded(true)}
				>
					Hide
				</button>
			</div>
			<p style="margin:8px 0 4px;font-size:14px;line-height:1.45">
				{reasonText[reason]}
			</p>
			<p
				style="margin:0 0 12px;font-size:13px;color:var(--muted-foreground)"
				data-test="demo-banner-not-saved"
			>
				Demo schools are read-only: nothing here can be changed.
			</p>
			<div style="display:flex;gap:8px;flex-wrap:wrap">
				{reason === "signed_out" && (
					<a
						class="btn p"
						href={signInUrl}
						data-test="sign-in"
						style="font-size:15px;padding:8px 16px"
					>
						Sign in
					</a>
				)}
				<button type="button" class="btn" onClick={reload}>
					{reason === "signed_out" ? "I have signed in" : "Reload"}
				</button>
			</div>
		</aside>
	);
}
