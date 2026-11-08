/**
 * Interop spike: a static HTTPS server for the fixture site (did:web documents, status lists, the context copy).
 *
 *   bun serve.ts <site dir> <cert.pem> <key.pem> [port=8443]
 *
 * Every file is served as `application/json` (status lists and did.json alike); anything else is a 404. Requests are
 * logged so a run shows exactly what each verifier fetched.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, normalize } from "node:path";

const [siteDir, certPath, keyPath, portArgument = "8443"] =
	process.argv.slice(2);
if (siteDir === undefined || certPath === undefined || keyPath === undefined) {
	console.error("usage: bun serve.ts <site dir> <cert.pem> <key.pem> [port]");
	process.exit(2);
}

Bun.serve({
	port: Number(portArgument),
	hostname: "0.0.0.0",
	tls: { cert: readFileSync(certPath), key: readFileSync(keyPath) },
	fetch(request) {
		const { pathname } = new URL(request.url);
		const path = normalize(join(siteDir, decodeURIComponent(pathname)));
		const found =
			path.startsWith(normalize(siteDir)) &&
			existsSync(path) &&
			statSync(path).isFile();
		console.log(
			`${new Date().toISOString()} ${request.method} ${pathname} ${found ? 200 : 404} ua=${request.headers.get("user-agent") ?? "-"}`,
		);
		if (!found) return new Response("not found", { status: 404 });
		return new Response(readFileSync(path), {
			headers: { "content-type": "application/json" },
		});
	},
});
console.log(`serving ${siteDir} on https://0.0.0.0:${portArgument}`);
