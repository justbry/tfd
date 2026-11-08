import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CapabilityAction, Person } from "$contract/data/members.ts";
import * as svelteModel from "../../src/app/members/members-model.ts";
import { calendar } from "../helpers.ts";
import { fixtureReader } from "./support.ts";

/** Consistency check C for the Members tab: the Svelte model (src/app/members/members-model.ts) is a copy of the
 * Preact package's members-model.ts (which imports Preact types and so cannot be imported into the Svelte build); this
 * test runs both over every fixture school's people, memberships, drawers and capabilities, with pending changes of
 * every kind, and requires the same answers, so that the copy cannot drift. The Preact module is loaded by path, so
 * the type checker never follows it into Preact. */
const preactPath = join(
	import.meta.dir,
	"../../../ledger-ui/src/app/members-model.ts",
);
const preactModel = (await import(preactPath)) as typeof svelteModel;
const schools = ["vol", "b4u", "map", "nw", "har"];
const reader = fixtureReader();
const actions: CapabilityAction[] = [
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

describe("the Svelte Members model answers as the Preact one does", () => {
	for (const schoolId of schools)
		test(`${schoolId}: balances, standings, attention, roles, capabilities, payments and history`, async () => {
			const query = { schoolId };
			const [{ members }, people, capabilities] = await Promise.all([
				reader.members(query),
				reader.people(query),
				reader.capabilities(query),
			]);
			const both = <A>(compute: (model: typeof svelteModel) => A): [A, A] => [
				compute(svelteModel),
				compute(preactModel),
			];
			const pendingChanges = (person: Person): svelteModel.Change[] => [
				{
					kind: "ledger",
					personId: person.id,
					event: svelteModel.pendingEvent(calendar.now, {
						type: "credit.adjusted",
						text: "Goodwill",
						credits: 2,
					}),
					paymentIntentId: null,
				},
				{
					kind: "ledger",
					personId: person.id,
					event: svelteModel.pendingEvent(calendar.now, {
						type: "credit.released",
						text: "released",
						credits: 1,
					}),
					paymentIntentId: null,
				},
				{ kind: "role", personId: person.id, role: "make" },
				{ kind: "booking", bookingId: "bk_5kd" },
			];
			for (const person of people) {
				const changes = pendingChanges(person);
				const member =
					members.find(({ profileId }) => profileId === person.id) ?? null;
				const detail = person.planHolder
					? await reader.memberDetail({ schoolId, personId: person.id })
					: null;
				for (const set of [[], changes]) {
					const [mine, theirs] = both((model) => model.applyRoles(people, set));
					expect(mine).toEqual(theirs);
					if (member) {
						const balance = member.balances[0];
						if (balance) {
							const [projectedMine, projectedTheirs] = both((model) =>
								model.project(balance, person.id, set),
							);
							expect(projectedMine).toEqual(projectedTheirs);
							expect(
								both((model) =>
									model.barOf(balance, model.project(balance, person.id, set)),
								),
							).toSatisfy(
								([first, second]) =>
									JSON.stringify(first) === JSON.stringify(second),
							);
						}
						const [standingMine, standingTheirs] = both((model) =>
							model.standingOf(member, set),
						);
						expect(standingMine).toEqual(standingTheirs);
						const [attentionMine, attentionTheirs] = both((model) =>
							model.attentionOf(person, standingMine.canceled, set),
						);
						expect(attentionMine).toEqual(attentionTheirs);
					}
					if (detail) {
						const [paymentsMine, paymentsTheirs] = both((model) =>
							model.paymentsOf(detail, person.id, set, calendar.today),
						);
						expect(paymentsMine).toEqual(paymentsTheirs);
						const [historyMine, historyTheirs] = both((model) =>
							model.historyOf(detail, person.id, set),
						);
						expect(historyMine).toEqual(historyTheirs);
						for (const event of detail.history) {
							const [labelMine, labelTheirs] = both((model) =>
								model.eventLabel(event, { other: "sessions" }),
							);
							expect(labelMine).toBe(labelTheirs);
						}
					}
				}
				for (const change of ["make", "remove", "grant", "revoke"] as const) {
					expect(
						both((model) =>
							model.roleGuard(capabilities, people, person, change),
						),
					).toSatisfy(([first, second]) => first === second);
					expect(
						both((model) => model.roleTexts(change, person, "School")),
					).toSatisfy(
						([first, second]) =>
							JSON.stringify(first) === JSON.stringify(second),
					);
				}
			}
			for (const action of actions)
				for (const place of ["menu", "drawer"] as const) {
					const [mine, theirs] = both((model) =>
						model.capabilityReason(capabilities, action, place),
					);
					expect({ action, place, text: mine }).toEqual({
						action,
						place,
						text: theirs,
					});
				}
		});
	test("the formats", () => {
		const school = "America/Denver";
		for (const seconds of [1_793_000_000, 1_796_000_000, 0]) {
			expect(svelteModel.formatDay(seconds, school)).toBe(
				preactModel.formatDay(seconds, school),
			);
			expect(svelteModel.formatPeriodEnd(seconds, school)).toBe(
				preactModel.formatPeriodEnd(seconds, school),
			);
		}
		expect(svelteModel.formatPeriodEnd(null, school)).toBe("—");
		for (const cents of [-5000, 0, 12345])
			expect(svelteModel.amountText(cents)).toBe(preactModel.amountText(cents));
		expect(svelteModel.formatWallTime("2026-11-04T17:00")).toBe(
			preactModel.formatWallTime("2026-11-04T17:00"),
		);
		expect(svelteModel.formatPaymentDay("2026-11-01")).toBe(
			preactModel.formatPaymentDay("2026-11-01"),
		);
	});
});

/** The Bookings period model is a copy of the Preact package's bookings-period.ts (it would otherwise drag the weekday
 * helpers of period.ts into the first page load); both answer alike over every period the tab can ask for. */
describe("the Svelte Bookings period model answers as the Preact one does", async () => {
	const preactPeriod = (await import(
		join(import.meta.dir, "../../../ledger-ui/src/app/bookings-period.ts")
	)) as typeof import("../../src/app/bookings/period-model.ts");
	const mine = await import("../../src/app/bookings/period-model.ts");
	const days = [
		"2026-11-05",
		"2026-11-01",
		"2026-11-02",
		"2026-11-08",
		"2026-12-31",
		"2027-01-01",
	];
	test("read, days, label and route", () => {
		for (const today of days)
			for (const range of ["day", "week"] as const)
				for (const offset of [-3, -2, -1, 0, 1, 2, 5]) {
					const period = { range, offset };
					expect(mine.bookingsDays(period, today)).toEqual(
						preactPeriod.bookingsDays(period, today),
					);
					const { from } = mine.bookingsDays(period, today);
					expect(mine.bookingsLabel(period, from)).toBe(
						preactPeriod.bookingsLabel(period, from),
					);
				}
		for (const query of [
			"",
			"range=day",
			"range=week&offset=2",
			"range=nope&offset=x",
			"offset=1.5",
			"offset=-1",
		]) {
			const parameters = new URLSearchParams(query);
			expect(mine.readBookingsPeriod(parameters)).toEqual(
				preactPeriod.readBookingsPeriod(parameters),
			);
		}
		expect(mine.bookingsChoices).toEqual(preactPeriod.bookingsChoices);
	});
});

/** The four copies against the Preact originals (the Preact modules import Preact types, so the Svelte build cannot use
 * them): their source, line by line, with the differences listed here and nothing else allowed, then their behaviour. */
const packages = join(import.meta.dir, "../../../");
const normalise = (source: string): string[] =>
	source
		.replace(/^import[\s\S]*?;\n/gm, "")
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/^\s*\/\/.*$/gm, "")
		.split("\n")
		.map((line) => line.replace(/\s+/g, " ").trim())
		.filter((line) => line !== "");
const linesOnlyIn = (first: string[], second: string[]): string[] => {
	const left = [...second];
	return first.filter((line) => {
		const at = left.indexOf(line);
		if (at < 0) return true;
		left.splice(at, 1);
		return false;
	});
};
const sourceDifference = (
	mine: string,
	preact: string,
	cut: (source: string) => string = (source) => source,
) => {
	const ours = normalise(readFileSync(join(packages, mine), "utf8"));
	const theirs = normalise(cut(readFileSync(join(packages, preact), "utf8")));
	return {
		mine: linesOnlyIn(ours, theirs).sort(),
		preact: linesOnlyIn(theirs, ours).sort(),
	};
};

describe("the copies' source differs from the originals only where documented", () => {
	const sorted = (lines: string[]): string[] => [...lines].sort();
	test("members-model.ts: the portal's change type is declared here, and the icon names are the panes'", () => {
		expect(
			sourceDifference(
				"ledger-ui-svelte/src/app/members/members-model.ts",
				"ledger-ui/src/app/members-model.ts",
			),
		).toEqual({
			mine: sorted([
				"export type PortalChange = {",
				"waiting: boolean;",
				"quantity?: number;",
				"scheduledQuantity?: number;",
				"ending?: boolean;",
				"endsNow?: boolean;",
				"};",
				"export const audienceIcons: Record<Audience, PaneIconName> = {",
			]),
			preact: ["export const audienceIcons: Record<Audience, IconName> = {"],
		});
	});
	test("members-writes.ts: a refund Stripe refused is a UiError with its own code, not an Error", () => {
		expect(
			sourceDifference(
				"ledger-ui-svelte/src/app/members/members-writes.ts",
				"ledger-ui/src/app/members-writes.ts",
			),
		).toEqual({
			mine: sorted([
				"});",
				'if (result.status === "failed")',
				"throw new UiError({",
				'kind: "bad_request",',
				'detail: { code: "refund_failed" },',
				'reason: "Stripe refused the refund",',
				"retryable: false,",
			]),
			preact: [
				'if (result.status === "failed") throw new Error("Stripe refused the refund");',
			],
		});
	});
	test("menu-items.ts: the types are exported, the icon names are the panes', and a person whose lists could not be read gets 'Not available yet'", () => {
		const cut = (source: string): string =>
			source.slice(
				source.indexOf("/** The actions of the"),
				source.indexOf("/** The ⋯ button of a row"),
			);
		const difference = sourceDifference(
			"ledger-ui-svelte/src/app/members/menu-items.ts",
			"ledger-ui/src/app/member-menu.tsx",
			cut,
		);
		expect(difference.mine).toEqual(
			sorted([
				'| "refund"',
				'| "release"',
				"export type BookingAction =",
				'| "confirm"',
				'| "noshow"',
				'| "remind";',
				"export const previewKeeps: ReadonlySet<MenuAction> = new Set([",
				"export type MenuItem = {",
				"icon: PaneIconName;",
				"detailUnavailable?: boolean;",
				'const notAvailableYet = "Not available yet";',
				"export function menuItems(context: PersonContext): Array<MenuItem | null> {",
				"icon: PaneIconName,",
				"icon: PaneIconName,",
				"context.detailUnavailable",
				"context.detailUnavailable",
				"? notAvailableYet",
				"? notAvailableYet",
				"? notAvailableYet",
				": held > 0",
				"? context.detailUnavailable",
				': ""',
				": stripeDashboardUrl === null",
				'? "Not on Stripe"',
				': "",',
			]),
		);
		expect(difference.preact).toEqual(
			sorted([
				"const previewKeeps: ReadonlySet<MenuAction> = new Set([",
				"type MenuItem = {",
				"icon: IconName;",
				"function menuItems(context: PersonContext): Array<MenuItem | null> {",
				"icon: IconName,",
				"icon: IconName,",
				"held > 0",
				'? ""',
				'stripeDashboardUrl === null ? "Not on Stripe" : "",',
			]),
		);
	});
	test("period-model.ts: the weekday helpers are declared here, out of the first page load", () => {
		const difference = sourceDifference(
			"ledger-ui-svelte/src/app/bookings/period-model.ts",
			"ledger-ui/src/app/bookings-period.ts",
		);
		expect(difference.preact).toEqual([]);
		expect(difference.mine.join(" ")).toContain(
			"const weekStart = (isoDate: string): string =>",
		);
		expect(difference.mine).toHaveLength(12);
	});
});

describe("the rest of the Members model answers as the Preact one does", () => {
	test("scores, labels, counts, roles, the pending sets and the viewer", async () => {
		const reader = fixtureReader();
		const people = await reader.people({ schoolId: "vol" });
		const { members } = await reader.members({ schoolId: "vol" });
		const both = <Value>(
			compute: (model: typeof svelteModel) => Value,
		): [Value, Value] => [compute(svelteModel), compute(preactModel)];
		for (const person of people) {
			const [mine, theirs] = both((model) =>
				model.attentionScore(person.attention),
			);
			expect(mine).toBe(theirs);
			expect(both((model) => model.roleRank(person))).toSatisfy(
				([first, second]) => first === second,
			);
			for (const reason of person.attention)
				for (const unit of ["sessions", "credits"]) {
					const [label, expected] = both((model) =>
						model.attentionLabel(reason, unit),
					);
					expect(label).toBe(expected);
				}
		}
		for (const unit of [{ one: "session", other: "sessions" }])
			for (const count of [0, 1, 2])
				expect(both((model) => model.countOf(count, unit))).toSatisfy(
					([a, b]) => a === b,
				);
		expect(svelteModel.rosterLock).toEqual(preactModel.rosterLock);
		const changes: svelteModel.Change[] = [
			{ kind: "booking", bookingId: "bk_5kd" },
			{
				kind: "membership",
				membershipId: "mem_1",
				personId: "m_012",
				change: "cancel_period_end",
			},
			{
				kind: "ledger",
				personId: "m_012",
				paymentIntentId: "pay_1",
				event: svelteModel.pendingEvent("2026-11-05T12:00", {
					type: "payment.refunded",
					text: "Refund",
					amountCents: -500,
				}),
			},
			{
				kind: "ledger",
				personId: "m_012",
				paymentIntentId: null,
				event: svelteModel.pendingEvent("2026-11-05T12:00", {
					type: "membership.changed",
					text: "x",
				}),
			},
		];
		for (const set of [[], changes]) {
			expect(both((model) => [...model.pendingBookingIds(set)])).toSatisfy(
				([a, b]) => JSON.stringify(a) === JSON.stringify(b),
			);
			for (const person of people)
				expect(both((model) => model.changeWaiting(set, person.id))).toSatisfy(
					([a, b]) => a === b,
				);
			expect(
				both((model) =>
					model.membershipChangesOf(members, {
						m_012: { waiting: true, ending: true, endsNow: false },
						m_093: { waiting: true },
					}),
				),
			).toSatisfy(([a, b]) => JSON.stringify(a) === JSON.stringify(b));
		}
		for (const change of changes)
			expect(both((model) => model.portalChangeOf(change))).toSatisfy(
				([a, b]) => JSON.stringify(a) === JSON.stringify(b),
			);
		const detail = await reader.memberDetail({
			schoolId: "vol",
			personId: "m_012",
		});
		for (const payment of detail.refundable)
			expect(both((model) => model.refundedOf(payment, changes))).toSatisfy(
				([a, b]) => a === b,
			);
		const olds = await reader.people({ schoolId: "vol" });
		for (const person of olds)
			for (const booking of detail.bookings)
				expect(
					both((model) => model.insideCutoffOf(person, booking)),
				).toSatisfy(([a, b]) => a === b);
		const viewing = {
			option: { value: "owner", admin: true },
			preview: false,
		} as unknown as Parameters<typeof svelteModel.viewerOf>[0];
		for (const value of [
			"owner",
			"finance",
			"admin",
			"governance",
			"member",
			"public",
		])
			for (const preview of [false, true])
				expect(
					both((model) =>
						model.viewerOf({
							option: {
								...viewing.option,
								value,
								admin:
									value === "owner" || value === "finance" || value === "admin",
							} as never,
							preview,
						}),
					),
				).toSatisfy(([a, b]) => JSON.stringify(a) === JSON.stringify(b));
	});
});

describe("the write functions answer as the Preact ones do", async () => {
	type Writes = typeof import("../../src/app/members/members-writes.ts");
	const mine = await import("../../src/app/members/members-writes.ts");
	const preact = (await import(
		join(packages, "ledger-ui/src/app/members-writes.ts")
	)) as Writes;
	const reader = fixtureReader();
	const people = await reader.people({ schoolId: "vol" });
	const { members } = await reader.members({ schoolId: "vol" });
	const person = people.find(
		({ id }) => id === "m_012",
	) as (typeof people)[number];
	const member = members.find(
		({ profileId }) => profileId === "m_012",
	) as (typeof members)[number];
	const detail = await reader.memberDetail({
		schoolId: "vol",
		personId: "m_012",
	});
	const summary = await reader.membersSummary({ schoolId: "vol" });
	const fake = (answers: Record<string, unknown> = {}, failure?: unknown) => {
		const calls: unknown[] = [];
		const answer =
			(name: string, fallback: unknown) => async (request: unknown) => {
				calls.push({ name, request });
				if (failure !== undefined) throw failure;
				return answers[name] ?? fallback;
			};
		const writer = {
			adjustCredits: answer("adjustCredits", { accepted: true }),
			sendInvoice: answer("sendInvoice", { invoiceId: "in_1", status: "open" }),
			refund: answer("refund", {
				refundId: "re_1",
				status: "succeeded",
				refundedCents: 500,
				remainingCents: 0,
			}),
			cancelBooking: answer("cancelBooking", { accepted: true }),
			recordOutcome: answer("recordOutcome", { creditEffect: "not_wired" }),
			grantFinance: answer("grantFinance", { accepted: true }),
			revokeFinance: answer("revokeFinance", { accepted: true }),
			changeRole: answer("changeRole", { accepted: true }),
			switchTier: answer("switchTier", { accepted: true }),
			cancelMembership: answer("cancelMembership", { accepted: true }),
			resumeMembership: answer("resumeMembership", { accepted: true }),
		};
		return { writer: writer as never, calls };
	};
	const contextOf = (
		writer: never,
		rules: { lateCancel: "spend" | "release"; noShow: "spend" | "release" },
	) => ({
		writer,
		schoolId: "vol",
		schoolName: "Vibes of Light",
		now: "2026-11-05T12:00",
		unit: summary.unit,
		rules,
		person,
		renewal: "Dec 1",
	});
	const ruleSets = [
		{ lateCancel: "spend", noShow: "spend" },
		{ lateCancel: "release", noShow: "release" },
	] as const;
	/** Runs `use` against both copies with equal fakes: the same answer and the same calls to the Writer. */
	const same = async (
		label: string,
		answers: Record<string, unknown>,
		use: (
			writes: Writes,
			context: ReturnType<typeof contextOf>,
		) => Promise<unknown>,
		rules: (typeof ruleSets)[number] = ruleSets[0],
	) => {
		const first = fake(answers);
		const second = fake(answers);
		const [a, b] = [
			await use(mine, contextOf(first.writer, rules)),
			await use(preact, contextOf(second.writer, rules)),
		];
		expect({ label, result: a, calls: first.calls }).toEqual({
			label,
			result: b,
			calls: second.calls,
		});
	};
	test("adjust, invoice, role, plan, cancel and resume", async () => {
		for (const kind of ["goodwill", "gift", "correction"] as const)
			await same(`adjust ${kind}`, {}, (writes, context) =>
				writes.adjustCredits(context, member, {
					kind,
					amount: kind === "correction" ? -1 : 2,
					note: "Make-up",
				}),
			);
		for (const memo of ["", "for the family"])
			await same(`invoice ${memo}`, {}, (writes, context) =>
				writes.sendInvoice(context, member, { addonId: "pack16", memo }),
			);
		for (const change of ["make", "remove", "grant", "revoke"] as const)
			await same(`role ${change}`, {}, (writes, context) =>
				writes.changeRole(context, change),
			);
		await same("switch", {}, (writes, context) =>
			writes.switchPlan(context, member, {
				tierId: "glow",
				label: "Glow ×1",
				quantity: 1,
			}),
		);
		for (const at of ["period_end", "now"] as const)
			for (const reason of ["", "Moved away"])
				await same(`cancel ${at} ${reason}`, {}, (writes, context) =>
					writes.cancelMembership(context, member, {
						at,
						reason,
						available: 3,
					}),
				);
		await same("resume", {}, (writes, context) =>
			writes.resumeMembership(context, member),
		);
	});
	test("refund: every status Stripe answers with, a whole and a partial refund, each kind of payment", async () => {
		for (const status of [
			"pending",
			"succeeded",
			"failed",
			"requires_action",
			"canceled",
		] as const)
			for (const kind of ["membership", "booking", "gift"] as const)
				for (const whole of [true, false]) {
					const payment = {
						paymentIntentId: "pay_1",
						description: "Invoice",
						amountCents: 5000,
						refundedCents: 0,
						kind,
						bookingId: kind === "booking" ? "bk_5kd" : null,
					};
					const first = fake({
						refund: {
							refundId: "re_1",
							status,
							refundedCents: 500,
							remainingCents: 0,
						},
					});
					const second = fake({
						refund: {
							refundId: "re_1",
							status,
							refundedCents: 500,
							remainingCents: 0,
						},
					});
					const attempt = async (writes: Writes, writer: never) => {
						try {
							return {
								value: await writes.refundPayment(
									contextOf(writer, ruleSets[0]),
									payment,
									{ amountCents: 500, whole, note: "Duplicate" },
								),
							};
						} catch (error) {
							const thrown = error as { message?: string; reason?: string };
							return { thrown: thrown.reason ?? thrown.message };
						}
					};
					expect({
						status,
						kind,
						whole,
						result: await attempt(mine, first.writer),
						calls: first.calls,
					}).toEqual({
						status,
						kind,
						whole,
						result: await attempt(preact, second.writer),
						calls: second.calls,
					});
				}
	});
	test("release and outcome: inside and outside the cutoff, quick or from a dialog, held credits or none, both rules", async () => {
		const held = detail.bookings.find(
			({ creditsHeld }) => creditsHeld > 0,
		) as (typeof detail.bookings)[number];
		const free = { ...held, creditsHeld: 0 };
		for (const rules of ruleSets)
			for (const booking of [held, free]) {
				for (const waive of [true, false])
					for (const inside of [true, false])
						for (const quick of [true, false])
							await same(
								"release",
								{},
								(writes, context) =>
									writes.releaseHold(context, booking, {
										waive,
										inside,
										quick,
									}),
								rules,
							);
				for (const state of ["attended", "no_show"] as const)
					await same(
						`outcome ${state}`,
						{},
						(writes, context) => writes.recordOutcome(context, booking, state),
						rules,
					);
			}
		expect(mine.releasable(detail, person, new Set())).toEqual(
			preact.releasable(detail, person, new Set()),
		);
		expect(mine.releasable(detail, person, new Set(["bk_5kd"]))).toEqual(
			preact.releasable(detail, person, new Set(["bk_5kd"])),
		);
	});
	test("a write the Writer refuses is refused by both with the very error it threw", async () => {
		const failure = new Error("offline");
		const attempts = [
			(writes: Writes, context: ReturnType<typeof contextOf>) =>
				writes.adjustCredits(context, member, {
					kind: "gift",
					amount: 1,
					note: "x",
				}),
			(writes: Writes, context: ReturnType<typeof contextOf>) =>
				writes.sendInvoice(context, member, { addonId: "pack16", memo: "" }),
			(writes: Writes, context: ReturnType<typeof contextOf>) =>
				writes.changeRole(context, "make"),
			(writes: Writes, context: ReturnType<typeof contextOf>) =>
				writes.resumeMembership(context, member),
		];
		for (const attempt of attempts)
			for (const writes of [mine, preact])
				await expect(
					attempt(writes, contextOf(fake({}, failure).writer, ruleSets[0])),
				).rejects.toBe(failure);
	});
});

describe("the menu's items answer as the Preact menu's do", async () => {
	const ui = join(packages, "ledger-ui/src/app/member-menu.tsx");
	const source = readFileSync(ui, "utf8");
	// The Preact menu's own function, lifted out of its component file (which imports Preact) and run on this package's model.
	const lifted = `import { type Capabilities, type Member, type MemberDetail, type Person, previewLock } from "../../ledger-ui/src/data/members.ts";
import { type Change, capabilityReason, changeWaiting, pendingBookingIds, type RoleChange, roleGuard, standingOf, type Viewer } from "../src/app/members/members-model.ts";
import { releasable } from "../src/app/members/members-writes.ts";
type IconName = string;
${source.slice(source.indexOf("/** The actions of the"), source.indexOf("/** The ⋯ button of a row"))}
export { menuItems };
`;
	mkdirSync(join(import.meta.dir, "../../tmp"), { recursive: true });
	const liftedPath = join(import.meta.dir, "../../tmp/preact-menu-items.ts");
	writeFileSync(liftedPath, lifted);
	const preactItems = (await import(liftedPath)) as {
		menuItems: typeof menuItemsOfMine;
	};
	const { menuItems: menuItemsOfMine } = await import(
		"../../src/app/members/menu-items.ts"
	);
	test("every fixture person, with and without a change on its way, viewed by the owner, a finance admin and in a preview", async () => {
		let compared = 0;
		for (const schoolId of ["vol", "b4u", "map", "har"]) {
			const query = { schoolId };
			const [people, { members }, capabilities] = await Promise.all([
				reader.people(query),
				reader.members(query),
				reader.capabilities(query),
			]);
			const none = {
				...capabilities,
				actions: Object.fromEntries(
					Object.keys(capabilities.actions).map((name) => [
						name,
						{ allowed: false, reason: "not_built" },
					]),
				),
			};
			for (const person of people) {
				const member =
					members.find(({ profileId }) => profileId === person.id) ?? null;
				const detail = person.planHolder
					? await reader.memberDetail({ schoolId, personId: person.id })
					: {
							bookings: [],
							payments: [],
							refundable: [],
							history: [],
							stripeDashboardUrl: null,
						};
				const pending: svelteModel.Change[][] = [
					[],
					[
						{ kind: "role", personId: person.id, role: "make" },
						{ kind: "booking", bookingId: detail.bookings[0]?.id ?? "bk_x" },
						...(member
							? [
									{
										kind: "membership",
										membershipId: member.membershipId,
										personId: person.id,
										change: "cancel_period_end",
									} as const,
								]
							: []),
					],
					member
						? [
								{
									kind: "membership",
									membershipId: member.membershipId,
									personId: person.id,
									change: "cancel_now",
								},
							]
						: [],
				];
				for (const changes of pending)
					for (const viewer of [
						{ subject: "owner", preview: false, roster: true, finance: true },
						{ subject: "finance", preview: false, roster: true, finance: true },
						{ subject: "admin", preview: false, roster: true, finance: false },
						{ subject: "owner", preview: true, roster: true, finance: true },
					] as const)
						for (const caps of [capabilities, none]) {
							const context = {
								person,
								people,
								member,
								detail,
								capabilities: caps,
								viewer,
								changes,
								creditUnit: "sessions",
							} as Parameters<typeof menuItemsOfMine>[0];
							expect(menuItemsOfMine(context)).toEqual(
								preactItems.menuItems(context),
							);
							compared += 1;
						}
			}
		}
		expect(compared).toBeGreaterThan(300);
	});
});
