import { afterEach, expect, test } from "bun:test";
import { consequenceLine } from "../../src/app/booking-text.ts";
import {
	refundCanceledToast,
	refundRequiresActionToast,
} from "../../src/app/members-writes.ts";
import type { Member, RefundResult } from "../../src/data/members.ts";
import type { Reader } from "../../src/data/reader.ts";
import type { School } from "../../src/data/types.ts";
import type { Writer } from "../../src/data/writer.ts";
import { createFixtureReader } from "../../src/fixtures/reader.ts";
import { createFixtureWriter } from "../../src/fixtures/writer.ts";
import { clockAt } from "../../src/http/browser.ts";
import {
	cleanUp,
	click,
	clock,
	count,
	element,
	fill,
	open,
	settle,
	text,
} from "../s5/helpers.ts";

/**
 * The S8e contract nulls: what the real routes answer as null or do not send (S8-contract §8, §11). The UI shows each
 * as "—" or not available, never as 0 and never as a value it made up.
 */
afterEach(cleanUp);

const base = createFixtureReader({ clock });
const noBadges = (school: School): School => ({
	...school,
	attentionCount: null,
	tabBadges: null,
});

test("no presets: the Dashboard renders its document and no scenario control", async () => {
	const { presets } = await base.dashboardOptions();
	const reader: Reader = {
		...base,
		dashboardOptions: async () => ({ presets: [] }),
		/* The fixture's documents are per preset: the preset-less query reads the first one. */
		kpiDocument: (query) =>
			base.kpiDocument({
				...query,
				preset: query.preset || (presets[0]?.id ?? ""),
			}),
	};
	await open("#/b4u/dashboard?as=governance", { reader });
	expect(count("[data-test=pane]")).toBe(1);
	expect(count('[aria-label="Fixture scenario"]')).toBe(0);
	expect(count("[data-test=preset-option]")).toBe(0);
});

test("null badges: no tab badge and no attention count, never 0", async () => {
	const reader: Reader = {
		...base,
		schools: async () => (await base.schools()).map(noBadges),
	};
	await open("#/vol/bookings", { reader });
	expect(count("[data-test=tab-badge]")).toBe(0);
	await click("[data-test=school-switcher]");
	const options = [
		...document.querySelectorAll("[data-test=school-option]"),
	].filter((option) => option.getAttribute("data-school") !== "all");
	expect(options.length).toBeGreaterThan(0);
	for (const option of options) {
		const badges = [...option.querySelectorAll(".badge")].map(
			(badge) => badge.textContent ?? "",
		);
		expect(badges.filter((badge) => /^\d+$/.test(badge))).toEqual([]);
		expect(option.textContent ?? "").not.toContain("need attention");
	}
});

test("a null attention count shows the Plans strip's Need attention as —", async () => {
	const reader: Reader = {
		...base,
		schools: async () => (await base.schools()).map(noBadges),
	};
	await open("#/vol/plans", { reader });
	expect(
		text(
			"[data-test=plan-stat][data-stat=attention] [data-test=plan-stat-value]",
		),
	).toBe("—");
});

test("a null grantedBy reads through the seam as null", async () => {
	const reader: Reader = {
		...base,
		financeGrants: async (query) =>
			(await base.financeGrants(query)).map((grant) => ({
				...grant,
				grantedBy: null,
			})),
	};
	const grants = await reader.financeGrants({ schoolId: "vol" });
	for (const grant of grants) expect(grant.grantedBy).toBeNull();
});

test("a null currentPeriodEnd shows as — in the table and the drawer, never a date", async () => {
	const withoutPeriod = (member: Member): Member =>
		member.profileId === "m_012"
			? { ...member, currentPeriodEnd: null, cancelAtPeriodEnd: true }
			: { ...member, currentPeriodEnd: null };
	const reader: Reader = {
		...base,
		members: async (query) => {
			const page = await base.members(query);
			return { ...page, members: page.members.map(withoutPeriod) };
		},
	};
	await open("#/vol/members?theme=light", { reader });
	const row = "[data-test=member-row][data-id=m_012]";
	expect(text(`${row} [data-test=status-badge]`)).toBe("Cancels —");
	await click(`${row} .member-open`);
	expect(text("[data-test=renews-badge]")).toBe("ends —");
	cleanUp();
	await open("#/vol/members?theme=light", { reader });
	await click("[data-test=member-row][data-id=m_093] .member-open");
	expect(text("[data-test=renews-badge]")).toBe("renews —");
});

test("null school rules: Release hold inside the cutoff makes no late-cancel offer", async () => {
	const reader: Reader = {
		...base,
		schoolRules: async () => ({ rules: null, unit: null }),
	};
	const writer = createFixtureWriter({ mode: "instant" });
	await open("#/vol/bookings", { reader, writer });
	await click(
		"[data-test=booking-action][data-action=release][data-booking=bk_5kd]",
	);
	expect(count("[data-test=dialog]")).toBe(0);
	expect(count("[data-test=waive-cutoff]")).toBe(0);
	expect(writer.calls.map(({ method }) => method)).toEqual(["cancelBooking"]);
	expect(writer.calls[0]?.args[0]).not.toHaveProperty("waiveCutoff");
});

test("null school rules: the consequence line claims no rule and Reports shows not available", async () => {
	const input = {
		waive: false,
		rules: null,
		booking: {
			billing: { kind: "held" as const, credits: 2 },
			cutoffMinutes: 24 * 60,
		},
		creditUnit: { one: "session", other: "sessions" },
		memberName: "Ivy N.",
	};
	expect(consequenceLine({ ...input, action: "release" })).toBeNull();
	const noShow = consequenceLine({ ...input, action: "noshow" });
	expect(noShow?.before).toContain("not available");
	expect(`${noShow?.before}${noShow?.strong}${noShow?.after}`).not.toMatch(
		/spent|forfeit|returns?/,
	);
	const reader: Reader = {
		...base,
		schoolRules: async () => ({ rules: null, unit: null }),
	};
	await open("#/vol/reports", { reader });
	for (const rule of ["cutoff", "no-show", "late-cancel"])
		expect(text(`[data-test=report-rule][data-rule=${rule}] td.r`)).toBe(
			"Not available",
		);
	expect(text("[data-test=report-rules]")).not.toContain("hours before");
});

test("Publish passes the PIN typed in the review to publishMenu", async () => {
	const fixture = createFixtureWriter({ mode: "instant" });
	const published: unknown[][] = [];
	const writer: Writer = {
		...fixture,
		publishMenu: async (...args) => {
			published.push(args);
			await fixture.publishMenu(...args);
		},
	};
	await open("#/vol/plans?mode=code&theme=light", { writer });
	const original = element<HTMLTextAreaElement>("[data-test=plan-yaml]").value;
	await fill(
		"[data-test=plan-yaml]",
		original.replace("      month: 70\n", "      month: 71\n"),
	);
	await click("[data-test=plan-review]");
	await fill("[data-test=plan-publish-pin]", "1234");
	await click("[data-test=plan-publish-go]");
	await settle();
	expect(published).toEqual([["vol", "1234"]]);
	// The fixture Writer records no PIN.
	expect(
		fixture.calls.find(({ method }) => method === "publishMenu")?.args,
	).toEqual(["vol"]);
});

const refundWith = async (status: RefundResult["status"]): Promise<void> => {
	const fixture = createFixtureWriter({ mode: "instant" });
	const writer: Writer = {
		...fixture,
		refund: async (request) => ({
			...(await fixture.refund(request)),
			status,
		}),
	};
	await open("#/vol/members?theme=light", { writer });
	await click(
		'[data-test=member-row][data-id="m_012"] [data-test=member-menu-button]',
	);
	await click("[data-test=member-menu-item][data-action=refund]");
	await fill("[data-test=modal-field][data-field=typed]", "117.00");
	await fill("[data-test=modal-field][data-field=note]", "duplicate charge");
	await click("[data-test=modal-confirm]");
};

test("a refund Stripe holds for the customer says so and shows pending", async () => {
	await refundWith("requires_action");
	expect(text("[data-test=toast]")).toBe(refundRequiresActionToast);
	expect(count("[data-test=modal-confirm]")).toBe(0);
});

test("a refund Stripe canceled says nothing was refunded and shows no pending refund", async () => {
	await refundWith("canceled");
	expect(text("[data-test=toast]")).toBe(refundCanceledToast);
	expect(text("[data-test=toast]")).not.toContain("$");
	expect(count("[data-test=modal-confirm]")).toBe(0);
});

test("the HTTP build's clock is the mount's instant in the school's time zone", () => {
	const seconds = Date.UTC(2026, 10, 6, 17) / 1000;
	expect(clockAt(seconds, "America/Denver")).toEqual({
		today: "2026-11-06",
		now: "2026-11-06T10:00",
	});
	expect(clockAt(seconds, "Asia/Tokyo")).toEqual({
		today: "2026-11-07",
		now: "2026-11-07T02:00",
	});
});
