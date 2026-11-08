import { fileURLToPath } from "node:url";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

/** The app build: static assets a Worker serves (no server code, no node: modules in the bundle). `$lib` is the
 * shadcn-svelte alias of components.json; `$contract` is the Preact package's `src`, imported read-only (D20: the
 * Reader/Writer contract, the fixtures, the HTTP adapters and the pure route and period modules). */
export default defineConfig({
	plugins: [tailwindcss(), svelte()],
	resolve: {
		alias: {
			$lib: fileURLToPath(new URL("./src/lib", import.meta.url)),
			$contract: fileURLToPath(new URL("../ledger-ui/src", import.meta.url)),
		},
	},
	build: { target: "es2022", sourcemap: false },
	server: { port: 5191, strictPort: true, fs: { allow: [".."] } },
	preview: { port: 5191, strictPort: true },
});
