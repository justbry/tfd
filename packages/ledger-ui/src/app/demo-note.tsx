import type { JSX } from "preact";
import type { School } from "../data/types.ts";
import { CoreIcon } from "./core-icon.tsx";
import { formatRoute, type SchoolTab } from "./route.ts";

const booksTabs: ReadonlyArray<{ tab: SchoolTab; label: string }> = [
	{ tab: "dashboard", label: "Dashboard" },
	{ tab: "ledger", label: "Ledger" },
	{ tab: "reports", label: "Reports" },
];

/** What a demo school shows on a tab it has no data for (`shell.tsx` `demoNoteTabs`), with the way to the tabs it
 * has, never an empty pane. The links sit on their own line under the text, at its left: the HTTP build's demo alert
 * (`http/demo-banner.tsx`) is pinned top right and would cover them at the note's right end. Loaded with the panes,
 * not on the first load. */
export function DemoTabNote({ school }: { school: School }): JSX.Element {
	return (
		<output
			class="note"
			data-test="demo-tab-note"
			style="align-items:flex-start"
		>
			<CoreIcon name="alert" />
			<div>
				<span>
					Demo schools show the books only: Dashboard, Ledger and Reports.
					Plans, Members, Bookings and Promos need a real school.
				</span>
				<div
					data-test="demo-tab-links"
					style="display:flex;gap:8px;margin-top:8px"
				>
					{booksTabs.map(({ tab, label }) => (
						<a
							key={tab}
							class="btn s"
							data-test="demo-tab-link"
							href={formatRoute({
								schoolId: school.id,
								tab,
								query: new URLSearchParams(),
							})}
						>
							{label}
						</a>
					))}
				</div>
			</div>
		</output>
	);
}
