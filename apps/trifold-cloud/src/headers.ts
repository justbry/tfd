/**
 * Headers every answer carries. The ledger UI's CSP is set where the UI is served (M4). Only `Referrer-Policy` may be
 * set by a route first: the guest note pages send `no-referrer`, which is stricter than the default here. Every other
 * header here is always set.
 */
const ROUTE_MAY_SET = "Referrer-Policy";

const SECURITY_HEADERS: Record<string, string> = {
	"Strict-Transport-Security": "max-age=63072000; includeSubDomains",
	"X-Content-Type-Options": "nosniff",
	"Referrer-Policy": "strict-origin-when-cross-origin",
	"X-Frame-Options": "DENY",
};

export const withSecurityHeaders = (response: Response): Response => {
	const headers = new Headers(response.headers);
	for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
		if (name === ROUTE_MAY_SET && headers.has(name)) continue;
		headers.set(name, value);
	}
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers,
	});
};
