import type { Layer } from "effect";
import { ManagedRuntime } from "effect";
import { mount, unmount } from "svelte";
import type { Clock as CalendarClock } from "$contract/data/types.ts";
import type { AppServices } from "../effect/layers.ts";
import { Toasts } from "../effect/services.ts";
import App from "./App.svelte";
import { ToastStore } from "./toast-store.svelte.ts";

export type MountedApp = {
	runtime: ManagedRuntime.ManagedRuntime<AppServices, never>;
	toasts: ToastStore;
	unmount(): Promise<void>;
};

/** Mounts the ledger UI on `root` over an app layer (the fixture layer or the HTTP layer): one Effect runtime for
 * the mount, the toast store over its `Toasts` service. */
export function mountApp(
	root: HTMLElement,
	options: { layer: Layer.Layer<AppServices>; calendar: CalendarClock },
): MountedApp {
	const runtime = ManagedRuntime.make(options.layer);
	const toasts = new ToastStore(
		runtime.runSync(Toasts.useSync((service) => service)),
	);
	root.classList.add("app");
	const app = mount(App, {
		target: root,
		props: { root, context: { runtime, toasts, calendar: options.calendar } },
	});
	return {
		runtime,
		toasts,
		unmount: async () => {
			await unmount(app);
			toasts.close();
			await runtime.dispose();
			root.classList.remove("app");
			root.removeAttribute("data-route");
			document.documentElement.classList.remove("light", "dark", "system");
		},
	};
}
