/**
 * The URLU Institute's three certification levels as `LevelDefinition`s, so every consumer issues the same
 * achievements. The wording says "certified"; a certificate attests training and assessment by the Institute.
 */
import type { LevelDefinition } from "./credential.js";

export type UrluLevel = "Participant" | "Coach" | "Mediator";

export const URLU_ISSUER_NAME = "URLU Institute";

const DESCRIPTIONS: Record<
	UrluLevel,
	{ description: string; narrative: string }
> = {
	Participant: {
		description:
			"Certified by the URLU Institute as a Participant: completed the foundation course.",
		narrative: "Complete the URLU foundation course and its assessment.",
	},
	Coach: {
		description:
			"Certified by the URLU Institute as a Coach: completed coach training and supervised practice.",
		narrative:
			"Hold the Participant certification, complete coach training and the supervised practice hours.",
	},
	Mediator: {
		description:
			"Certified by the URLU Institute as a Mediator: completed mediator training and assessed mediations.",
		narrative:
			"Hold the Coach certification, complete mediator training and pass the assessed mediations.",
	},
};

/** The three levels, each achievement at `<achievementBaseUrl>/<level in lower case>`. */
export const urluLevels = (
	achievementBaseUrl: string,
): Record<UrluLevel, LevelDefinition> => {
	const base = achievementBaseUrl.replace(/\/+$/, "");
	const define = (level: UrluLevel): LevelDefinition => ({
		level,
		achievementId: `${base}/${level.toLowerCase()}`,
		name: `URLU Certified ${level}`,
		description: DESCRIPTIONS[level].description,
		criteria: { narrative: DESCRIPTIONS[level].narrative },
	});
	return {
		Participant: define("Participant"),
		Coach: define("Coach"),
		Mediator: define("Mediator"),
	};
};
