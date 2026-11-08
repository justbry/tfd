import { plugin } from "bun";

/** Lets `bun test` import Svelte components and rune modules (`.svelte`, `.svelte.ts`, and the libraries'
 * `.svelte.js`): each is compiled for the browser, as Vite's plugin does in the build, and TypeScript is stripped by
 * Bun's transpiler first. */
plugin({
	name: "svelte",
	async setup(build) {
		const { compile, compileModule } = await import("svelte/compiler");
		const transpiler = new Bun.Transpiler({ loader: "ts" });
		build.onLoad({ filter: /\.svelte$/ }, async ({ path }) => {
			const source = await Bun.file(path).text();
			const { js } = compile(source, {
				filename: path,
				generate: "client",
				dev: false,
				css: "injected",
			});
			return { contents: js.code, loader: "js" };
		});
		build.onLoad({ filter: /\.svelte\.(ts|js)$/ }, async ({ path }) => {
			const text = await Bun.file(path).text();
			const source = path.endsWith(".ts")
				? transpiler.transformSync(text)
				: text;
			const { js } = compileModule(source, {
				filename: path,
				generate: "client",
				dev: false,
			});
			return { contents: js.code, loader: "js" };
		});
	},
});
