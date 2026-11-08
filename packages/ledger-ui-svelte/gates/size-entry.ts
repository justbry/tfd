import "../src/app.css";
import type { ConfigApi } from "../src/effect/config-client.ts";
import type { Reader } from "$contract/data/reader.ts";
import type { Writer } from "$contract/data/writer.ts";
import { mountApp } from "../src/app/mount.ts";
import { appLayer } from "../src/effect/app-layer.ts";

/** The size gate's app: every Reader, Writer and config call stays pending, so the build measures the app without any data,
 * fixture or adapter code. */
const pending = new Proxy(
	{},
	{ get: () => () => new Promise(() => undefined) },
);
const calendar = { today: "2026-11-05", now: "2026-11-05T12:00" };
const root = document.getElementById("app");
if (root)
	mountApp(root, {
		layer: appLayer({ reader: pending as Reader, writer: pending as Writer, config: pending as ConfigApi }),
		calendar,
	});
