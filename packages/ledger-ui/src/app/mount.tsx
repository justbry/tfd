import "../theme.css";
import { type ComponentChild, type JSX, render } from "preact";
import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useState,
} from "preact/hooks";
import type { Reader } from "../data/reader.ts";
import type { Clock, School } from "../data/types.ts";
import type { Writer } from "../data/writer.ts";
import { LoadFailed } from "./load-failed.tsx";
import {
	defaultTabOf,
	formatRoute,
	parseRoute,
	type Route,
	themeOf,
} from "./route.ts";
import { Shell } from "./shell.tsx";

/** Follows `location.hash`; once the schools are loaded, rewrites a hash naming an unknown school or tab to the
 * route it shows. The shell records the rendered hash in `root.dataset.route` once the route's data is on screen
 * (protocol §3). */
function App({
	root,
	reader,
	writer,
	clock,
	signInUrl,
	banner,
}: {
	root: HTMLElement;
	reader: Reader;
	writer: Writer;
	clock: Clock;
	signInUrl: string | undefined;
	banner: ComponentChild;
}): JSX.Element | null {
	const [hash, setHash] = useState(window.location.hash);
	const [schools, setSchools] = useState<School[] | null>(null);
	/** Why the schools did not load: the Reader's error kind (`unauthenticated`, `not_found`, …), or `failed`. */
	const [schoolsFailure, setSchoolsFailure] = useState<string | null>(null);
	const [schoolsAttempt, setSchoolsAttempt] = useState(0);
	useLayoutEffect(() => {
		const onHashChange = (): void => setHash(window.location.hash);
		window.addEventListener("hashchange", onHashChange);
		return () => window.removeEventListener("hashchange", onHashChange);
	}, []);
	/** Writes the route's hash and takes it at once, rather than on the `hashchange` the write queues, so that what the
	 * click chose is on screen when the click returns. */
	const navigate = useCallback((route: Route): void => {
		window.location.hash = formatRoute(route);
		setHash(window.location.hash);
	}, []);
	useEffect(() => {
		// `schoolsAttempt` is the Try again counter: each press reads the schools again.
		void schoolsAttempt;
		setSchoolsFailure(null);
		reader.schools().then(setSchools, (error: unknown) => {
			const kind =
				typeof error === "object" && error !== null && "kind" in error
					? String((error as { kind: unknown }).kind)
					: "failed";
			setSchoolsFailure(kind);
		});
	}, [reader, schoolsAttempt]);

	/** Before the schools load the route's school is a placeholder; only its query (the theme) is used then. */
	const route = parseRoute(
		hash,
		schools?.map((school) => school.id) ?? [],
		(schoolId) => defaultTabOf(schools?.find(({ id }) => id === schoolId)),
	);
	const canonical = schools ? formatRoute(route) : null;
	const theme = themeOf(route.query);
	useLayoutEffect(() => {
		root.classList.toggle("light", theme === "light");
		root.classList.toggle("dark", theme === "dark");
	}, [root, theme]);
	useLayoutEffect(() => {
		if (canonical === null || canonical === hash) return;
		window.history.replaceState(null, "", canonical);
		setHash(canonical);
	}, [hash, canonical]);

	if (!schools && schoolsFailure !== null)
		return (
			<SchoolsFailure
				kind={schoolsFailure}
				signInUrl={signInUrl}
				onRetry={() => setSchoolsAttempt((attempt) => attempt + 1)}
			/>
		);
	if (!schools) return null;
	return (
		<>
			{banner}
			<Shell
				route={route}
				schools={schools}
				clock={clock}
				reader={reader}
				writer={writer}
				navigate={navigate}
				onRendered={() => {
					root.dataset.route = hash;
				}}
			/>
		</>
	);
}

/** What the app shows when it cannot list the schools: a signed-out visitor is sent to sign in (the session cookie of
 * B4 Uni is what the ledger token is minted from), a person with no school is told so, and any other failure offers to
 * read again. Never a blank page. */
function SchoolsFailure({
	kind,
	signInUrl,
	onRetry,
}: {
	kind: string;
	signInUrl: string | undefined;
	onRetry: () => void;
}): JSX.Element {
	if (kind === "unauthenticated")
		return (
			<div class="note" role="alert" data-test="signed-out">
				<span>
					You are not signed in. Sign in to B4 Uni, then come back to this page.
				</span>
				<span class="sp" />
				{signInUrl && (
					<a class="btn s" href={signInUrl} data-test="sign-in">
						Sign in
					</a>
				)}
				<button type="button" class="btn s" onClick={onRetry}>
					Try again
				</button>
			</div>
		);
	if (kind === "not_found")
		return (
			<div class="note" role="alert" data-test="no-schools">
				<span>
					This account is not an owner or admin of any school on B4 Uni.
				</span>
			</div>
		);
	return <LoadFailed what="your schools" onRetry={onRetry} />;
}

/** Mounts the ledger UI on `root` (protocol §3). `theme=light|dark` puts that class on `root`, as the mockup puts it on
 * `.app`. */
export function mountApp(
	root: HTMLElement,
	options: {
		reader: Reader;
		writer: Writer;
		clock: Clock;
		/** Where a signed-out visitor signs in (the HTTP build); the fixture build is never signed out. */
		signInUrl?: string;
		/** Drawn above the app: the HTTP build's demo alert when it shows the demo schools. */
		banner?: ComponentChild;
	},
): { unmount(): void } {
	root.classList.add("app");
	render(
		<App
			root={root}
			reader={options.reader}
			writer={options.writer}
			clock={options.clock}
			signInUrl={options.signInUrl}
			banner={options.banner}
		/>,
		root,
	);
	return {
		unmount() {
			render(null, root);
			root.classList.remove("app", "light", "dark");
			root.removeAttribute("data-route");
		},
	};
}
