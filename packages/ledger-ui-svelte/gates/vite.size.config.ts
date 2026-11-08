import { mergeConfig } from "vite";
import appConfig from "../vite.config.ts";

/** The size gate's build: the app mounted with null adapters, no fixtures (protocol §6 S). */
export default mergeConfig(appConfig, {
	build: {
		outDir: "dist-size",
		manifest: true,
		emptyOutDir: true,
		rollupOptions: { input: "gates/size-entry.html" },
	},
});
