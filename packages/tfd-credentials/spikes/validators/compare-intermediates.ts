/**
 * Interop spike: compare the 1EdTech validator's eddsa-rdfc-2022 intermediate values (reported when a proof fails)
 * with tfd-credentials' own canonical N-Quads and hashData for the same document and proof, byte for byte.
 *
 *   bun compare-intermediates.ts <credentials dir> <1edtech results dir>
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { concatBytes, sha256Bytes, toHex, utf8 } from "../../src/bytes.js";
import { BUNDLED_CONTEXTS, rdfcCanonicalize } from "../../src/rdfc.js";

const [credentialsDir, resultsDir] = process.argv.slice(2);
if (credentialsDir === undefined || resultsDir === undefined) {
	console.error(
		"usage: bun compare-intermediates.ts <credentials dir> <results dir>",
	);
	process.exit(2);
}

type Intermediate = {
	canonicalizedJsonLdObjectWithoutProof: string;
	canonicalizedLdProofWithoutProofValues: string;
	canonicalizationResult: string;
	ldProofWithoutProofValues: string;
};

for (const file of readdirSync(resultsDir).filter(
	(name) => name.endsWith(".json") && name !== "summary.json",
)) {
	const report = JSON.parse(readFileSync(join(resultsDir, file), "utf8")) as {
		objects?: { intermediateValues?: Intermediate }[];
	};
	const theirs = report.objects?.[0]?.intermediateValues;
	if (theirs === undefined) continue;
	const credential = JSON.parse(
		readFileSync(join(credentialsDir, file), "utf8"),
	) as Record<string, unknown>;
	const { proof: proofMember, ...unsecured } = credential;
	const theirProof = JSON.parse(theirs.ldProofWithoutProofValues) as Record<
		string,
		unknown
	>;
	const proofs = (
		Array.isArray(proofMember) ? proofMember : [proofMember]
	) as Record<string, unknown>[];
	const proof = proofs.find(
		(candidate) =>
			candidate.cryptosuite === theirProof.cryptosuite &&
			candidate.verificationMethod === theirProof.verificationMethod,
	);
	if (proof === undefined) {
		console.log(`${file}: their proof is not one of ours?`);
		continue;
	}
	const { proofValue: _proofValue, ...proofOptions } = proof;
	let document: string;
	let config: string;
	try {
		document = await rdfcCanonicalize(unsecured, BUNDLED_CONTEXTS);
		config = await rdfcCanonicalize(
			{ ...proofOptions, "@context": unsecured["@context"] },
			BUNDLED_CONTEXTS,
		);
	} catch (error) {
		console.log(
			`${file}: ours cannot canonicalise (${error instanceof Error ? error.message.slice(0, 120) : error})`,
		);
		continue;
	}
	const hashData = toHex(
		concatBytes(sha256Bytes(utf8(config)), sha256Bytes(utf8(document))),
	);
	const same = (label: string, ours: string, other: string): string =>
		ours === other ? `${label}=same` : `${label}=DIFFERENT`;
	console.log(
		`${file.padEnd(40)} cryptosuite=${String(theirProof.cryptosuite)} ${same("document", document, theirs.canonicalizedJsonLdObjectWithoutProof)} ${same("proofConfig", config, theirs.canonicalizedLdProofWithoutProofValues)} ${same("hashData", hashData, theirs.canonicalizationResult)}`,
	);
}
