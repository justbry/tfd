import {
	type Audience,
	type AudienceView,
	audiencesOf,
	type Disclosure,
	type ViewAs,
	type ViewAsOption,
	type Viewer,
	viewAsValues,
} from "../data/disclosure.ts";
import { notAvailable } from "./errors.ts";
import type { LedgerSchoolClaim } from "./ledger-token.ts";
import type { WorkerDisclosure } from "./worker-source.ts";

/**
 * `disclosure(school)` (S8-contract section 11): the Worker sends the file, size, year, source and override; the
 * adapter adds `viewer` and `viewAs` from the ledger token's claim with `audiencesOf`. The ledger token carries no
 * membership level, so until it carries a tier audience an admin without the finance grant holds `public` only
 * (D7, and the Worker serves them no finer): the adapter caps them there too, so View as never offers a view the
 * Worker refuses.
 *
 * `views` (each audience's periods, presets and copy) and each View as row's name, summary and locks are worked out
 * by the server in the contract, and the viewer's display name comes from the roster: no route or Worker endpoint
 * gives any of them yet, so they come from a `DisclosurePresentationSource`, whose part-1 default is not available.
 */

export type ViewAsCopy = Pick<ViewAsOption, "name" | "summary" | "locks">;

export type DisclosurePresentation = {
	viewerName: string;
	views: Record<Audience, AudienceView>;
	rows: Record<ViewAs, ViewAsCopy>;
};

export type DisclosurePresentationSource = {
	presentation(query: {
		school: string;
		disclosure: WorkerDisclosure;
		viewer: Omit<Viewer, "name">;
	}): Promise<DisclosurePresentation>;
};

export const noDisclosurePresentation: DisclosurePresentationSource = {
	presentation: async () => {
		throw notAvailable(
			"disclosure",
			"no source gives the audience views, the View as copy or the viewer's name (S8-contract section 11 sends the file only; buzz-school build list groups 4 and 8)",
		);
	},
};

/** The signed-in person as the ledger token says they are at this school. */
export function viewerOf(
	subject: string,
	claim: LedgerSchoolClaim,
): Omit<Viewer, "name"> {
	const audiences = audiencesOf({
		role: claim.role,
		financeGrant: claim.role === "admin" && claim.finance,
		adult: true,
		// The token carries no tier audience: an admin without the grant stays at public (section 11's cap).
		liveTierAudiences: [],
	});
	const audience = audiences[audiences.length - 1] ?? "public";
	if (claim.role === "owner")
		return {
			id: subject,
			role: "owner",
			financeGrant: false,
			audience,
			audiences,
			why: "Owner on the roster",
			viewAs: "owner",
		};
	if (claim.finance)
		return {
			id: subject,
			role: "admin",
			financeGrant: true,
			audience,
			audiences,
			why: "Admin with the finance grant",
			viewAs: "finance",
		};
	return {
		id: subject,
		role: "admin",
		financeGrant: false,
		audience,
		audiences,
		why: "Admin without the finance grant: the ledger reads them at Public until their token carries a tier audience",
		viewAs: "admin",
	};
}

const adminRows: ReadonlySet<ViewAs> = new Set(["owner", "finance", "admin"]);

export function viewAsOf(
	viewer: Omit<Viewer, "name">,
	rows: Record<ViewAs, ViewAsCopy>,
): ViewAsOption[] {
	return viewAsValues.map((value) => {
		const isAdminRow = value === "admin";
		// The Admin row shows an admin's own audience; an owner or a finance admin previewing it sees `member`.
		const audience: Audience = isAdminRow
			? viewer.viewAs === "admin"
				? viewer.audience
				: "member"
			: value;
		return {
			value,
			...rows[value],
			held: isAdminRow ? true : viewer.audiences.includes(value),
			audience,
			admin: adminRows.has(value),
		};
	});
}

export function assembleDisclosure(
	answer: WorkerDisclosure,
	viewer: Omit<Viewer, "name">,
	presentation: DisclosurePresentation,
): Disclosure {
	return {
		school: answer.school,
		year: answer.year,
		size: answer.size,
		file: answer.file,
		// No stored override is the B4 Uni defaults: an override with no differences.
		override: answer.override ?? {},
		viewer: { ...viewer, name: presentation.viewerName },
		views: presentation.views,
		viewAs: viewAsOf(viewer, presentation.rows),
	};
}
