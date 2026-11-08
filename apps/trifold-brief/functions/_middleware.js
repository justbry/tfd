// Password gate for every page of the Trifold brief (Cloudflare Pages Functions).
// The password is the BRIEF_PASSWORD secret on the Pages project; nothing is served without it.
const COOKIE = "trifold_brief_auth";
const SCOPE = "trifold-brief-v1";
const MAX_AGE = 60 * 60 * 24 * 14;
const WRONG_PASSWORD_DELAY_MS = 1000;
const PATHS = ["overview", "investors", "firms", "schools", "partners"];
const PAGES = new Set(["/", ...PATHS.map((name) => `/${name}/`)]);
const INDEX_SUFFIX = /\/index\.html$/;
const TRAILING_SLASH = /\/$/;

const guardHeaders = {
	"cache-control": "private, no-store",
	"x-robots-tag": "noindex",
	"referrer-policy": "no-referrer",
	"x-frame-options": "SAMEORIGIN",
	"x-content-type-options": "nosniff",
};

export async function onRequest(context) {
	const url = new URL(context.request.url);
	const path = url.pathname;

	if (path.startsWith("/.well-known/acme-challenge/")) return context.next();

	if (path === "/robots.txt") {
		return new Response("User-agent: *\nDisallow: /\n", {
			headers: {
				"content-type": "text/plain; charset=utf-8",
				"x-robots-tag": "noindex",
			},
		});
	}

	const canonical = canonicalPage(path);
	if (canonical && canonical !== path)
		return redirect(new URL(canonical, url), 302);
	if (!canonical && path !== "/login") return text("Not found.", 404);

	const expected = context.env.BRIEF_PASSWORD;
	if (!expected) return text("This page is not available.", 503);

	if (path === "/login") {
		if (context.request.method === "POST")
			return login(context.request, expected);
		if (await hasSession(context.request, expected))
			return redirect(new URL("/", url), 303);
		return html(form("", "/"), 401);
	}

	if (!(await hasSession(context.request, expected)))
		return html(form("", canonical), 401);

	const response = await context.next();
	const headers = new Headers(response.headers);
	for (const [key, value] of Object.entries(guardHeaders))
		headers.set(key, value);
	return new Response(response.body, { status: response.status, headers });
}

// "/", "/<path>/", or a near miss of one ("/investors", "/investors/index.html", "/index.html") mapped to it.
function canonicalPage(path) {
	if (PAGES.has(path)) return path;
	if (path === "/index.html") return "/";
	const trimmed = path.replace(INDEX_SUFFIX, "").replace(TRAILING_SLASH, "");
	const page = `${trimmed}/`;
	return PAGES.has(page) ? page : null;
}

async function login(request, expected) {
	let given = "";
	let next = "/";
	try {
		const data = await request.formData();
		given = String(data.get("password") ?? "");
		const wanted = String(data.get("next") ?? "/");
		if (PAGES.has(wanted)) next = wanted;
	} catch {
		given = "";
	}
	if (!(await passwordMatches(given, expected))) {
		await scheduler.wait(WRONG_PASSWORD_DELAY_MS);
		return html(form("That password is not right.", next), 401);
	}

	return new Response(null, {
		status: 303,
		headers: {
			location: next,
			"set-cookie": `${COOKIE}=${await sessionValue(expected)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${MAX_AGE}`,
			...guardHeaders,
		},
	});
}

async function hasSession(request, expected) {
	const raw = request.headers.get("cookie") ?? "";
	let value = "";
	for (const part of raw.split(";")) {
		const trimmed = part.trim();
		const eq = trimmed.indexOf("=");
		if (eq === -1) continue;
		if (trimmed.slice(0, eq) === COOKIE) value = trimmed.slice(eq + 1);
	}
	if (!value) return false;
	return equalBytes(bytes(value), bytes(await sessionValue(expected)));
}

async function passwordMatches(given, expected) {
	return equalBytes(await mac(given), await mac(expected));
}

async function sessionValue(password) {
	const signature = await mac(`${SCOPE}\n${password}`);
	let binary = "";
	for (const byte of signature) binary += String.fromCharCode(byte);
	return btoa(binary)
		.replaceAll("+", "-")
		.replaceAll("/", "_")
		.replaceAll("=", "");
}

async function mac(value) {
	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode("trifold-brief-login"),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	return new Uint8Array(
		await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)),
	);
}

function equalBytes(a, b) {
	const length = Math.max(a.length, b.length);
	let difference = a.length === b.length ? 0 : 1;
	for (let index = 0; index < length; index++)
		difference |= (a[index] ?? 0) ^ (b[index] ?? 0);
	return difference === 0;
}

function bytes(value) {
	return new TextEncoder().encode(value);
}

// `next` is always one of PAGES (checked by the callers), so it is safe to put in the page.
function form(error, next) {
	const message = error ? `<p class="err" role="alert">${error}</p>` : "";
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Trifold brief</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f6f1e7; color: #1e2a44; font: 18px/1.45 Inter, system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { width: min(22rem, calc(100% - 2.5rem)); }
  .mark { display: flex; align-items: center; gap: 0.5rem; font: 600 1.6rem/1 Georgia, "Iowan Old Style", serif; margin: 0 0 0.4rem; }
  .mark svg { width: 2rem; height: 2rem; }
  p { color: #55607a; }
  .err { color: #9a4532; font-weight: 600; }
  form { display: grid; gap: 0.8rem; }
  label { display: grid; gap: 0.35rem; color: #1e2a44; }
  input { font: inherit; padding: 0.7rem 0.8rem; border-radius: 0.5rem; border: 1px solid #b9ae98; background: #fffdf8; color: inherit; }
  input:focus-visible, button:focus-visible { outline: 3px solid #1e2a44; outline-offset: 2px; }
  button { font: inherit; font-weight: 600; padding: 0.7rem 0.8rem; border: 0; border-radius: 0.5rem; background: #1e2a44; color: #f6f1e7; cursor: pointer; }
</style>
</head>
<body>
<main>
  <p class="mark"><svg viewBox="0 0 100 100" aria-hidden="true"><g stroke="#f6f1e7" stroke-width="3" stroke-linejoin="round"><path d="M50 58.7 L50 10 L10 83 Z" fill="#e8a33d"/><path d="M50 58.7 L10 83 L90 83 Z" fill="#1e2a44"/><path d="M50 58.7 L90 83 L50 10 Z" fill="#2f7d5b"/></g></svg>Trifold</p>
  <p>Confidential brief</p>
  ${message}
  <form method="post" action="/login">
    <input type="hidden" name="next" value="${next}">
    <label for="password">Password
      <input id="password" name="password" type="password" autocomplete="current-password" required autofocus>
    </label>
    <button type="submit">Continue</button>
  </form>
</main>
</body>
</html>`;
}

function redirect(location, status) {
	return new Response(null, {
		status,
		headers: { location: location.toString(), ...guardHeaders },
	});
}

function html(body, status) {
	return new Response(body, {
		status,
		headers: { "content-type": "text/html; charset=utf-8", ...guardHeaders },
	});
}

function text(body, status) {
	return new Response(body, {
		status,
		headers: { "content-type": "text/plain; charset=utf-8", ...guardHeaders },
	});
}
