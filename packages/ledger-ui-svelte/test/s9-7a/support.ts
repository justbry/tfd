import { flushSync } from "svelte";
import { schoolId } from "../../../ledger-ui/test/s8e/helpers.ts";
import {
	ledgerTokenAnswer,
	refusal,
	schoolFactsAnswer,
} from "../../../ledger-ui/test/s8e/recorded.ts";
import { mountHttpApp } from "../../src/http-entry.ts";
import { query, until } from "../app-harness.ts";

export const apiBase = "https://api-staging.b4uni.com";
export const workerBase = "https://ledger-staging.b4uni.com/v1";
export const webBase = "https://staging.b4uni.com";
export const demoId = "demo-monthly-members";
export const demoRow = {
	id: demoId,
	asOf: "2026-11-05T12:00:00Z",
	lagMinutes: 3,
	stale: false,
	demo: true,
	name: "Demo · Monthly members",
	timeZone: "America/Denver",
	currency: "USD",
	creditUnit: { one: "class", other: "classes" },
};

/** What the page's two backends say: buzz-school's ledger token (a status and a body) and the ledger Worker's list of
 * schools (rows for a request with no bearer, `null` for a Worker that serves no demo school: production). */
export type Backends = {
	token: { status: number; body: unknown };
	/** The Worker's demo rows, for the anonymous request. */
	demoRows: unknown[] | null;
	/** The Worker's rows for a request with a bearer. */
	ownRows?: unknown[];
};

export type Seen = { url: string; bearer: string | null };

const originalFetch = globalThis.fetch;
/** Puts the page's own fetch back (the app keeps asking the global one, so a Retry after the mount still reaches the
 * page's backends until a test ends). */
export const restoreFetch = (): void => {
	globalThis.fetch = originalFetch;
};

const answer = (body: unknown, status = 200): Response =>
	new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});

/** A fetch for the page: records every request, answers the token as `token`, the school list as the rows, and
 * every other read as a 404 `no_data` (the panes then show their own message; these tests look at the shell). */
export function backends(options: Backends) {
	const seen: Seen[] = [];
	const fetch = async (url: string, init: RequestInit = {}) => {
		const bearer =
			(init.headers as Record<string, string> | undefined)?.authorization ??
			null;
		seen.push({ url, bearer });
		if (url.startsWith(workerBase)) {
			if (url === `${workerBase}/schools`)
				return bearer === null && options.demoRows === null
					? answer(
							{
								error: {
									code: "token_missing",
									message: "A bearer is required.",
								},
							},
							401,
						)
					: answer({
							asOf: null,
							lagMinutes: null,
							data: {
								schools:
									bearer === null ? options.demoRows : (options.ownRows ?? []),
							},
						});
			return answer({ error: { code: "no_data", message: "none" } }, 404);
		}
		if (url.endsWith("/school-admin/ledger-token"))
			return answer(options.token.body, options.token.status);
		if (url.endsWith("/ledger/school")) return answer(schoolFactsAnswer);
		return answer({ error: "not_found" }, 404);
	};
	return { seen, fetch };
}

export const signedOut = (rows: unknown[] | null = [demoRow]): Backends => ({
	token: { status: 401, body: refusal("unauthenticated") },
	demoRows: rows,
});
export const noSchool = (rows: unknown[] | null = [demoRow]): Backends => ({
	token: { status: 404, body: refusal("not_found") },
	demoRows: rows,
});
export const signedIn = (): Backends => ({
	token: { status: 200, body: ledgerTokenAnswer() },
	demoRows: [demoRow],
	ownRows: [],
});
export { schoolId };

/** The HTTP build mounted on a fresh page over `options`' backends; resolves once the route is on screen (or the
 * app's message is). `reloads` counts what "I have signed in" asked for. */
export async function openHttp(
	options: Backends,
	hash = "",
	expect: "route" | "failure" = "route",
) {
	const page = backends(options);
	globalThis.fetch = page.fetch as unknown as typeof fetch;
	document.body.innerHTML = '<div id="app"></div>';
	document.documentElement.className = "";
	window.history.replaceState(null, "", `/${hash}`);
	const root = document.getElementById("app") as HTMLElement;
	const reloads = { count: 0 };
	const app = await mountHttpApp(root, {
		apiBase,
		workerBase,
		webBase,
		reload: () => {
			reloads.count += 1;
		},
	});
	await until(
		() =>
			expect === "route"
				? root.dataset.route !== undefined
				: query("[data-test=load-failed]") !== null,
		expect === "route" ? "the route to render" : "the failure message",
	);
	flushSync();
	return {
		root,
		app,
		seen: page.seen,
		reloads,
	};
}
