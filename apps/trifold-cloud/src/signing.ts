import type { CloudEnv } from "./env";

const PEM_BODY =
	/-----BEGIN PRIVATE KEY-----([\s\S]+?)-----END PRIVATE KEY-----/;

/** Imports an Ed25519 private key from its PKCS8 PEM. Throws when the PEM is missing, malformed or not Ed25519. */
export const importSigningKey = async (pem: string): Promise<CryptoKey> => {
	const body = PEM_BODY.exec(pem)?.[1];
	if (!body) throw new Error("not a PKCS8 PEM");
	const der = Uint8Array.from(atob(body.replace(/\s+/g, "")), (char) =>
		char.charCodeAt(0),
	);
	return crypto.subtle.importKey("pkcs8", der, { name: "Ed25519" }, false, [
		"sign",
	]);
};

/** The three signing keys of this environment (PLAN.md section 3.5), loaded from Secrets Store. */
export const loadSigningKeys = async (env: CloudEnv) => ({
	receipt: await importSigningKey(await env.SIGNING_RECEIPT.get()),
	seal: await importSigningKey(await env.SIGNING_SEAL.get()),
	directory: await importSigningKey(await env.SIGNING_DIRECTORY.get()),
});
