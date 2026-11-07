import {
	type Audience,
	audiencesOf,
	type Disclosure,
	type ViewAs,
	type ViewAsOption,
	type Viewer,
	viewAsValues,
} from "../data/disclosure.ts";
import { notAvailable } from "./errors.ts";
import type { LedgerSchoolClaim } from "./ledger-token.ts";
import type { WorkerDisclosure, WorkerViewAsRow } from "./worker-source.ts";

/**
 * `disclosure(school)` (S8-contract section 11): the Worker sends the file, size, year, source, override, each
 * audience's `views` and each View as row's name, summary and locks (`audienceViews` and `viewAsRows` of
 * `atm/worker`). The adapter adds `viewer` and each row's `held`, `audience` and `admin` from the ledger token's
 * claim with `audiencesOf`. The ledger token carries no membership level, so until it carries a tier audience an
 * admin without the finance grant holds `public` only (D7, and the Worker serves them no finer): the adapter caps them
 * there too, so View as never offers a view the Worker refuses. No route gives the signed-in person's name, so
 * `viewer.name` is null.
 */

/** The signed-in person as the ledger token says they are at this school. */
export function viewerOf(subject: string, claim: LedgerSchoolClaim): Viewer {
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
			name: null,
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
			name: null,
			role: "admin",
			financeGrant: true,
			audience,
			audiences,
			why: "Admin with the finance grant",
			viewAs: "finance",
		};
	return {
		id: subject,
		name: null,
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
	viewer: Viewer,
	rows: Record<ViewAs, WorkerViewAsRow>,
): ViewAsOption[] {
	return viewAsValues.map((value) => {
		const isAdminRow = value === "admin";
		// The Admin row shows an admin's own audience; an owner or a finance admin previewing it sees `member`.
		const audience: Audience = isAdminRow
			? viewer.viewAs === "admin"
				? viewer.audience
				: "member"
			: value;
		const { name, summary, locks } = rows[value];
		return {
			value,
			name,
			summary,
			held: isAdminRow ? true : viewer.audiences.includes(value),
			audience,
			admin: adminRows.has(value),
			locks,
		};
	});
}

export function assembleDisclosure(
	answer: WorkerDisclosure,
	viewer: Viewer,
): Disclosure {
	const { views, viewAs } = answer;
	if (!views)
		throw notAvailable(
			"disclosure",
			"the Worker's answer has no views (a Worker older than S8c2)",
		);
	if (!viewAs)
		throw notAvailable(
			"disclosure",
			"the Worker's answer has no View as rows (a Worker older than S8e part 3)",
		);
	return {
		school: answer.school,
		year: answer.year,
		size: answer.size,
		file: answer.file,
		// No stored override is the B4 Uni defaults: an override with no differences.
		override: answer.override ?? {},
		viewer,
		views,
		viewAs: viewAsOf(viewer, viewAs),
	};
}
