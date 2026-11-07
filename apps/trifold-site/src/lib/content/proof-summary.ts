/**
 * The part of src/lib/content/proof.ts the homepage shows (the three-way diagram and the verticals line), kept apart so
 * the homepage doesn't ship the rest of the proof page's text. proof.ts re-exports it, so other pages import from there.
 */

/** One sample school year (growth-12mo, seed 7) through the engine, hledger and DuckDB: the same KPI hash from each. */
export const SEED_7_HASH =
	"96d0613ce7b2c30f3b45cb7ec712296e81c028087d9bf1e4359aa06b827a1f8a";
/** The hash as the diagram prints it: first eight and last four characters. */
export const SEED_7_HASH_SHORT = `${SEED_7_HASH.slice(0, 8)}…${SEED_7_HASH.slice(-4)}`;
export const SEED_7_EVENTS = 2142;

/** The one line that ties the verticals together. */
export const UNIFIED_LINE =
	"Same engine, same proof. Every vertical is a seeded scenario, and its KPI hashes match across the engine, hledger and DuckDB.";
