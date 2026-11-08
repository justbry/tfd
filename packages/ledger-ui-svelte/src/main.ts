import "./app.css";

/** The fixture build: the mockup's fixed calendar and the fixture layer. `VITE_LEDGER_SOURCE=http` (with
 * `VITE_API_BASE` and `VITE_LEDGER_WORKER_BASE`) builds the HTTP layer instead; the other branch is dead and
 * dropped. */
const calendar = { today: "2026-11-05", now: "2026-11-05T12:00" };
const root = document.getElementById("app");
if (root) {
	if (import.meta.env.VITE_LEDGER_SOURCE === "http") {
		const { mountHttpApp } = await import("./http-entry.ts");
		mountHttpApp(root, {
			apiBase: import.meta.env.VITE_API_BASE ?? "https://api.b4uni.com",
			workerBase: import.meta.env.VITE_LEDGER_WORKER_BASE ?? "/v1",
		});
	} else {
		const [{ mountApp }, { fixtureLayer }] = await Promise.all([
			import("./app/mount.ts"),
			import("./effect/layers.ts"),
		]);
		// `?config=stale|step-up` in the route's query puts the copy in the ledger in that state (gate K, the shots).
		const asked = new URLSearchParams(window.location.hash.split("?")[1]).get(
			"config",
		);
		const configScenario =
			asked === "stale" || asked === "step-up" ? asked : undefined;
		mountApp(root, {
			layer: fixtureLayer({
				calendar,
				...(configScenario ? { configScenario } : {}),
			}),
			calendar,
		});
	}
}
