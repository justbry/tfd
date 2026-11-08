/**
 * The JSON-LD contexts bundled for RDF canonicalisation. The library never fetches a context: a document naming any
 * other context is refused. Each file is the published bytes, checked when bundled on 2026-11-07:
 *
 * - credentials/v2: SHA2-256 59955ced…2734, the digest VC DM 2.0 §B.1 publishes for the base context.
 * - security/data-integrity/v2: SHA2-256 67f21e6e…e8f4, the digest VC Data Integrity 1.0 §2.4 publishes.
 * - Open Badges context-3.0.3.json: fetched from purl.imsglobal.org; 1EdTech publishes no digest. It has no @import.
 */
import credentialsV2 from "./contexts/credentials-v2.json" with {
	type: "json",
};
import dataIntegrityV2 from "./contexts/data-integrity-v2.json" with {
	type: "json",
};
import openBadges303 from "./contexts/ob-v3p0-context-3.0.3.json" with {
	type: "json",
};

export const BUNDLED_CONTEXTS: ReadonlyMap<string, unknown> = new Map<
	string,
	unknown
>([
	["https://www.w3.org/ns/credentials/v2", credentialsV2],
	["https://purl.imsglobal.org/spec/ob/v3p0/context-3.0.3.json", openBadges303],
	["https://w3id.org/security/data-integrity/v2", dataIntegrityV2],
]);
