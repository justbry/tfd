import {
	type AudienceView,
	audienceNames,
	type Disclosure,
	resolveViewAs,
	type ViewAsOption,
} from "$contract/data/disclosure.ts";

/** What the route views (`as=`, resolved by the contract's `resolveViewAs`): the school's disclosure, the View as row
 * chosen and the audience view it shows. In a preview the banner shows and the periods follow the previewed audience
 * (the Preact package's viewing.ts and menus.tsx `resolveViewing`, which import Preact). */
export type Viewing = {
	disclosure: Disclosure;
	option: ViewAsOption;
	preview: boolean;
	view: AudienceView;
};

export function resolveViewing(
	disclosure: Disclosure,
	asked: string | null,
): Viewing {
	const { option, preview } = resolveViewAs(asked, disclosure);
	return {
		disclosure,
		option,
		preview,
		view: disclosure.views[option.audience],
	};
}

/** The name of the viewer's own View as row ("Owner", "Finance admin", "Admin"). */
export const ownRowName = ({ viewAs, viewer }: Disclosure): string =>
	viewAs.find(({ value }) => value === viewer.viewAs)?.name ?? "";

/** The preview banner's sentence (mockup `#vab`), after "Preview: this is what <name> sees.". */
export const previewTail = ({ disclosure, option }: Viewing): string =>
	` sees. You are ${ownRowName(disclosure)}.${
		option.value === "admin"
			? ` Their books follow their own membership: shown as ${audienceNames[option.audience]}.`
			: ""
	} Writes are off.`;
