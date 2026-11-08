import type {
	Audience,
	Disclosure,
	ViewAsOption,
} from "$contract/data/disclosure.ts";

/** The two parts of the contract's disclosure module (`$contract/data/disclosure.ts`) that the first page load needs: which
 * View as row the route views, and the audiences' names. The module itself, with the rule engine the Dashboard, the member
 * portal and the Settings' School books table use, is loaded on demand with them; taking these two from it would put the
 * whole module in the first load. test/s9-5/consistency.test.ts runs both over every case, so the copy cannot drift. */
export const audienceNames: Record<Audience, string> = {
	public: "Public",
	member: "Member",
	governance: "Governance",
	finance: "Finance admin",
	owner: "Owner",
};

export function resolveViewAs(
	asked: string | null,
	disclosure: Pick<Disclosure, "viewer" | "viewAs">,
): { option: ViewAsOption; preview: boolean } {
	const own = disclosure.viewAs.find(
		(option) => option.value === disclosure.viewer.viewAs,
	);
	const chosen = disclosure.viewAs.find(
		(option) => option.value === asked && option.held,
	);
	const option = chosen ?? own;
	if (!option) throw new Error("the viewer's own View as row is missing");
	return { option, preview: option.value !== disclosure.viewer.viewAs };
}
