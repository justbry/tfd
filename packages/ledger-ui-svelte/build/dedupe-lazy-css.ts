import type { Plugin, ViteDevServer } from "vite";

/** A pane loaded on demand brings its own Tailwind stylesheet (S9-plan section 2), compiled apart from app.css, and it
 * loads after it, so any rule it repeats (`.border-0`, `.p-0`, `.text-[12px]`…) lands later in the cascade than the
 * rules the first page load styled the shell with, and can override one of their variants (`max-[640px]:text-[11px]`, a
 * border width set beside `border-0`). The shell would then change with the first pane that loads.
 *
 * This removes from each pane's stylesheet every rule the first page load's stylesheet already has, word for word, in
 * the same at-rule (layer, media query): the shell keeps exactly the rules it had, and a pane keeps only the rules that
 * are its own. Rules are compared as minified text; at-rules are walked with a brace matcher (the stylesheets are
 * Vite's minified output). It runs on the build, and on the dev server, which injects each stylesheet as a module of its own. */
type Statement = { prelude: string; body: string | null; text: string };

/** The statements of a stylesheet at one level: `prelude{body}` blocks and `;`-ended statements. */
function statementsOf(css: string): Statement[] {
	const statements: Statement[] = [];
	let depth = 0;
	let start = 0;
	let openAt = -1;
	let quote = "";
	for (let index = 0; index < css.length; index += 1) {
		const character = css[index];
		// An escaped character (`\'` in a class selector) opens and closes nothing.
		if (character === "\\") {
			index += 1;
			continue;
		}
		if (quote) {
			if (character === quote) quote = "";
			continue;
		}
		if (character === '"' || character === "'") quote = character;
		else if (character === "{") {
			if (depth === 0) openAt = index;
			depth += 1;
		} else if (character === "}") {
			depth -= 1;
			if (depth === 0) {
				statements.push({
					prelude: css.slice(start, openAt),
					body: css.slice(openAt + 1, index),
					text: css.slice(start, index + 1),
				});
				start = index + 1;
			}
		} else if (character === ";" && depth === 0) {
			statements.push({
				prelude: css.slice(start, index),
				body: null,
				text: css.slice(start, index + 1),
			});
			start = index + 1;
		}
	}
	return statements;
}

const isGrouping = (prelude: string): boolean =>
	/^@(layer|media|supports|container)\b/.test(prelude.trim());

/** Every leaf rule of a stylesheet, keyed by the at-rules around it. */
function collect(css: string, path: string, into: Set<string>): void {
	for (const statement of statementsOf(css)) {
		if (statement.body !== null && isGrouping(statement.prelude))
			collect(statement.body, `${path}${statement.prelude.trim()}>`, into);
		else into.add(`${path}${statement.text}`);
	}
}

/** The stylesheet without the leaf rules in `known`; a block left empty goes too. */
function without(
	css: string,
	path: string,
	known: ReadonlySet<string>,
): string {
	let kept = "";
	for (const statement of statementsOf(css)) {
		if (statement.body !== null && isGrouping(statement.prelude)) {
			const inner = without(
				statement.body,
				`${path}${statement.prelude.trim()}>`,
				known,
			);
			if (inner !== "") kept += `${statement.prelude}{${inner}}`;
		} else if (!known.has(`${path}${statement.text}`)) kept += statement.text;
	}
	return kept;
}

/** The stylesheet text the dev server hands the browser, inside the JS module it serves: `const __vite__css = "…"`. */
const devCssPattern = /const __vite__css = ("(?:[^"\\]|\\.)*")/;

export function dedupeLazyCss(): Plugin {
	let server: ViteDevServer | undefined;
	return {
		name: "dedupe-lazy-css",
		enforce: "post",
		configureServer(devServer) {
			server = devServer;
		},
		/** Build: the first page load's stylesheet is the one the entry chunk imports. */
		generateBundle(_options, bundle) {
			const entryCss = new Set<string>();
			for (const output of Object.values(bundle))
				if (output.type === "chunk" && output.isEntry)
					for (const file of output.viteMetadata?.importedCss ?? [])
						entryCss.add(file);
			if (entryCss.size === 0) return;
			const known = new Set<string>();
			for (const file of entryCss) {
				const asset = bundle[file];
				if (asset?.type === "asset") collect(String(asset.source), "", known);
			}
			for (const [file, asset] of Object.entries(bundle))
				if (
					asset.type === "asset" &&
					file.endsWith(".css") &&
					!entryCss.has(file)
				)
					asset.source = without(String(asset.source), "", known);
		},
		/** Dev: the entry's stylesheet is `src/app.css`; every other stylesheet of the app is a pane's. */
		async transform(code, id) {
			const path = id.split("?")[0] ?? id;
			if (
				!server ||
				!path.endsWith(".css") ||
				!path.includes("/src/") ||
				path.endsWith("/src/app.css")
			)
				return null;
			const lazy = devCssPattern.exec(code);
			const entry = await server.transformRequest("/src/app.css");
			const entryCss = entry ? devCssPattern.exec(entry.code) : null;
			if (!lazy?.[1] || !entryCss?.[1]) return null;
			const known = new Set<string>();
			collect(JSON.parse(entryCss[1]) as string, "", known);
			const kept = without(JSON.parse(lazy[1]) as string, "", known);
			return {
				code: code.replace(
					devCssPattern,
					() => `const __vite__css = ${JSON.stringify(kept)}`,
				),
				map: null,
			};
		},
	};
}
