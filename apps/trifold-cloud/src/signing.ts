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
export const loadSigningKeys = async (env: CloudEnv) => {
	const load = async (secret: CloudEnv["SIGNING_RECEIPT"]) =>
		importSigningKey(await secret.get());
	const [receipt, seal, directory] = await Promise.all([
		load(env.SIGNING_RECEIPT),
		load(env.SIGNING_SEAL),
		load(env.SIGNING_DIRECTORY),
	]);
	return { receipt, seal, directory };
};
