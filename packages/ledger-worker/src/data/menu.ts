/** What the latest `catalog.published` event says about the school; null where the log has none, never a guess. */
import type { AtmEvent, Menu } from "atm";

export type SchoolMenu = {
	timeZone: string;
	/** ISO 4217, lower case. */
	currency: string;
	/** The credit unit as the school names it (its first feature's), or null. */
	unit: { one: string; other: string } | null;
	/** The plan ids in the menu's tier order. */
	tierIds: string[];
};

const isText = (value: unknown): value is string =>
	typeof value === "string" && value.length > 0;

const unitOf = (menu: Menu): SchoolMenu["unit"] => {
	const unit = (menu.features as unknown[]).find(
		(feature) => typeof feature === "object" && feature !== null,
	) as { unit?: { one?: unknown; other?: unknown } } | undefined;
	return isText(unit?.unit?.one) && isText(unit.unit.other)
		? { one: unit.unit.one, other: unit.unit.other }
		: null;
};

/** The menu of the latest `catalog.published` event (by event id) in `events`, or null when there is none or it cannot be read. */
export const latestMenu = (events: readonly AtmEvent[]): SchoolMenu | null => {
	let latest: AtmEvent | null = null;
	for (const event of events)
		if (
			event.event_type === "catalog.published" &&
			(latest === null || latest.id < event.id)
		)
			latest = event;
	const menu = latest?.payload.menu as Menu | undefined;
	if (
		menu === undefined ||
		menu === null ||
		!isText(menu.currency) ||
		!isText(menu.timeZone) ||
		!Array.isArray(menu.features) ||
		!Array.isArray(menu.tiers)
	)
		return null;
	return {
		timeZone: menu.timeZone,
		currency: menu.currency,
		unit: unitOf(menu),
		tierIds: [
			...new Set(
				menu.tiers
					.map((tier) => tier.id)
					.filter((id): id is string => isText(id)),
			),
		],
	};
};
