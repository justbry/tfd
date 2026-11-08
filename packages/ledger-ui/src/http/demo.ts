import type {
	Capabilities,
	Capability,
	CapabilityAction,
} from "../data/members.ts";
import { AdapterError, notAvailable } from "./errors.ts";
import { capabilityActions } from "./school-routes.ts";

/**
 * Demo schools (owner decision 2026-11-08; the ledger Worker's `src/demo.ts`, S8-contract section 11 "Demo schools"):
 * on staging, the golden school scenarios are `demo-<preset>` schools anyone may read, signed in or not. Their figures
 * come from the Worker alone: buzz-school knows no such school, so the HTTP adapters never ask it about one, and every
 * write on one is refused before a request. Real school ids are UUIDs, so the prefix cannot meet one.
 */
const demoSchoolPattern = /^demo-[a-z0-9-]+$/;

export const isDemoSchool = (school: string): boolean =>
	demoSchoolPattern.test(school);

export const demoReadOnlyText = "Demo school: read-only";

/** Any write on a demo school, before a request. */
export const demoReadOnly = (call: string): AdapterError =>
	new AdapterError(
		"read_only",
		`${demoReadOnlyText}. ${call} changes nothing here.`,
		{ code: "demo_read_only" },
	);

/** A buzz-school read for a demo school: buzz-school has no data for it. */
export const demoNotAvailable = (call: string): AdapterError =>
	notAvailable(
		call,
		"a demo school has no B4 Uni school data; only the ledger's figures are shown",
	);

const refused: Capability = { allowed: false, reason: "demo" };

/** What the menus may do on a demo school: nothing, each with the demo reason. */
export const demoCapabilities = (): Capabilities => ({
	role: "owner",
	stripeConnected: false,
	actions: Object.fromEntries(
		capabilityActions.map((action) => [action, refused]),
	) as Record<CapabilityAction, Capability>,
});
