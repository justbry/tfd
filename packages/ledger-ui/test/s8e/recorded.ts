import {
	adminPubkey,
	bookingId,
	familyId,
	membershipId,
	profileId,
	schoolId,
	tokenFor,
} from "./helpers.ts";

/**
 * Recorded answers of buzz-school's routes (`origin/main` 0af6e42cd), each built field by field from the route's own
 * code and schema; the comment above each names the source. Paths are under `packages/family-service/src/`.
 */

export const issuedAt = 1_793_000_000;
/** `LEDGER_TOKEN_TTL_S` (ledger/access.ts) = `MAX_LIFETIME_SEC` (ledger/jwt.ts): 300. */
export const tokenLifetime = 300;

/** routes/ledger.ts `POST /school-admin/ledger-token`: `json({ token, expiresAt: exp, schools: claim })`; the claims are
 * `{ iss, aud, sub, iat, nbf, exp, jti, schools }`. */
export const ledgerTokenAnswer = (
	schools: Array<{ id: string; role: "owner" | "admin"; finance: boolean }> = [
		{ id: schoolId, role: "owner", finance: true },
	],
	iat = issuedAt,
) => ({
	token: tokenFor({
		iss: "https://api.b4uni.test",
		aud: "atm-ledger",
		sub: profileId,
		iat,
		nbf: iat,
		exp: iat + tokenLifetime,
		jti: "jti-1",
		schools,
	}),
	expiresAt: iat + tokenLifetime,
	schools,
});

/** routes/ledger-school.ts: `{ school, name, timeZone: knownSchoolZone(...), ...menuFacts(...) }`, each null when unknown. */
export const schoolFactsAnswer = {
	school: schoolId,
	name: "Vibes of Light",
	timeZone: "America/Denver",
	currency: "usd",
	creditUnit: { one: "session", other: "sessions" },
};

/** 2026-11-06T17:00Z, 10:00 in America/Denver (MST, UTC-7). */
export const bookingStart = Date.UTC(2026, 10, 6, 17) / 1000;

/** routes/ledger-admin.ts `bookingsOf`: `{ timeZone, bookings, nextCursor }`; each booking `{ id, eventId, service,
 * startsAt, endsAt, hosts: [{ id, name }], attendee: { key, name } | null, guest, state, cutoffMinutes, seriesId }`,
 * instants in unix seconds (`bookings.starts_at`). */
export const bookingRow = (overrides: Record<string, unknown> = {}) => ({
	id: bookingId,
	eventId: "4f5a6b7c-8d9e-4f0a-9b1c-2d3e4f5a6b7c",
	service: "Massage 90",
	startsAt: bookingStart,
	endsAt: bookingStart + 5400,
	hosts: [{ id: "5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d", name: "Ana" }],
	attendee: { key: `family:${familyId}`, name: "Sam" },
	guest: false,
	state: "confirmed",
	cutoffMinutes: 720,
	seriesId: null,
	...overrides,
});
export const bookingsAnswer = (
	bookings: unknown[],
	nextCursor: string | null = null,
) => ({
	timeZone: "America/Denver",
	bookings,
	nextCursor,
});

/** school-billing/menu.ts `MenuSchema`: currency lower case, prices 50 or more, at least one price per tier. */
export const menu = {
	currency: "usd",
	timeZone: "America/Denver",
	features: [
		{
			id: "sessions",
			name: "Sessions",
			unit: { one: "session", other: "sessions" },
		},
	],
	tiers: [
		{
			id: "sparkle",
			name: "Sparkle",
			blurb: "A little time, every month",
			public: true,
			prices: [
				{ interval: "month", amount: 3250 },
				{ interval: "year", amount: 35000 },
			],
			grants: [
				{
					featureId: "sessions",
					amount: 8,
					every: "month",
					rollover: { months: 1 },
				},
			],
			quantities: [1, 2, 4],
		},
		{
			id: "annual",
			name: "Annual",
			blurb: "",
			public: true,
			prices: [{ interval: "year", amount: 90000 }],
			grants: [{ featureId: "sessions", amount: 100, every: "year" }],
		},
		{
			id: "board",
			name: "Board",
			blurb: "Not for sale",
			public: false,
			prices: [{ interval: "month", amount: 100 }],
			grants: [],
		},
	],
	addons: [
		{
			id: "pack8",
			name: "Top-up pack",
			price: { amount: 4000, every: "once" },
			grants: [{ featureId: "sessions", amount: 8, every: "month" }],
		},
	],
};

/** routes/ledger-admin.ts `versionsOf`: newest first, `{ version, publishedAt, savedAt }` in unix seconds. */
export const versionsAnswer = {
	versions: [
		{ version: 3, publishedAt: null, savedAt: 1_792_900_000 },
		{ version: 2, publishedAt: 1_792_000_000, savedAt: 1_791_990_000 },
		{ version: 1, publishedAt: 1_790_000_000, savedAt: 1_789_990_000 },
	],
};

/** routes/ledger-admin.ts `GET .../billing/menu/versions/<n>`: `{ version, publishedAt, savedAt, menu, stripe: {
 * products, prices, portal } }`, the stripe keys only. */
export const versionBodyAnswer = {
	version: 2,
	publishedAt: 1_792_000_000,
	savedAt: 1_791_990_000,
	menu,
	stripe: {
		products: ["t:sparkle", "a:pack8"],
		prices: ["t:sparkle:month", "t:sparkle:year", "a:pack8:once"],
		portal: true,
	},
};

/** routes/ledger-admin.ts `membersOf`: `{ members, nextCursor }`; each member `{ key, familyId, profileId, name,
 * tierId, tierName, quantity, interval, status, currentPeriodEnd, cancelAtPeriodEnd, menuVersion, balances }`,
 * balances `school-billing/balances.ts` `Balance { featureId, featureName, unit, available, held, expiresAt }`. */
export const memberRow = (overrides: Record<string, unknown> = {}) => ({
	key: `family:${familyId}`,
	familyId,
	profileId,
	name: "Sam",
	tierId: "sparkle",
	tierName: "Sparkle",
	quantity: 2,
	interval: "month",
	status: "active",
	currentPeriodEnd: 1_794_500_000,
	cancelAtPeriodEnd: false,
	menuVersion: 2,
	balances: [
		{
			featureId: "sessions",
			featureName: "Sessions",
			unit: { one: "session", other: "sessions" },
			available: 5,
			held: 0,
			expiresAt: null,
		},
	],
	...overrides,
});
export const membersAnswer = (
	members: unknown[],
	nextCursor: string | null = null,
) => ({ members, nextCursor });

/** school-billing/ledger-actions.ts `capabilitiesOf` through routes/ledger-admin.ts: `{ role, stripeConnected,
 * actions }`, each `{ allowed: true }` or `{ allowed: false, reason }`. An admin with the PIN closed and no step-up. */
export const capabilitiesAnswer = {
	role: "admin",
	stripeConnected: true,
	actions: {
		refund: { allowed: false, reason: "step_up_required" },
		invoice: { allowed: false, reason: "owner_only" },
		adjustCredits: { allowed: false, reason: "owner_only" },
		releaseBooking: { allowed: true },
		recordOutcome: { allowed: true },
		cancelMembership: { allowed: false, reason: "not_built" },
		changeQuantity: { allowed: false, reason: "not_built" },
		switchTier: { allowed: false, reason: "not_built" },
		publishMenu: { allowed: false, reason: "pin_required" },
		createPromo: { allowed: false, reason: "not_built" },
		audit: { allowed: false, reason: "not_built" },
		resendReceipt: { allowed: false, reason: "not_built" },
	},
};

/** routes/ledger.ts `GET .../finance-grants`: `{ grants: [{ pubkey, grant: "finance", grantedAt }] }`. */
export const financeGrantsAnswer = {
	grants: [{ pubkey: adminPubkey, grant: "finance", grantedAt: 1_792_500_000 }],
};

/** routes/booking-admin.ts outcome: `{ booking, state, recordedAt, creditEffect: "not_wired" }`. */
export const outcomeAnswer = {
	booking: bookingId,
	state: "attended",
	recordedAt: 1_793_000_100,
	creditEffect: "not_wired",
};
/** routes/booking-admin.ts cancel: `{ cancelled: [id] }`. */
export const cancelAnswer = { cancelled: [bookingId] };
/** school-billing/refund.ts `RefundResult`. */
export const refundAnswer = {
	refundId: "re_1A2b3C4d5E",
	status: "pending",
	refundedCents: 2500,
	remainingCents: 4000,
	replayed: false,
};
/** school-billing/adjust.ts `AdjustResult`. */
export const adjustAnswer = {
	membershipId,
	featureId: "sessions",
	kind: "goodwill",
	amount: 2,
	available: 7,
	replayed: false,
};
/** school-billing/invoice.ts `InvoiceResult`. */
export const invoiceAnswer = {
	invoiceId: "in_1A2b3C4d5E",
	status: "open",
	hostedInvoiceUrl: null,
	replayed: false,
};
/** routes/ledger.ts finance-grants POST and remove: `{ ok: true, changed }`. */
export const grantAnswer = { ok: true, changed: true };
/** routes/school-billing.ts `stateOf`, the answer of the menu save, publish and Stripe key routes. */
export const billingStateAnswer = {
	connected: true,
	keyLast4: "a1b2",
	accountName: "Vibes of Light",
	timeZone: "America/Denver",
	published: { version: 3, at: 1_793_000_200 },
	menu,
};
/** routes/school-admin.ts key-create: `{ key, row }` (school/keys.ts `mintKey`, `KeyRow`). */
export const keyBody = ["b4u", "pk", "live", "Q".repeat(32)].join("_");
export const keyCreateAnswer = {
	key: keyBody,
	row: {
		id: "6b7c8d9e-0f1a-4b2c-8d3e-4f5a6b7c8d9e",
		school_channel_id: schoolId,
		kind: "pk",
		prefix: keyBody.slice(0, 15),
		label: "Website",
		created_by: adminPubkey,
		created_at: 1_793_000_300,
		last_used_at: null,
		revoked_at: null,
	},
};
export const okAnswer = { ok: true };
/** routes/pin.ts `/family/pin/verify`: `sessionView` (routes/common.ts); the adapter reads none of it. */
export const pinVerifiedAnswer = {
	pin_ok: true,
	pin_unlock_remaining_s: 900,
	step_up_until: null,
};
/** app.ts: an `HttpError` is answered `{ error: code, ...extra }`. */
export const refusal = (code: string, extra: Record<string, unknown> = {}) => ({
	error: code,
	...extra,
});
