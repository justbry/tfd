import { createHash } from "node:crypto";
import type { Plugin, ViteDevServer } from "vite";

/** A pane loaded on demand brings its own Tailwind stylesheet (S9-plan section 2), compiled apart from app.css, and it
 * loads after it, so any rule it repeats (`.border-0`, `.p-0`, `.text-[12px]`…) lands later in the cascade than the
 * rules the first page load styled the shell with, and can override one of their variants (`max-[640px]:text-[11px]`, a
 * border width set beside `border-0`). The shell would then change with the first pane that loads.
 *
 * This removes from each pane's stylesheet the rules the first page load's stylesheet already has, so that the shell
 * keeps exactly its own. A rule is compared selector by selector (Tailwind writes `.a,.b{…}` where the pane writes
 * `.a{…}`), word for word, in the same at-rule (layer, media query).
 *
 * A removed rule now sits in app.css, ahead of every rule the pane keeps, so a pane rule that conflicts with it and came
 * before it in the pane would start to win. Which classes meet on one element is in the markup, not the stylesheet, so
 * nothing here tries to tell: gate K compares every pane state with the one-stylesheet build instead (guarding by
 * property, shorthand against longhand, kept the shell's repeated rules in the panes and brought the shell's
 * hazard back).
 *
 * The hash in a pane stylesheet's file name follows its deduplicated content, so that a cached file cannot outlive a
 * change of app.css. `LEDGER_SINGLE_SHEET=1` builds the reference gate K compares the panes with: one stylesheet, app.css
 * taking every source and the panes' stylesheets empty, so the cascade is Tailwind's own order.
 * Rules are compared as the minified (build) or formatted (dev) text Tailwind writes; at-rules are walked with a brace
 * matcher. */
type Statement = { prelude: string; body: string | null; text: string };

/** The statements of a stylesheet at one level: `prelude{body}` blocks and `;`-ended statements. */
export function statementsOf(css: string): Statement[] {
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
	/^@(layer|media|supports|container)\b/.test(prelude);
const withoutComments = (text: string): string =>
	text.replace(/\/\*[\s\S]*?\*\//g, "").trim();

/** The parts of `text` between top-level `separator`s (not inside brackets, parentheses, quotes or after a backslash). */
function splitTopLevel(text: string, separator: string): string[] {
	const parts: string[] = [];
	let depth = 0;
	let quote = "";
	let start = 0;
	for (let index = 0; index < text.length; index += 1) {
		const character = text[index];
		if (character === "\\") {
			index += 1;
			continue;
		}
		if (quote) {
			if (character === quote) quote = "";
			continue;
		}
		if (character === '"' || character === "'") quote = character;
		else if (character === "(" || character === "[") depth += 1;
		else if (character === ")" || character === "]") depth -= 1;
		else if (character === separator && depth === 0) {
			parts.push(text.slice(start, index));
			start = index + 1;
		}
	}
	parts.push(text.slice(start));
	return parts;
}

const selectorsOf = (prelude: string): string[] =>
	splitTopLevel(withoutComments(prelude), ",")
		.map((selector) => selector.trim())
		.filter((selector) => selector !== "");

/** Every selector of every leaf rule of a stylesheet, keyed by the at-rules around it and the declarations. */
export function knownRules(
	css: string,
	path = "",
	into = new Set<string>(),
): Set<string> {
	for (const statement of statementsOf(css)) {
		const prelude = withoutComments(statement.prelude);
		if (statement.body !== null && isGrouping(prelude))
			knownRules(statement.body, `${path}${prelude}>`, into);
		else if (statement.body !== null)
			for (const selector of selectorsOf(prelude))
				into.add(`${path}${selector}{${statement.body}}`);
		else into.add(`${path}${statement.text}`);
	}
	return into;
}

/** The pane stylesheet without the selectors `known` already has (a rule left with none goes, an at-rule left empty
 * too). */
export function dedupeCss(css: string, known: ReadonlySet<string>): string {
	const walk = (text: string, path: string): string => {
		let out = "";
		for (const statement of statementsOf(text)) {
			const prelude = withoutComments(statement.prelude);
			if (statement.body !== null && isGrouping(prelude)) {
				const inner = walk(statement.body, `${path}${prelude}>`);
				if (inner !== "") out += `${statement.prelude}{${inner}}`;
			} else if (statement.body === null) {
				if (!known.has(`${path}${statement.text}`)) out += statement.text;
			} else {
				const body = statement.body;
				const remaining = selectorsOf(prelude).filter(
					(selector) => !known.has(`${path}${selector}{${body}}`),
				);
				if (remaining.length > 0) out += `${remaining.join(",")}{${body}}`;
			}
		}
		return out;
	};
	return walk(css, "");
}

/** The stylesheet text the dev server hands the browser, inside the JS module it serves: `const __vite__css = "…"`. */
const devCssPattern = /const __vite__css = ("(?:[^"\\]|\\.)*")/;
const hashedName = /-[\w-]{8}\.css$/;

export function dedupeLazyCss(): Plugin {
	let server: ViteDevServer | undefined;
	const isPaneCss = (id: string): boolean => {
		const path = id.split("?")[0] ?? id;
		return (
			path.endsWith(".css") &&
			path.includes("/src/") &&
			!path.endsWith("/src/app.css")
		);
	};
	if (process.env.LEDGER_SINGLE_SHEET === "1")
		return {
			name: "single-sheet",
			enforce: "pre",
			transform(code, id) {
				if (isPaneCss(id)) return { code: "", map: null };
				if ((id.split("?")[0] ?? id).endsWith("/src/app.css"))
					return {
						code: code.replace(/^@source not [^;]*;\n/gm, ""),
						map: null,
					};
				return null;
			},
		};
	return {
		name: "dedupe-lazy-css",
		enforce: "post",
		configureServer(devServer) {
			server = devServer;
		},
		/** Dev: a change of app.css (or of what it imports) makes every pane stylesheet stale. */
		handleHotUpdate({ file, server: devServer }) {
			if (
				!file.endsWith("/src/app.css") &&
				!file.endsWith("/src/tailwind-shared.css")
			)
				return;
			for (const module of devServer.moduleGraph.idToModuleMap.values())
				if (isPaneCss(module.id ?? ""))
					devServer.moduleGraph.invalidateModule(module);
			devServer.ws.send({ type: "full-reload" });
			return [];
		},
		/** Build: the first page load's stylesheet is the one the entry chunk imports. The file name's hash is made from
		 * the result, and the chunks that name the file follow. */
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
				if (asset?.type === "asset")
					knownRules(String(asset.source), "", known);
			}
			for (const [file, asset] of Object.entries(bundle)) {
				if (
					asset.type !== "asset" ||
					!file.endsWith(".css") ||
					entryCss.has(file)
				)
					continue;
				const source = dedupeCss(String(asset.source), known);
				asset.source = source;
				if (!hashedName.test(file)) continue;
				const renamed = file.replace(
					hashedName,
					`-${createHash("sha256").update(source).digest("base64url").slice(0, 8)}.css`,
				);
				if (renamed === file) continue;
				delete bundle[file];
				this.emitFile({ type: "asset", fileName: renamed, source });
				for (const output of Object.values(bundle)) {
					if (output.type !== "chunk") continue;
					output.code = output.code.split(file).join(renamed);
					const imported = output.viteMetadata?.importedCss;
					if (imported?.delete(file)) imported.add(renamed);
				}
			}
		},
		/** Dev: the entry's stylesheet is `src/app.css`; every other stylesheet of the app is a pane's. */
		async transform(code, id) {
			if (!server || !isPaneCss(id)) return null;
			const lazy = devCssPattern.exec(code);
			const entry = await server.transformRequest("/src/app.css");
			const entryCss = entry ? devCssPattern.exec(entry.code) : null;
			if (!lazy?.[1] || !entryCss?.[1]) return null;
			const known = knownRules(JSON.parse(entryCss[1]) as string);
			const kept = dedupeCss(JSON.parse(lazy[1]) as string, known);
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
