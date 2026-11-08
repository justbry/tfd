/**
 * A demo school's answers to the buzz-school reads the ledger UI makes (S8-contract section 11 "Demo schools"), worked
 * out from its preset's events alone. Each answer has the shape of buzz-school's route (`routes/ledger-admin.ts`,
 * `ledger-school.ts`, `ledger.ts` on buzz-school `origin/main`), so the UI parses it with the same functions as the
 * real one. A field the events do not give is the route's null, or the whole route is not available; never a made-up
 * value. The seed stores each answer as `schools/<id>/demo-api/<route>.json`; the Worker serves it.
 */
import type { AtmEvent, Menu } from "tfd";
import type { DemoFacts } from "../demo.js";

/** The routes a demo school answers, each the path after `/school-admin/schools/<id>/`. */
export const DEMO_API_ROUTES = [
	"ledger/school",
	"ledger/capabilities",
	"billing/members-list",
	"billing/menu/versions",
	"bookings",
	"finance-grants",
] as const;
/** One menu version's body: `billing/menu/versions/<n>`. */
export const menuVersionRoute = (version: number): string =>
	`billing/menu/versions/${version}`;

/** The writes the ledger UI asks capabilities for (buzz-school `school-billing/ledger-actions.ts`). */
const CAPABILITY_ACTIONS = [
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
] as const;
/** Every write on a demo school is refused for this reason (the Worker's 403 `demo_read_only`). */
export const DEMO_REFUSAL = "demo_read_only";

const MS_PER_SECOND = 1000;
const FAMILY = "family:";
const CANCELED_MAPPING = "stripe/customer.subscription.deleted@v1";
const TIER_PRODUCT = /^prod_tier_(.+)_(month|year)$/;
const TIER_ENTITLEMENT = "ce_tier_";

const secondsOf = (instant: string): number =>
	Math.floor(Date.parse(instant) / MS_PER_SECOND);

type Unit = { one: string; other: string };

export type DemoRouteAnswers = {
	/** Route path to its answer body. */
	answers: Map<string, unknown>;
	/** Route path to why the events cannot answer it (the Worker's `501 not_available`). */
	notAvailable: Map<string, string>;
	/** The local date (`YYYY-MM-DD`, the school's zone) of the latest booking, or null when there is none. */
	lastBookingOn: string | null;
};

type Row = Record<string, unknown>;
const isRecord = (value: unknown): value is Row =>
	typeof value === "object" && value !== null && !Array.isArray(value);
const rowsOf = (value: unknown): Row[] =>
	Array.isArray(value) ? value.filter(isRecord) : [];

/** The engine command's ops and its mutation's changes: where the scenario states a membership's product and its
 * entitlements' resets. */
const opsOf = (event: AtmEvent): Row[] => {
	const command = isRecord(event.payload.command) ? event.payload.command : {};
	const mutation = isRecord(event.payload.mutation)
		? event.payload.mutation
		: {};
	return [...rowsOf(command.ops), ...rowsOf(mutation.changes)];
};

const publishedMenus = (events: readonly AtmEvent[]) =>
	events
		.filter((event) => event.event_type === "catalog.published")
		.map((event) => ({
			version: Number(event.payload.version),
			at: secondsOf(event.event_time),
			menu: event.payload.menu as Menu,
		}))
		.filter(({ version }) => Number.isInteger(version))
		.sort((a, b) => b.version - a.version);

type Membership = {
	key: string;
	familyId: string;
	tierId: string;
	interval: "month" | "year";
	quantity: number;
	menuVersion: number;
	membershipId: string;
	canceled: boolean;
	currentPeriodEnd: number | null;
};

/**
 * Each family's membership as its events state it: the tier product of the latest engine command that inserts one
 * (`prod_tier_<tier>_<interval>`, its quantity and the menu version of that event), canceled once a
 * `customer.subscription.deleted` event follows it, and the period end the latest reset of a tier entitlement names
 * (null once refills ended). A subject that is not a family (`profile:…`) has no membership the route can list.
 */
function membershipsOf(events: readonly AtmEvent[]): Map<string, Membership> {
	const memberships = new Map<string, Membership>();
	for (const event of events) {
		if (!event.key.startsWith(FAMILY)) continue;
		const current = memberships.get(event.key);
		for (const op of opsOf(event)) {
			const row = isRecord(op.row) ? op.row : null;
			if (op.op === "insert" && op.table === "customerProducts" && row) {
				const product = TIER_PRODUCT.exec(String(row.internal_product_id));
				if (product === null) continue;
				memberships.set(event.key, {
					key: event.key,
					familyId: event.key.slice(FAMILY.length),
					tierId: product[1] as string,
					interval: product[2] as "month" | "year",
					quantity: Number(row.quantity),
					menuVersion: Number(event.labels.menu_version),
					membershipId: `${String(row.internal_customer_id)}/${String(row.id)}`,
					canceled: false,
					currentPeriodEnd: current?.currentPeriodEnd ?? null,
				});
			}
		}
		const membership = memberships.get(event.key);
		if (membership === undefined) continue;
		if (event.labels.mapping === CANCELED_MAPPING) membership.canceled = true;
		for (const op of opsOf(event)) {
			const row = isRecord(op.row) ? op.row : null;
			const set = isRecord(op.set)
				? op.set
				: isRecord(op.after)
					? op.after
					: null;
			const tierRow =
				op.op === "insert" &&
				op.table === "customerEntitlements" &&
				row?.customer_product_id === "cp_tier";
			const tierUpdate =
				op.table === "customerEntitlements" &&
				String(op.id).startsWith(TIER_ENTITLEMENT) &&
				set !== null &&
				"next_reset_at" in set;
			const reset = tierRow
				? row?.next_reset_at
				: tierUpdate
					? set?.next_reset_at
					: undefined;
			if (reset === undefined) continue;
			membership.currentPeriodEnd =
				typeof reset === "number" ? Math.floor(reset / MS_PER_SECOND) : null;
		}
	}
	return memberships;
}

type FeatureBalance = {
	available: number;
	held: number;
	/** The latest grant's cause, its credits and what it rolled over. */
	grantCause: string | null;
	granted: number;
	rolledOver: number | null;
	/** The expiry the latest grant or expiry change names for the feature. */
	expiresAt: number | null;
};

/** Each family's credits per feature, from the `credit.*` postings on its `credits:avail:` and `credits:held:`
 * accounts, and the latest grant's labels. */
function balancesOf(
	events: readonly AtmEvent[],
): Map<string, Map<string, FeatureBalance>> {
	const all = new Map<string, Map<string, FeatureBalance>>();
	for (const event of events) {
		if (
			!event.key.startsWith(FAMILY) ||
			!event.event_type.startsWith("credit.")
		)
			continue;
		const features = all.get(event.key) ?? new Map<string, FeatureBalance>();
		all.set(event.key, features);
		const entryOf = (id: string): FeatureBalance => {
			let entry = features.get(id);
			if (entry === undefined) {
				entry = {
					available: 0,
					held: 0,
					grantCause: null,
					granted: 0,
					rolledOver: null,
					expiresAt: null,
				};
				features.set(id, entry);
			}
			return entry;
		};
		const sides = [
			[`credits:avail:${event.key}:`, "available"],
			[`credits:held:${event.key}:`, "held"],
		] as const;
		for (const posting of event.postings)
			for (const [prefix, side] of sides)
				if (posting.account.startsWith(prefix))
					entryOf(posting.account.slice(prefix.length))[side] += Number(
						posting.amount,
					);
		const feature = event.labels.feature;
		if (feature === undefined) continue;
		const expiry = event.labels.expires_at;
		const expiresAt = expiry === undefined ? null : secondsOf(expiry);
		if (event.event_type === "credit.expiration_changed")
			entryOf(feature).expiresAt = expiresAt;
		if (event.event_type !== "credit.granted") continue;
		const entry = entryOf(feature);
		const credits = event.postings
			.filter(
				({ account }) => account === `credits:avail:${event.key}:${feature}`,
			)
			.reduce((sum, posting) => sum + Number(posting.amount), 0);
		const rolled =
			event.labels.rolled_over === undefined
				? null
				: Number(event.labels.rolled_over);
		// The grants of one engine command (one invoice) are the period's: a new command starts a new period.
		if (event.cause !== undefined && entry.grantCause === event.cause) {
			entry.granted += credits;
			if (rolled !== null) entry.rolledOver = (entry.rolledOver ?? 0) + rolled;
		} else {
			entry.grantCause = event.cause ?? null;
			entry.granted = credits;
			entry.rolledOver = rolled;
		}
		entry.expiresAt = expiresAt;
	}
	return all;
}

const unitOf = (menu: Menu | undefined, featureId: string) => {
	const feature = menu?.features.find(({ id }) => id === featureId);
	return {
		featureName: feature?.name ?? featureId,
		unit: (feature?.unit as Unit | undefined) ?? {
			one: featureId,
			other: featureId,
		},
	};
};

/** `GET .../billing/members-list` (`membersOf`): one page holding every membership, ordered by its key. */
function membersListOf(
	events: readonly AtmEvent[],
	menus: ReturnType<typeof publishedMenus>,
) {
	const balances = balancesOf(events);
	const menuAt = (version: number) =>
		menus.find((published) => published.version === version)?.menu;
	const members = [...membershipsOf(events).values()]
		.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
		.map((membership) => {
			const menu = menuAt(membership.menuVersion);
			const features = balances.get(membership.key) ?? new Map();
			const order = menu?.features.map(({ id }) => id) ?? [];
			const rank = (id: string): number => {
				const index = order.indexOf(id);
				return index === -1 ? order.length : index;
			};
			const featureIds = [...features.keys()].sort((a, b) => rank(a) - rank(b));
			return {
				key: membership.key,
				familyId: membership.familyId,
				// The family's own membership: the events name no profile.
				profileId: null,
				name: `Family ${membership.familyId}`,
				tierId: membership.tierId,
				tierName:
					menu?.tiers.find(({ id }) => id === membership.tierId)?.name ??
					membership.tierId,
				quantity: membership.quantity,
				interval: membership.interval,
				status: membership.canceled ? "canceled" : "active",
				currentPeriodEnd: membership.canceled
					? null
					: membership.currentPeriodEnd,
				// No event schedules a cancellation ahead: a subscription ends when it is deleted.
				cancelAtPeriodEnd: false,
				menuVersion: membership.menuVersion,
				membershipId: membership.membershipId,
				balances: featureIds.map((featureId) => {
					const balance = features.get(featureId) as FeatureBalance;
					return {
						featureId,
						...unitOf(menu, featureId),
						available: balance.available,
						held: balance.held,
						expiresAt: balance.available > 0 ? balance.expiresAt : null,
						granted: balance.granted,
						...(balance.rolledOver === null
							? {}
							: { rolledOver: balance.rolledOver }),
					};
				}),
			};
		});
	return { members, nextCursor: null };
}

type DemoBooking = { at: number; row: Row };

/** `GET .../bookings` (`bookingsOf`), every booking: one per family and `booking` label that was held and then spent,
 * at the instant its credits were spent (the events give no other time, so it starts and ends then). A booking whose
 * credits are still held has no time yet and is not listed. The events name no host, no cutoff, no series and no
 * recorded outcome. */
function bookingsOf(events: readonly AtmEvent[]): DemoBooking[] {
	const held = new Map<string, AtmEvent>();
	const bookings: DemoBooking[] = [];
	for (const event of events) {
		const booking = event.labels.booking;
		if (booking === undefined || !event.key.startsWith(FAMILY)) continue;
		const id = `${event.key.slice(FAMILY.length)}-${booking}`;
		if (event.event_type === "credit.held") held.set(id, event);
		if (event.event_type !== "credit.spent" || !held.has(id)) continue;
		held.delete(id);
		const at = secondsOf(event.event_time);
		const service = event.labels.service ?? "booking";
		bookings.push({
			at,
			row: {
				id,
				eventId: service,
				service,
				startsAt: at,
				endsAt: at,
				hosts: [],
				attendee: {
					key: event.key,
					name: `Family ${event.key.slice(FAMILY.length)}`,
				},
				guest: false,
				state: "confirmed",
				cutoffMinutes: null,
				seriesId: null,
				attendance: null,
			},
		});
	}
	return bookings.sort(
		(a, b) => a.at - b.at || (String(a.row.id) < String(b.row.id) ? -1 : 1),
	);
}

/** The Stripe keys the events show for a menu: a tier or add-on whose price an invoice line names
 * (`price_…_t_<tier>_<interval>_…`, `price_…_a_<addon>_<every>_…`). An item no invoice paid for is not shown. */
function stripeKeysOf(events: readonly AtmEvent[], menu: Menu) {
	const prices = new Set<string>();
	for (const event of events)
		for (const item of rowsOf(event.payload.items))
			if (typeof item.price === "string") prices.add(item.price);
	const products: string[] = [];
	const priceKeys: string[] = [];
	const seen = (marker: string) =>
		[...prices].some((price) => price.includes(marker));
	for (const tier of menu.tiers)
		for (const { interval } of tier.prices)
			if (seen(`_t_${tier.id}_${interval}_`)) {
				if (!products.includes(`t:${tier.id}`)) products.push(`t:${tier.id}`);
				priceKeys.push(`t:${tier.id}:${interval}`);
			}
	for (const addon of menu.addons)
		if (seen(`_a_${addon.id}_${addon.price.every}_`)) {
			products.push(`a:${addon.id}`);
			priceKeys.push(`a:${addon.id}:${addon.price.every}`);
		}
	// The billing portal is not in any event.
	return { products, prices: priceKeys, portal: false };
}

const localDay = (seconds: number, timeZone: string): string =>
	new Intl.DateTimeFormat("en-CA", {
		timeZone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).format(new Date(seconds * MS_PER_SECOND));

/** Every answer of `school`, from its preset's `events` and the facts the switcher lists for it. */
export function demoRouteAnswers(
	school: string,
	events: readonly AtmEvent[],
	facts: DemoFacts,
): DemoRouteAnswers {
	const answers = new Map<string, unknown>();
	const notAvailable = new Map<string, string>();
	const menus = publishedMenus(events);
	answers.set("ledger/school", {
		school,
		name: facts.name,
		timeZone: facts.timeZone,
		currency: facts.currency.toLowerCase(),
		creditUnit: facts.creditUnit,
		defaulted: [],
	});
	answers.set("ledger/capabilities", {
		role: "owner",
		// A Stripe account is connected when Stripe sent the school anything.
		stripeConnected: events.some((event) => event.source === "stripe"),
		actions: Object.fromEntries(
			CAPABILITY_ACTIONS.map((action) => [
				action,
				{ allowed: false, reason: DEMO_REFUSAL },
			]),
		),
	});
	answers.set("billing/menu/versions", {
		versions: menus.map(({ version, at }) => ({
			version,
			publishedAt: at,
			// A published version was saved when it was published, as far as any event says.
			savedAt: at,
		})),
	});
	for (const { version, at, menu } of menus)
		answers.set(menuVersionRoute(version), {
			version,
			publishedAt: at,
			savedAt: at,
			menu,
			stripe: stripeKeysOf(events, menu),
		});
	answers.set("finance-grants", { grants: [] });
	const families = events.some((event) => event.key.startsWith(FAMILY));
	const subjects = events.some(
		(event) =>
			event.event_type.startsWith("credit.") && !event.key.startsWith(FAMILY),
	);
	let lastBookingOn: string | null = null;
	if (subjects && !families) {
		const reason =
			"this scenario's members are profiles, and its events name no family for them";
		notAvailable.set("billing/members-list", reason);
		notAvailable.set("bookings", reason);
	} else {
		answers.set("billing/members-list", membersListOf(events, menus));
		const bookings = bookingsOf(events);
		const last = bookings.at(-1);
		lastBookingOn =
			last === undefined ? null : localDay(last.at, facts.timeZone);
		answers.set("bookings", {
			timeZone: facts.timeZone,
			bookings: bookings.map(({ row }) => row),
			nextCursor: null,
		});
	}
	return { answers, notAvailable, lastBookingOn };
}
