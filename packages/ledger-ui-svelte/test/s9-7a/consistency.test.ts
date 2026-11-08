import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { demoReadOnlyText } from "$contract/http/demo.ts";
import {
	foldedText,
	notSavedText,
	reasonText,
	reloadLabel,
} from "../../src/app/demo-banner/demo-banner-model.ts";

/** Consistency check C for the demo mode: the alert's words and hooks, the demo notes and the first load are copies of
 * the Preact package's (`src/http/demo-banner.tsx`, `demo-note.tsx`, `browser.ts`: they import Preact and so cannot be
 * imported into the Svelte build). The Preact files are read as text, so that the copies cannot drift. */
const packages = join(import.meta.dir, "../../..");
const source = (path: string): string =>
	readFileSync(join(packages, path), "utf8");
const preactBanner = source("ledger-ui/src/http/demo-banner.tsx");
const preactNotes = source("ledger-ui/src/app/demo-note.tsx");
const preactBrowser = source("ledger-ui/src/http/browser.ts");
const svelteBanner = source(
	"ledger-ui-svelte/src/app/demo-banner/DemoBanner.svelte",
);
const flat = (text: string): string => text.replace(/\s+/g, " ");

describe("the alert says what the Preact one says", () => {
	test("each sentence, word for word", () => {
		for (const text of [...Object.values(reasonText), notSavedText, foldedText])
			expect(flat(preactBanner)).toContain(text.replace("·", "·"));
		expect(flat(preactBanner)).toContain(
			`{reason === "signed_out" ? "${reloadLabel("signed_out")}" : "${reloadLabel("no_school")}"}`,
		);
	});

	test("the roles, labels and hooks the tests and the staging check read", () => {
		for (const hook of [
			'role="alert"',
			'aria-label="Demo data"',
			'data-test="demo-banner"',
			'data-test="demo-banner-folded"',
			'data-test="demo-banner-not-saved"',
			'data-test="sign-in"',
			'aria-label="Fold the demo alert"',
		]) {
			expect(preactBanner).toContain(hook);
			// `role="alert"` is the Alert component's own.
			if (hook !== 'role="alert"') expect(svelteBanner).toContain(hook);
		}
		expect(flat(svelteBanner)).toContain(">Hide</Button");
		expect(flat(preactBanner)).toContain("> Hide </button>");
		expect(
			source("ledger-ui-svelte/src/lib/components/ui/alert/alert.svelte"),
		).toContain('role="alert"');
	});

	test("the sign-in link goes where the Preact entry sends it", () => {
		// The template's own text, built so that it is not a template literal in a string.
		const signInTemplate = ["`$", "{options.webBase}/signin`"].join("");
		expect(preactBrowser).toContain(signInTemplate);
		expect(source("ledger-ui-svelte/src/http-entry.ts")).toContain(
			signInTemplate,
		);
		expect(source("ledger-ui/src/main.tsx")).toContain(
			'webBase: import.meta.env.VITE_WEB_BASE ?? "https://b4uni.com"',
		);
		expect(source("ledger-ui-svelte/src/main.ts")).toContain(
			'webBase: import.meta.env.VITE_WEB_BASE ?? "https://b4uni.com"',
		);
	});
});

describe("the notes", () => {
	test("the read-only note and the Promos note", () => {
		expect(demoReadOnlyText).toBe("Demo school: read-only");
		expect(
			source("ledger-ui-svelte/src/app/DemoReadOnlyNote.svelte"),
		).toContain('data-test="demo-read-only"');
		expect(preactNotes).toContain('data-test="demo-read-only"');
		const note = flat(preactNotes);
		const mine = flat(source("ledger-ui-svelte/src/app/DemoTabNote.svelte"));
		const sentence =
			"Not available for demo schools: the demo scenarios hold no promo or gift events.";
		expect(note).toContain(sentence);
		expect(mine).toContain(sentence);
		expect(note).toContain('data-test="demo-tab-note"');
		expect(mine).toContain('data-test="demo-tab-note"');
	});
});

/** The lines of a function's source that are code: no comment, no blank line. */
const codeLines = (text: string): string[] =>
	text
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line && !/^(\/\/|\/\*|\*)/.test(line));
const functionSource = (text: string, start: string, end: string): string => {
	const from = text.indexOf(start);
	return text.slice(from, text.indexOf(end, from));
};
const linesOnlyIn = (from: string[], other: string[]): string[] => {
	const rest = [...other];
	return from.filter((line) => {
		const index = rest.indexOf(line);
		if (index < 0) return true;
		rest.splice(index, 1);
		return false;
	});
};

describe("the first load is the Preact one", () => {
	const mine = codeLines(
		functionSource(
			source("ledger-ui-svelte/src/first-load.ts"),
			"function namedSchool",
			"\n}\n\n/**\n * This starts",
		) +
			"\n}\n" +
			functionSource(
				source("ledger-ui-svelte/src/first-load.ts"),
				"export function startFirstLoad",
				"\n}\n",
			),
	);
	const theirs = codeLines(
		functionSource(
			preactBrowser,
			"function namedSchool",
			"\n}\n\n/**\n * The first paint",
		) +
			"\n}\n" +
			functionSource(
				preactBrowser,
				"export function startFirstLoad",
				"\n}\n\n/**\n * The HTTP build",
			),
	);
	test("startFirstLoad and namedSchool differ only where documented", () => {
		expect({
			mine: linesOnlyIn(mine, theirs).sort(),
			preact: linesOnlyIn(theirs, mine).sort(),
		}).toEqual({
			mine: [
				'return school && school !== "all" ? school : null;',
				"warm: (route: Route) => void,",
				"answer.then(undefined, handedOn);",
			].sort(),
			preact: [
				"return school && school !== allSchools ? school : null;",
				"warm: (route: Route) => void = warmUp,",
				// Written in two pieces: the hygiene test reads a silent catch in any file, this one included.
				["answer.catch(", "() => undefined);"].join(""),
			].sort(),
		});
		expect(mine.length).toBeGreaterThan(30);
	});
});

describe("the entry mounts as the Preact one does", () => {
	test("the calendar is the first school's wall time; the alert follows the session after every read of the schools (the Preact entry decides once, at mount)", () => {
		const mineEntry = flat(source("ledger-ui-svelte/src/http-entry.ts"));
		for (const piece of [
			"schools[0]?.timeZone",
			"timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone",
			"const session = services.reader.session();",
			'return session === "signed_in" ? null : session;',
		])
			expect(mineEntry).toContain(piece);
		const preact = flat(preactBrowser);
		expect(preact).toContain("schools[0]?.timeZone");
		expect(preact).toContain(
			'session !== "signed_in" && timeZone !== undefined',
		);
		expect(preact).toContain(
			"timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone",
		);
	});
});
