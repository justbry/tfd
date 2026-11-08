import type { Booking, BookingState } from "../data/bookings.ts";
import type {
	Capabilities,
	Capability,
	CapabilityAction,
	FinanceGrant,
	InvoiceItem,
	Member,
	MemberBalance,
	MembershipStatus,
	MembersPage,
	SwitchTier,
} from "../data/members.ts";
import type {
	Menu,
	MenuAddon,
	MenuGrant,
	MenuTier,
	MenuVersion,
	MenuVersionBody,
	MenuVersions,
} from "../data/plans.ts";
import { schemaMismatch } from "./errors.ts";
import {
	arrayOf,
	booleanOf,
	nullableNumberOf,
	nullableStringOf,
	numberOf,
	oneOf,
	recordOf,
	stringOf,
	type WireRecord,
} from "./wire.ts";

/**
 * buzz-school's ledger routes (read-only source: buzz-school `origin/main` 0af6e42cd), their paths and the mapping of
 * each answer onto the UI contract in `src/data/`. A mapping copies what the route says and nothing else: a field the
 * contract needs and the route does not send is a `schema_mismatch` naming it, never a made-up value or a 0.
 */

export const schoolPath = (school: string): string =>
	`/school-admin/schools/${encodeURIComponent(school)}`;
export const routes = {
	school: (school: string) => `${schoolPath(school)}/ledger/school`,
	capabilities: (school: string) => `${schoolPath(school)}/ledger/capabilities`,
	members: (school: string) => `${schoolPath(school)}/billing/members-list`,
	menuVersions: (school: string) =>
		`${schoolPath(school)}/billing/menu/versions`,
	menuVersion: (school: string, version: number) =>
		`${schoolPath(school)}/billing/menu/versions/${version}`,
	menu: (school: string) => `${schoolPath(school)}/billing/menu`,
	publish: (school: string) => `${schoolPath(school)}/billing/menu/publish`,
	stripeKey: (school: string) => `${schoolPath(school)}/billing/stripe-key`,
	stripeKeyRemove: (school: string) =>
		`${schoolPath(school)}/billing/stripe-key/remove`,
	bookings: (school: string) => `${schoolPath(school)}/bookings`,
	outcome: (school: string, booking: string) =>
		`${schoolPath(school)}/bookings/${encodeURIComponent(booking)}/outcome`,
	cancel: (school: string, booking: string) =>
		`${schoolPath(school)}/bookings/${encodeURIComponent(booking)}/cancel`,
	financeGrants: (school: string) => `${schoolPath(school)}/finance-grants`,
	financeGrantsRemove: (school: string) =>
		`${schoolPath(school)}/finance-grants/remove`,
	refunds: (school: string) => `${schoolPath(school)}/billing/refunds`,
	adjust: (school: string) => `${schoolPath(school)}/billing/credits/adjust`,
	invoices: (school: string) => `${schoolPath(school)}/billing/invoices`,
	keyCreate: "/school-admin/key-create",
	keyRevoke: "/school-admin/key-revoke",
	pinVerify: "/family/pin/verify",
} as const;

// ---- GET .../ledger/school (routes/ledger-school.ts)

export type SchoolFacts = {
	school: string;
	name: string;
	timeZone: string | null;
	currency: string | null;
	creditUnit: { one: string; other: string } | null;
};

const unitOf = (route: string, value: unknown, path: string) => {
	const unit = recordOf(route, value, path);
	return {
		one: stringOf(route, unit.one, `${path}.one`),
		other: stringOf(route, unit.other, `${path}.other`),
	};
};

export function schoolFactsOf(answer: unknown): SchoolFacts {
	const route = "GET .../ledger/school";
	const body = recordOf(route, answer, "answer");
	return {
		school: stringOf(route, body.school, "school"),
		name: stringOf(route, body.name, "name"),
		timeZone: nullableStringOf(route, body.timeZone, "timeZone"),
		currency: nullableStringOf(route, body.currency, "currency"),
		creditUnit:
			body.creditUnit === null
				? null
				: unitOf(route, body.creditUnit, "creditUnit"),
	};
}

// ---- GET .../bookings (routes/ledger-admin.ts bookingsOf)

const wallTimeFormats = new Map<string, Intl.DateTimeFormat>();
/** Unix seconds as `YYYY-MM-DDTHH:MM` in `timeZone`: the contract's local wall time. */
export function localWallTime(seconds: number, timeZone: string): string {
	let format = wallTimeFormats.get(timeZone);
	if (!format) {
		format = new Intl.DateTimeFormat("en-CA", {
			timeZone,
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
			hour: "2-digit",
			minute: "2-digit",
			hourCycle: "h23",
		});
		wallTimeFormats.set(timeZone, format);
	}
	const parts: Record<string, string> = {};
	for (const part of format.formatToParts(new Date(seconds * 1000)))
		parts[part.type] = part.value;
	return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

const listedStates: readonly BookingState[] = ["requested", "confirmed"];

export type BookingsWirePage = {
	timeZone: string;
	rows: WireRecord[];
	nextCursor: string | null;
};

export function bookingsPageOf(answer: unknown): BookingsWirePage {
	const route = "GET .../bookings";
	const body = recordOf(route, answer, "answer");
	return {
		timeZone: stringOf(route, body.timeZone, "timeZone"),
		rows: arrayOf(route, body.bookings, "bookings").map((row, index) =>
			recordOf(route, row, `bookings[${index}]`),
		),
		nextCursor: nullableStringOf(route, body.nextCursor, "nextCursor"),
	};
}

/** One booking, or null for one the list does not hold (cancelled or any state but requested and confirmed). A row
 * without `attendance` is a mismatch, since null would claim that no outcome was recorded. `cutoffMinutes` is null
 * where the answer has none (a demo school's: no event names a cutoff). `seriesLabel` and `billing` are left out (no
 * source). */
export function bookingOf(
	row: WireRecord,
	timeZone: string,
	index: number,
): Booking | null {
	const route = "GET .../bookings";
	const path = `bookings[${index}]`;
	const state = stringOf(route, row.state, `${path}.state`);
	if (!(listedStates as readonly string[]).includes(state)) return null;
	if (!("attendance" in row))
		throw schemaMismatch(
			route,
			`${path}.attendance is missing (the route does not join attendanceFor)`,
		);
	const attendance =
		row.attendance === null
			? null
			: oneOf(route, row.attendance, `${path}.attendance`, [
					"attended",
					"no_show",
				] as const);
	let attendee: Booking["attendee"] = null;
	if (row.attendee !== null) {
		const wire = recordOf(route, row.attendee, `${path}.attendee`);
		if (wire.key === null)
			throw schemaMismatch(
				route,
				`${path}.attendee.key is null (an attendee whose profile row is gone)`,
			);
		attendee = {
			key: stringOf(route, wire.key, `${path}.attendee.key`),
			name: stringOf(route, wire.name, `${path}.attendee.name`),
		};
	}
	return {
		id: stringOf(route, row.id, `${path}.id`),
		eventId: stringOf(route, row.eventId, `${path}.eventId`),
		service: stringOf(route, row.service, `${path}.service`),
		startsAt: localWallTime(
			numberOf(route, row.startsAt, `${path}.startsAt`),
			timeZone,
		),
		endsAt: localWallTime(
			numberOf(route, row.endsAt, `${path}.endsAt`),
			timeZone,
		),
		hosts: arrayOf(route, row.hosts, `${path}.hosts`).map(
			(value, hostIndex) => {
				const host = recordOf(route, value, `${path}.hosts[${hostIndex}]`);
				return {
					id: stringOf(route, host.id, `${path}.hosts[${hostIndex}].id`),
					name: stringOf(route, host.name, `${path}.hosts[${hostIndex}].name`),
				};
			},
		),
		attendee,
		guest: booleanOf(route, row.guest, `${path}.guest`),
		state: state as BookingState,
		cutoffMinutes: nullableNumberOf(
			route,
			row.cutoffMinutes,
			`${path}.cutoffMinutes`,
		),
		seriesId: nullableStringOf(route, row.seriesId, `${path}.seriesId`),
		attendance,
	};
}

// ---- GET .../billing/menu/versions[/<n>] (routes/ledger-admin.ts versionsOf; school-billing/menu.ts MenuSchema)

const versionOf = (
	route: string,
	value: unknown,
	path: string,
): MenuVersion => {
	const row = recordOf(route, value, path);
	return {
		version: numberOf(route, row.version, `${path}.version`),
		publishedAt: nullableNumberOf(
			route,
			row.publishedAt,
			`${path}.publishedAt`,
		),
		savedAt: numberOf(route, row.savedAt, `${path}.savedAt`),
	};
};

export function menuVersionsOf(answer: unknown): MenuVersions {
	const route = "GET .../billing/menu/versions";
	const body = recordOf(route, answer, "answer");
	return {
		versions: arrayOf(route, body.versions, "versions").map((value, index) =>
			versionOf(route, value, `versions[${index}]`),
		),
	};
}

const intervals = ["month", "year"] as const;

const grantOf = (route: string, value: unknown, path: string): MenuGrant => {
	const grant = recordOf(route, value, path);
	const result: MenuGrant = {
		featureId: stringOf(route, grant.featureId, `${path}.featureId`),
		amount: numberOf(route, grant.amount, `${path}.amount`),
		every: oneOf(route, grant.every, `${path}.every`, intervals),
	};
	if (grant.rollover !== undefined) {
		const rollover = recordOf(route, grant.rollover, `${path}.rollover`);
		result.rollover = {
			months: numberOf(route, rollover.months, `${path}.rollover.months`),
			...(rollover.max !== undefined
				? { max: numberOf(route, rollover.max, `${path}.rollover.max`) }
				: {}),
		};
	}
	return result;
};

const tierOf = (route: string, value: unknown, path: string): MenuTier => {
	const tier = recordOf(route, value, path);
	const result: MenuTier = {
		id: stringOf(route, tier.id, `${path}.id`),
		name: stringOf(route, tier.name, `${path}.name`),
		blurb: stringOf(route, tier.blurb, `${path}.blurb`),
		public: booleanOf(route, tier.public, `${path}.public`),
		prices: arrayOf(route, tier.prices, `${path}.prices`).map(
			(price, index) => {
				const wire = recordOf(route, price, `${path}.prices[${index}]`);
				return {
					interval: oneOf(
						route,
						wire.interval,
						`${path}.prices[${index}].interval`,
						intervals,
					),
					amount: numberOf(
						route,
						wire.amount,
						`${path}.prices[${index}].amount`,
					),
				};
			},
		),
		grants: arrayOf(route, tier.grants, `${path}.grants`).map((grant, index) =>
			grantOf(route, grant, `${path}.grants[${index}]`),
		),
	};
	if (tier.quantities !== undefined)
		result.quantities = arrayOf(
			route,
			tier.quantities,
			`${path}.quantities`,
		).map((quantity, index) =>
			numberOf(route, quantity, `${path}.quantities[${index}]`),
		);
	return result;
};

const addonOf = (route: string, value: unknown, path: string): MenuAddon => {
	const addon = recordOf(route, value, path);
	const price = recordOf(route, addon.price, `${path}.price`);
	return {
		id: stringOf(route, addon.id, `${path}.id`),
		name: stringOf(route, addon.name, `${path}.name`),
		price: {
			amount: numberOf(route, price.amount, `${path}.price.amount`),
			every: oneOf(route, price.every, `${path}.price.every`, [
				"once",
				"month",
				"year",
			] as const),
		},
		grants: arrayOf(route, addon.grants, `${path}.grants`).map((grant, index) =>
			grantOf(route, grant, `${path}.grants[${index}]`),
		),
	};
};

export function menuOf(route: string, value: unknown, path: string): Menu {
	const menu = recordOf(route, value, path);
	return {
		currency: stringOf(route, menu.currency, `${path}.currency`),
		timeZone: stringOf(route, menu.timeZone, `${path}.timeZone`),
		features: arrayOf(route, menu.features, `${path}.features`).map(
			(value, index) => {
				const feature = recordOf(route, value, `${path}.features[${index}]`);
				return {
					id: stringOf(route, feature.id, `${path}.features[${index}].id`),
					name: stringOf(
						route,
						feature.name,
						`${path}.features[${index}].name`,
					),
					unit: unitOf(route, feature.unit, `${path}.features[${index}].unit`),
				};
			},
		),
		tiers: arrayOf(route, menu.tiers, `${path}.tiers`).map((tier, index) =>
			tierOf(route, tier, `${path}.tiers[${index}]`),
		),
		addons: arrayOf(route, menu.addons, `${path}.addons`).map((addon, index) =>
			addonOf(route, addon, `${path}.addons[${index}]`),
		),
	};
}

export function menuVersionBodyOf(answer: unknown): MenuVersionBody {
	const route = "GET .../billing/menu/versions/<n>";
	const body = recordOf(route, answer, "answer");
	const stripe = recordOf(route, body.stripe, "stripe");
	const keys = (value: unknown, path: string) =>
		arrayOf(route, value, path).map((key, index) =>
			stringOf(route, key, `${path}[${index}]`),
		);
	return {
		...versionOf(route, body, "answer"),
		menu: menuOf(route, body.menu, "menu"),
		stripe: {
			products: keys(stripe.products, "stripe.products"),
			prices: keys(stripe.prices, "stripe.prices"),
			portal: booleanOf(route, stripe.portal, "stripe.portal"),
		},
	};
}

/** The body `POST .../billing/menu` takes: buzz-school's `MenuSchema`, which has no tier `audience` yet (plans.ts:
 * "S8 sends it once the family service takes it"), so it is left out. */
export function menuBodyOf(menu: Menu): unknown {
	return {
		...menu,
		tiers: menu.tiers.map(({ audience: _audience, ...tier }) => tier),
	};
}

/** The live version: the newest one with `publishedAt` set (plans.ts). */
export const liveVersionOf = (
	versions: MenuVersions,
): MenuVersion | undefined =>
	versions.versions.find((version) => version.publishedAt !== null);

// ---- What the Members tab's menus offer, from the live menu (S8-contract section 7: the published body holds them)

const moneyFormats = new Map<string, Intl.NumberFormat>();
const formatMoney = (minorUnits: number, currency: string): string => {
	const code = currency.toUpperCase();
	let format = moneyFormats.get(code);
	if (!format) {
		format = new Intl.NumberFormat("en-US", {
			style: "currency",
			currency: code,
		});
		moneyFormats.set(code, format);
	}
	return format.format(minorUnits / 100);
};

/** "Send invoice…": each add-on of the live menu, labelled as the select shows it ("Top-up pack · 8 sessions ·
 * $40.00": its name, its grants in the feature's unit words, its price). */
export function invoiceItemsOf(menu: Menu): InvoiceItem[] {
	return menu.addons.map((addon) => {
		const grants = addon.grants.map((grant) => {
			const unit = menu.features.find(
				(feature) => feature.id === grant.featureId,
			)?.unit;
			if (!unit)
				throw schemaMismatch(
					"menu",
					`add-on ${addon.id} grants unknown feature ${grant.featureId}`,
				);
			return `${grant.amount} ${grant.amount === 1 ? unit.one : unit.other}`;
		});
		return {
			addonId: addon.id,
			label: [
				addon.name,
				...grants,
				formatMoney(addon.price.amount, menu.currency),
			].join(" · "),
			priceCents: addon.price.amount,
		};
	});
}

/** "Switch plan…": the live menu's tiers on sale that have a monthly price (a yearly-only tier has no monthly figure
 * the UI may show without dividing, so it is not offered). */
export function switchTiersOf(menu: Menu): SwitchTier[] {
	return menu.tiers.flatMap((tier) => {
		const monthly = tier.prices.find((price) => price.interval === "month");
		if (!tier.public || !monthly) return [];
		return [
			{
				id: tier.id,
				name: tier.name,
				monthlyCents: monthly.amount,
				quantities: tier.quantities ?? null,
			},
		];
	});
}

// ---- GET .../billing/members-list (routes/ledger-admin.ts membersOf; school-billing/balances.ts Balance)

const membershipStatuses: readonly MembershipStatus[] = [
	"active",
	"past_due",
	"canceled",
	"trialing",
	"incomplete",
	"unpaid",
];

export type MembersWirePage = { rows: WireRecord[]; nextCursor: string | null };

export function membersPageOf(answer: unknown): MembersWirePage {
	const route = "GET .../billing/members-list";
	const body = recordOf(route, answer, "answer");
	return {
		rows: arrayOf(route, body.members, "members").map((row, index) =>
			recordOf(route, row, `members[${index}]`),
		),
		nextCursor: nullableStringOf(route, body.nextCursor, "nextCursor"),
	};
}

const balanceOf = (
	route: string,
	value: unknown,
	path: string,
): MemberBalance => {
	const balance = recordOf(route, value, path);
	// `granted` is the bar's width; the route does not send it yet (gaps plan S8d-bz2). No credit figure is made up.
	if (!("granted" in balance))
		throw schemaMismatch(route, `${path}.granted is missing (S8d-bz2)`);
	const result: MemberBalance = {
		featureId: stringOf(route, balance.featureId, `${path}.featureId`),
		featureName: stringOf(route, balance.featureName, `${path}.featureName`),
		unit: unitOf(route, balance.unit, `${path}.unit`),
		available: numberOf(route, balance.available, `${path}.available`),
		held: numberOf(route, balance.held, `${path}.held`),
		expiresAt: nullableNumberOf(route, balance.expiresAt, `${path}.expiresAt`),
		granted: numberOf(route, balance.granted, `${path}.granted`),
	};
	if (balance.rolledOver !== undefined)
		result.rolledOver = numberOf(
			route,
			balance.rolledOver,
			`${path}.rolledOver`,
		);
	return result;
};

/** One membership. The route does not send the membership id (`school_memberships.id`), which the contract needs, so
 * a row without it is a mismatch; `currentPeriodEnd` is null for a membership with no period yet. */
export function memberOf(row: WireRecord, index: number): Member {
	const route = "GET .../billing/members-list";
	const path = `members[${index}]`;
	if (!("membershipId" in row))
		throw schemaMismatch(route, `${path}.membershipId is missing`);
	const key = stringOf(route, row.key, `${path}.key`);
	if (!key.startsWith("family:"))
		throw schemaMismatch(route, `${path}.key is not family:<id>`);
	return {
		key: key as `family:${string}`,
		familyId: stringOf(route, row.familyId, `${path}.familyId`),
		profileId: nullableStringOf(route, row.profileId, `${path}.profileId`),
		name: stringOf(route, row.name, `${path}.name`),
		tierId: stringOf(route, row.tierId, `${path}.tierId`),
		tierName: stringOf(route, row.tierName, `${path}.tierName`),
		quantity: numberOf(route, row.quantity, `${path}.quantity`),
		interval: oneOf(route, row.interval, `${path}.interval`, intervals),
		status: oneOf(route, row.status, `${path}.status`, membershipStatuses),
		currentPeriodEnd: nullableNumberOf(
			route,
			row.currentPeriodEnd,
			`${path}.currentPeriodEnd`,
		),
		cancelAtPeriodEnd: booleanOf(
			route,
			row.cancelAtPeriodEnd,
			`${path}.cancelAtPeriodEnd`,
		),
		menuVersion: numberOf(route, row.menuVersion, `${path}.menuVersion`),
		balances: arrayOf(route, row.balances, `${path}.balances`).map(
			(balance, balanceIndex) =>
				balanceOf(route, balance, `${path}.balances[${balanceIndex}]`),
		),
		membershipId: stringOf(route, row.membershipId, `${path}.membershipId`),
	};
}

export const membersOf = (page: MembersWirePage): MembersPage => ({
	members: page.rows.map(memberOf),
	nextCursor: page.nextCursor,
});

/** The ledger's member join (S8-contract section 11: the Worker sends `{ key }`): for each key, the first
 * membership's profile id (the id the Member column shows; the family id when the membership is the family's own)
 * and name. */
export function memberNamesOf(
	rows: WireRecord[],
): Map<string, { id: string; name: string }> {
	const route = "GET .../billing/members-list";
	const names = new Map<string, { id: string; name: string }>();
	rows.forEach((row, index) => {
		const key = stringOf(route, row.key, `members[${index}].key`);
		if (names.has(key)) return;
		const profileId = nullableStringOf(
			route,
			row.profileId,
			`members[${index}].profileId`,
		);
		names.set(key, {
			id:
				profileId ??
				stringOf(route, row.familyId, `members[${index}].familyId`),
			name: stringOf(route, row.name, `members[${index}].name`),
		});
	});
	return names;
}

// ---- GET .../ledger/capabilities (school-billing/ledger-actions.ts capabilitiesOf)

export const capabilityActions: readonly CapabilityAction[] = [
	"refund",
	"invoice",
	"adjustCredits",
	"releaseBooking",
	"recordOutcome",
	"cancelMembership",
	"changeQuantity",
	"switchTier",
	"publishMenu",
	"createPromo",
	"audit",
	"resendReceipt",
];

/**
 * buzz-school's reasons and the contract's. The contract has `owner_only`, `not_built`, `demo` and
 * `stripe_permission_missing` only (a contract change is proposed in the S8e report):
 * - `pin_required`: allowed: the Writer opens the PIN itself before it retries (`pinSource`).
 * - `step_up_required`: allowed: the write then rejects as `step_up` (the mailed link the UI must ask for).
 * - `school_billing_unavailable`, `bookings_unavailable`, `stripe_not_connected`: `not_built` ("Not available yet"),
 *   the nearest the contract has to "not available here now".
 * - `demo_read_only`: `demo` (the Worker's answer for a demo school, S8-contract section 11: every write refused).
 */
const capabilityOf = (
	route: string,
	value: unknown,
	path: string,
): Capability => {
	const capability = recordOf(route, value, path);
	if (booleanOf(route, capability.allowed, `${path}.allowed`))
		return { allowed: true };
	const reason = oneOf(route, capability.reason, `${path}.reason`, [
		"owner_only",
		"not_built",
		"pin_required",
		"step_up_required",
		"school_billing_unavailable",
		"bookings_unavailable",
		"stripe_not_connected",
		"demo_read_only",
	] as const);
	if (reason === "pin_required" || reason === "step_up_required")
		return { allowed: true };
	if (reason === "owner_only") return { allowed: false, reason: "owner_only" };
	if (reason === "demo_read_only") return { allowed: false, reason: "demo" };
	return { allowed: false, reason: "not_built" };
};

export function capabilitiesOf(answer: unknown): Capabilities {
	const route = "GET .../ledger/capabilities";
	const body = recordOf(route, answer, "answer");
	const actions = recordOf(route, body.actions, "actions");
	const mapped = {} as Record<CapabilityAction, Capability>;
	for (const action of capabilityActions)
		mapped[action] = capabilityOf(route, actions[action], `actions.${action}`);
	return {
		role: oneOf(route, body.role, "role", ["owner", "admin"] as const),
		stripeConnected: booleanOf(route, body.stripeConnected, "stripeConnected"),
		actions: mapped,
	};
}

// ---- GET .../finance-grants (routes/ledger.ts)

/** The owner's list. The route lists live grants only (`revokedAt` is then null) as `{ pubkey, grant, grantedAt }`;
 * it does not say who granted, so `grantedBy` is null unless the row sends it. */
export function financeGrantsOf(answer: unknown): FinanceGrant[] {
	const route = "GET .../finance-grants";
	const body = recordOf(route, answer, "answer");
	return arrayOf(route, body.grants, "grants").map((value, index) => {
		const grant = recordOf(route, value, `grants[${index}]`);
		return {
			subject: stringOf(route, grant.pubkey, `grants[${index}].pubkey`),
			grant: oneOf(route, grant.grant, `grants[${index}].grant`, [
				"finance",
			] as const),
			grantedBy: nullableStringOf(
				route,
				grant.grantedBy ?? null,
				`grants[${index}].grantedBy`,
			),
			grantedAt: numberOf(route, grant.grantedAt, `grants[${index}].grantedAt`),
			revokedAt: null,
		};
	});
}

/** A finance grant is asked for by pubkey (`PkBody`, 64 hex); the contract's `subject` must be one. */
export function pubkeyOf(subject: string): string {
	if (!/^[0-9a-fA-F]{64}$/.test(subject))
		throw schemaMismatch(
			"POST .../finance-grants",
			"the route takes a 64-hex pubkey, and the subject is not one (Person.id is a profile id)",
		);
	return subject.toLowerCase();
}
