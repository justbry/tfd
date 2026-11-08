import type { Layer } from "effect";
import { ManagedRuntime } from "effect";
import { mount, unmount } from "svelte";
import type { Clock as CalendarClock } from "$contract/data/types.ts";
import type { AppServices } from "../effect/app-layer.ts";
import { Toasts } from "../effect/services.ts";
import App from "./App.svelte";
import type { DemoReason } from "./demo-banner/demo-banner-model.ts";
import { ToastStore } from "./toast-store.svelte.ts";

/** The demo alert the HTTP build shows while the visitor sees only the demo schools. `load` is the entry's own import of
 * the alert's component, so that a build without the entry (the fixture build) holds neither the alert nor its words. */
export type DemoBannerOptions = {
	/** Why the schools shown are the demo ones, asked after every read of the schools (Try again may find the visitor
	 * signed out after a failure); null when they are the person's own. */
	reason: () => DemoReason | null;
	signInUrl: string;
	/** "I have signed in": the token is asked again (the entry reloads the page). */
	onSignedIn: () => void;
	load: () => Promise<typeof import("./demo-banner/DemoBanner.svelte")>;
};

export type MountedApp = {
	runtime: ManagedRuntime.ManagedRuntime<AppServices, never>;
	toasts: ToastStore;
	unmount(): Promise<void>;
};

/** Mounts the ledger UI on `root` over an app layer (the fixture layer or the HTTP layer): one Effect runtime for
 * the mount, the toast store over its `Toasts` service. */
export function mountApp(
	root: HTMLElement,
	options: {
		layer: Layer.Layer<AppServices>;
		calendar: CalendarClock;
		banner?: DemoBannerOptions;
	},
): MountedApp {
	const runtime = ManagedRuntime.make(options.layer);
	const toasts = new ToastStore(
		runtime.runSync(Toasts.useSync((service) => service)),
	);
	root.classList.add("app");
	const app = mount(App, {
		target: root,
		props: {
			root,
			...(options.banner ? { banner: options.banner } : {}),
			context: { root, runtime, toasts, calendar: options.calendar },
		},
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
