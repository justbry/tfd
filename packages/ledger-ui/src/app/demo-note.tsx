import type { JSX } from "preact";
import { CoreIcon } from "./core-icon.tsx";
import { Icon } from "./icon.tsx";

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

/** Shown where a demo school's write controls would be (S8-contract section 11: a demo school refuses every write
 * with `demo_read_only`), so it offers nothing that would only be refused. */
export function DemoReadOnlyNote(): JSX.Element {
	return (
		<span class="mut" data-test="demo-read-only">
			<Icon name="lock" /> Demo school: read-only
		</span>
	);
}
