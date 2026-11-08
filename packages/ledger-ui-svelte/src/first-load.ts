import { defaultTabOf, parseRoute, type Route } from "$contract/app/route.ts";
import type { Disclosure } from "$contract/data/disclosure.ts";
import type { Reader } from "$contract/data/reader.ts";
import type { School } from "$contract/data/types.ts";
import { isDemoSchool } from "$contract/http/demo.ts";

/** The first paint waits on the schools, the disclosure of the route's school, the route's pane module and then the
 * pane's data (the Preact package's `startFirstLoad`, src/http/browser.ts, which imports Preact and so cannot be
 * imported here; test/s9-7a compares). */

/** An early read nobody has asked for yet: its failure is the ask's, which gets this very promise (or never comes, for a
 * school the schools do not list), so it is not an unhandled rejection. */
const handedOn = (_failure: unknown): void => undefined;

/** The school a hash names before the schools are read, or null when it names none. The app falls back to the first
 * school when the named one is not listed, so this is a guess that the read of the schools settles. */
function namedSchool(hash: string): string | null {
	const [path = ""] = hash.replace(/^#\/?/, "").split("?", 1);
	const [school = ""] = path.split("/");
	return school && school !== "all" ? school : null;
}

/**
 * This starts them together rather than one after another: the schools; when `hash` names a school, its
 * disclosure, which the Reader it answers hands to the shell's first ask for that school; and `warm` for the route,
 * at once for the school the hash names and again for the route the schools settle. The Reader's first `schools()`
 * is the read begun here.
 */
export function startFirstLoad(
	reader: Reader,
	hash: string,
	warm: (route: Route) => void,
): { reader: Reader; schools: Promise<School[]> } {
	const schools = reader.schools();
	let firstSchools: Promise<School[]> | undefined = schools;
	let firstDisclosure: { school: string; answer: Promise<Disclosure> } | null =
		null;
	const school = namedSchool(hash);
	if (school) {
		const answer = reader.disclosure(school);
		// Never asked for when the schools do not list the school: its failure is then nobody's.
		answer.then(undefined, handedOn);
		firstDisclosure = { school, answer };
		warm(
			parseRoute(hash, [school], () =>
				defaultTabOf({ demo: isDemoSchool(school) }),
			),
		);
	}
	schools.then(
		(listed) =>
			warm(
				parseRoute(
					hash,
					listed.map(({ id }) => id),
					(id) => defaultTabOf(listed.find((candidate) => candidate.id === id)),
				),
			),
		// The app shows the failure: its message and Retry.
		() => undefined,
	);
	return {
		schools,
		reader: {
			...reader,
			schools: () => {
				const answer = firstSchools ?? reader.schools();
				firstSchools = undefined;
				return answer;
			},
			disclosure: (asked) => {
				const early = firstDisclosure;
				firstDisclosure = null;
				return early?.school === asked
					? early.answer
					: reader.disclosure(asked);
			},
		},
	};
}
