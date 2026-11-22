/**
 * Headers every answer carries. The ledger UI's CSP is set where the UI is served (M4). A header a route set itself
 * stays: the guest note pages send `Referrer-Policy: no-referrer`, which is stricter than the default here.
 */
const SECURITY_HEADERS: Record<string, string> = {
	"Strict-Transport-Security": "max-age=63072000; includeSubDomains",
	"X-Content-Type-Options": "nosniff",
	"Referrer-Policy": "strict-origin-when-cross-origin",
	"X-Frame-Options": "DENY",
};

export const withSecurityHeaders = (response: Response): Response => {
	const headers = new Headers(response.headers);
	for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
		if (!headers.has(name)) headers.set(name, value);
	}
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers,
	});
};
