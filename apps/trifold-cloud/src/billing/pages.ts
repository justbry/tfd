import type { CloudEnv } from "../env";
import { type Org, publishedSchool, SCHOOL_OF } from "./plans";
import { SESSION_ID } from "./portal";

/**
 * The staging billing pages on the ledger host: `/billing/plans` (Starter and Audited, std/np, month/year, calling
 * `POST /v1/billing/checkout`), and Checkout's return pages `/billing/success` (with "Manage your plan", which calls
 * `POST /v1/billing/portal` with the Checkout Session id on its URL) and `/billing/cancel`. Colors and type
 * follow docs/website/brand-guide.md (ink, paper text, saffron for the act); the fonts fall back to system faces, as
 * the Worker serves no font files. Staging only: the router serves them only when ENVIRONMENT is staging.
 */

const STYLE = `
:root { --bg:#07090F; --bg-raised:#0E1424; --fg:#E9ECF4; --fg-muted:#9AA3B8; --line:#FFFFFF14; --proof:#5BE3A1; --seal:#F2B447; --alert:#E07A5F; }
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--fg); font:17px/1.55 Inter, system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width: 880px; margin: 0 auto; padding: 48px 24px 96px; }
h1 { font-family: Fraunces, Georgia, serif; font-weight: 350; font-size: clamp(36px, 6vw, 56px); line-height: 1.1; margin: 0 0 12px; }
.label { font-family: "JetBrains Mono", ui-monospace, monospace; text-transform: uppercase; letter-spacing: .12em; font-size: 12px; color: var(--fg-muted); }
.num { font-family: "JetBrains Mono", ui-monospace, monospace; font-feature-settings: "tnum"; }
.banner { border:1px solid var(--line); border-radius: 10px; padding: 10px 14px; margin: 0 0 32px; color: var(--fg-muted); font-size: 15px; }
.muted { color: var(--fg-muted); }
.toggles { display:flex; gap: 16px; flex-wrap: wrap; margin: 24px 0; }
fieldset { border:1px solid var(--line); border-radius: 10px; padding: 6px; display:flex; gap: 4px; margin:0; }
legend { padding: 0 6px; }
fieldset label { padding: 6px 12px; border-radius: 7px; cursor: pointer; }
fieldset input { position:absolute; opacity:0; }
fieldset input:checked + span { color: var(--bg); background: var(--fg); border-radius: 6px; padding: 6px 12px; margin: -6px -12px; }
fieldset input:focus-visible + span { outline: 2px solid var(--seal); outline-offset: 2px; }
.plans { display:grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 16px; }
.plan { background: var(--bg-raised); border:1px solid var(--line); border-radius: 14px; padding: 24px; display:flex; flex-direction: column; gap: 12px; }
.plan h2 { font-family: Fraunces, Georgia, serif; font-weight: 400; font-size: 28px; margin: 0; }
.price { font-size: 32px; }
button, .button { background: var(--seal); color: #07090F; border: 0; border-radius: 10px; padding: 12px 16px; font: 600 16px Inter, system-ui, sans-serif; cursor: pointer; text-decoration: none; display: inline-block; text-align: center; }
button[disabled] { opacity: .6; cursor: progress; }
input[type=email] { width: 100%; max-width: 360px; background: var(--bg-raised); color: var(--fg); border:1px solid var(--line); border-radius: 8px; padding: 10px 12px; font: inherit; }
.error { color: var(--alert); min-height: 1.5em; }
.ok { color: var(--proof); }
a { color: var(--fg); text-decoration-color: var(--line); }
`;

const SCRIPT = `
const form = document.querySelector("#plans");
const error = document.querySelector("#error");
const pick = (name) => form.querySelector('input[name="' + name + '"]:checked').value;
const show = () => {
	const org = pick("org"), interval = pick("interval");
	for (const node of document.querySelectorAll("[data-price]")) {
		const [nodeOrg, nodeInterval] = node.dataset.price.split(":");
		node.hidden = nodeOrg !== org || nodeInterval !== interval;
	}
};
form.addEventListener("change", show);
show();
form.addEventListener("submit", async (event) => {
	event.preventDefault();
	const button = event.submitter;
	error.textContent = "";
	button.disabled = true;
	const email = form.querySelector("#email").value.trim();
	try {
		const response = await fetch(form.dataset.endpoint, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ tier: button.value, interval: pick("interval"), org: pick("org"), ...(email ? { email } : {}) }),
		});
		const body = await response.json();
		if (!response.ok || !body.url) throw new Error(body.error?.message ?? "Checkout is not available right now.");
		location.assign(body.url);
	} catch (failure) {
		error.textContent = failure.message;
		button.disabled = false;
	}
});
`;

const SUCCESS_SCRIPT = `
const manage = document.querySelector("#manage");
const error = document.querySelector("#error");
manage?.addEventListener("click", async () => {
	error.textContent = "";
	manage.disabled = true;
	try {
		const response = await fetch(manage.dataset.endpoint, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ session_id: manage.dataset.session }),
		});
		const body = await response.json();
		if (!response.ok || !body.url) throw new Error(body.error?.message ?? "The billing portal is not available right now.");
		location.assign(body.url);
	} catch (failure) {
		error.textContent = failure.message;
		manage.disabled = false;
	}
});
`;

const HTML_SPECIAL = /[&<>"']/g;

const escapeHtml = (text: string): string =>
	text.replace(
		HTML_SPECIAL,
		(char) =>
			({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
				char
			] as string,
	);

const dollars = (cents: number): string =>
	`$${(cents / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

const page = (
	title: string,
	body: string,
	env: CloudEnv,
	script: string | null = null,
): Response =>
	new Response(
		`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)} · Trifold (staging)</title>
<link rel="stylesheet" href="/billing/billing.css">
</head>
<body>
<main>
<p class="banner"><span class="label">Staging · Stripe test mode</span><br>Nothing here charges a real card. Use the test card 4242 4242 4242 4242, any future date and any CVC.</p>
${body}
</main>
${script ? `<script src="${script}" type="module"></script>` : ""}
</body>
</html>
`,
		{
			headers: {
				"Content-Type": "text/html; charset=utf-8",
				"Cache-Control": "no-store",
				"Content-Security-Policy": `default-src 'none'; style-src 'self'; script-src 'self'; connect-src https://${env.API_HOST}; img-src 'self'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'`,
			},
		},
	);

const plansPage = (env: CloudEnv): Response => {
	// The tiers checkout sells: public in the menu (Starter and Audited; Pro is a draft).
	const sold =
		publishedSchool(SCHOOL_OF.std)?.menu.tiers.filter((tier) => tier.public) ??
		[];
	const cards = sold
		.map(({ id: tierId }) => {
			const prices = (["std", "np"] as Org[]).flatMap((org) => {
				const tier = publishedSchool(SCHOOL_OF[org])?.menu.tiers.find(
					(entry) => entry.id === tierId,
				);
				return (tier?.prices ?? []).map(
					(price) =>
						`<p class="price num" data-price="${org}:${price.interval}">${dollars(price.amount)}<span class="muted"> / ${price.interval}</span></p>`,
				);
			});
			const tier = publishedSchool(SCHOOL_OF.std)?.menu.tiers.find(
				(entry) => entry.id === tierId,
			);
			if (!tier) return "";
			return `<section class="plan">
<h2>${escapeHtml(tier.name)}</h2>
<p class="muted">${escapeHtml(tier.blurb)}</p>
${prices.join("\n")}
<button type="submit" value="${escapeHtml(tier.id)}">Continue to checkout</button>
</section>`;
		})
		.join("\n");
	return page(
		"Plans",
		`<p class="label">Plans</p>
<h1>Pick a plan</h1>
<form id="plans" data-endpoint="https://${escapeHtml(env.API_HOST)}/v1/billing/checkout">
<div class="toggles">
<fieldset><legend class="label">Organization</legend>
<label><input type="radio" name="org" value="std" checked><span>Standard</span></label>
<label><input type="radio" name="org" value="np"><span>Non-profit or co-op</span></label>
</fieldset>
<fieldset><legend class="label">Billing</legend>
<label><input type="radio" name="interval" value="month" checked><span>Monthly</span></label>
<label><input type="radio" name="interval" value="year"><span>Yearly</span></label>
</fieldset>
</div>
<p><label class="label" for="email">Email for the receipt (optional)</label><br><input type="email" id="email" autocomplete="email" maxlength="254"></p>
<div class="plans">
${cards}
</div>
<p class="error" id="error" role="alert"></p>
</form>`,
		env,
		"/billing/plans.js",
	);
};

const successPage = (env: CloudEnv, sessionId: string | null): Response => {
	const manage =
		sessionId && SESSION_ID.test(sessionId)
			? `<p><button type="button" id="manage" data-endpoint="https://${escapeHtml(env.API_HOST)}/v1/billing/portal" data-session="${escapeHtml(sessionId)}">Manage your plan</button></p>
<p class="error" id="error" role="alert"></p>`
			: "";
	return page(
		"Thank you",
		`<p class="label ok">✓ Checkout complete</p>
<h1>Thank you</h1>
<p>Stripe confirmed your test checkout. When Stripe sends the paid invoice, Trifold records it in its own books.</p>
${manage}
<p><a href="/billing/plans">Back to plans</a></p>`,
		env,
		manage ? "/billing/success.js" : null,
	);
};

const cancelPage = (env: CloudEnv): Response =>
	page(
		"Checkout canceled",
		`<p class="label">Checkout canceled</p>
<h1>Nothing was charged</h1>
<p>You left checkout before paying. You can pick a plan again whenever you like.</p>
<p><a class="button" href="/billing/plans">Back to plans</a></p>`,
		env,
	);

const asset = (body: string, type: string): Response =>
	new Response(body, {
		headers: { "Content-Type": type, "Cache-Control": "public, max-age=300" },
	});

/** The ledger host's billing pages, or null when the path is not one of them. */
export const billingPage = (url: URL, env: CloudEnv): Response | null => {
	switch (url.pathname) {
		case "/billing/plans":
			return plansPage(env);
		case "/billing/success":
			return successPage(env, url.searchParams.get("session_id"));
		case "/billing/cancel":
			return cancelPage(env);
		case "/billing/billing.css":
			return asset(STYLE, "text/css; charset=utf-8");
		case "/billing/plans.js":
			return asset(SCRIPT, "text/javascript; charset=utf-8");
		case "/billing/success.js":
			return asset(SUCCESS_SCRIPT, "text/javascript; charset=utf-8");
		default:
			return null;
	}
};
