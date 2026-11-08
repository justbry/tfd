import type { JSX } from "preact";
import { CoreIcon } from "./core-icon.tsx";

/** What a demo school shows on a tab it has no data for (`shell.tsx` `demoNoteTabs`: Promos), never an empty pane.
 * Loaded with the panes, not on the first load. */
export function DemoTabNote(): JSX.Element {
	return (
		<output class="note" data-test="demo-tab-note">
			<CoreIcon name="alert" />
			<span>
				Not available for demo schools: the demo scenarios hold no promo or gift
				events.
			</span>
		</output>
	);
}
