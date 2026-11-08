import { mountApp } from "./app/mount.tsx";
import { createFixtureReader } from "./fixtures/reader.ts";
import { createFixtureWriter } from "./fixtures/writer.ts";
import { mountHttpApp } from "./http/browser.ts";

/** The fixture build: the mockup's fixed clock, schools and an instant Writer. `VITE_LEDGER_SOURCE=http` (with
 * `VITE_API_BASE` and `VITE_LEDGER_WORKER_BASE`) builds the HTTP adapters instead, on the clock of the mount (`mountHttpApp`); in the fixture build
 * that branch is dead and dropped. */
const clock = { today: "2026-11-05", now: "2026-11-05T12:00" };
const root = document.getElementById("app");
if (root) {
	if (import.meta.env.VITE_LEDGER_SOURCE === "http")
		mountHttpApp(root, {
			apiBase: import.meta.env.VITE_API_BASE ?? "https://api.b4uni.com",
			// The Worker serves the UI and /v1 from one origin (S8-contract section 11).
			workerBase: import.meta.env.VITE_LEDGER_WORKER_BASE ?? "/v1",
			webBase: import.meta.env.VITE_WEB_BASE ?? "https://b4uni.com",
		});
	else
		mountApp(root, {
			reader: createFixtureReader({ clock }),
			writer: createFixtureWriter({ mode: "instant" }),
			clock,
		});
}
