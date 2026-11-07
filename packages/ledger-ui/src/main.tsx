import { mountApp } from "./app/mount.tsx";
import { createFixtureReader } from "./fixtures/reader.ts";
import { createFixtureWriter } from "./fixtures/writer.ts";
import { mountHttpApp } from "./http/browser.ts";

/** The fixture build: the mockup's clock, schools and an instant Writer. `VITE_LEDGER_SOURCE=http` (with
 * `VITE_API_BASE`) builds the HTTP adapters instead; in the fixture build that branch is dead and dropped. */
const clock = { today: "2026-11-05", now: "2026-11-05T12:00" };
const root = document.getElementById("app");
if (root) {
	if (import.meta.env.VITE_LEDGER_SOURCE === "http")
		mountHttpApp(root, {
			apiBase: import.meta.env.VITE_API_BASE ?? "https://api.b4uni.com",
			clock,
		});
	else
		mountApp(root, {
			reader: createFixtureReader({ clock }),
			writer: createFixtureWriter({ mode: "instant" }),
			clock,
		});
}
