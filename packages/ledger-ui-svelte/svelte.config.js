import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

/** Svelte 5 in runes mode everywhere; TypeScript in components through Vite's preprocessor. */
export default {
	preprocess: vitePreprocess(),
	compilerOptions: { runes: true },
};
