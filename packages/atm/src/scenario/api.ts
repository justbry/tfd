/**
 * The scenario generator as a package subpath (`atm/scenarios`): a named preset to the events a school's shipper would
 * have written. For tests that need a realistic log (the ledger Worker's harness, `packages/ledger-worker`).
 */

export { type BundleLog, bundleLog } from "./bundle-events.js";
export { generateScenario } from "./generate.js";
export { PROFILE_NAMES, resolveScenario } from "./profiles.js";
