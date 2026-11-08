import type { JSX } from "preact";
import type { School } from "../data/types.ts";
import { CoreIcon } from "./core-icon.tsx";
import type { PaneName } from "./panes.tsx";
import { formatRoute, type SchoolTab } from "./route.ts";

/** The panes whose data a demo school does not have: no B4 Uni school stands behind it (S8-contract section 11 "Demo
 * schools"). The member portal is the Members tab's. */
export const demoNoteTabs: ReadonlySet<PaneName> = new Set([
	"plans",
	"members",
	"portal",
	"bookings",
	"promos",
]);

const booksTabs: ReadonlyArray<{ tab: SchoolTab; label: string }> = [
	{ tab: "dashboard", label: "Dashboard" },
	{ tab: "ledger", label: "Ledger" },
	{ tab: "reports", label: "Reports" },
];

/** What a demo school shows on a tab it has no data for, with the way to the tabs it has, never an empty pane. */
export function DemoTabNote({ school }: { school: School }): JSX.Element {
	return (
		<output class="note" data-test="demo-tab-note">
			<CoreIcon name="alert" />
			<span>
				Demo schools show the books only: Dashboard, Ledger and Reports. Plans,
				Members, Bookings and Promos need a real school.
			</span>
			<span class="sp" />
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
		</output>
	);
}
