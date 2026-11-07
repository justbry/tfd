/** What the endpoint tests share: calling the Worker, and the inputs that `tfd/worker`'s functions are called with directly. */
import type { AtmEvent } from "tfd";
import {
	type Audience,
	buildViews,
	type KpiContributions,
	type KpiDocumentContext,
	type KpiDocumentRow,
	kpiDocument,
	type Views,
} from "tfd/worker";
import { DISCLOSURE_FILE, sizeOf } from "../src/data/disclosure.js";
import { kpiRowsOf } from "../src/data/snapshot.js";
import type { LedgerHarness } from "../src/testing/harness.js";
import type { SeededSchool } from "../src/testing/seed.js";

export type Reply = {
	status: number;
	headers: Headers;
	body: {
		asOf?: string | null;
		lagMinutes?: number | null;
		data?: unknown;
		error?: {
			code: string;
			message: string;
			field?: string;
			retryAfterSeconds?: number;
		};
	};
};

export const call = async (
	harness: Pick<LedgerHarness, "url">,
	token: string | null,
	path: string,
	init: RequestInit = {},
): Promise<Reply> => {
	const response = await fetch(`${harness.url}${path}`, {
		...init,
		headers: {
			...(token === null ? {} : { authorization: `Bearer ${token}` }),
			...(init.headers as Record<string, string> | undefined),
		},
	});
	return {
		status: response.status,
		headers: response.headers,
		body: (await response.json()) as Reply["body"],
	};
};

/** The wire's JSON, as a test reads it back. */
export const wire = <Value>(value: Value): Value =>
	JSON.parse(JSON.stringify(value)) as Value;

export const byId = (a: AtmEvent, b: AtmEvent): number =>
	a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

export const menuOf = (events: readonly AtmEvent[]) =>
	(events.find((event) => event.event_type === "catalog.published")?.payload
		.menu ?? null) as {
		currency: string;
		timeZone: string;
		tiers: { id: string }[];
	} | null;

const localParts = (instant: number, zone: string): string =>
	new Intl.DateTimeFormat("en-CA", {
		timeZone: zone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		hourCycle: "h23",
	})
		.formatToParts(new Date(instant))
		.reduce((text, part) => {
			const order: Record<string, string> = {
				year: "",
				month: "-",
				day: "-",
				hour: "T",
				minute: ":",
			};
			return part.type in order
				? `${text}${order[part.type]}${part.value}`
				: text;
		}, "");

/** The views of a seeded school, built directly from its events as of its `asOf`. */
export const viewsOf = (school: SeededSchool): Views => {
	const built = buildViews([...school.events].sort(byId), {
		school: school.id,
		asOf: new Date(school.asOf),
	});
	if (!built.ok) throw new Error(`${school.id} cannot be replayed`);
	return built.views;
};

/** The inputs `kpiDocument` is called with for a school, worked out here from the events and the views, not by the Worker. */
export const kpiInputs = (school: SeededSchool, now: string) => {
	const events = [...school.events].sort(byId);
	const menu = menuOf(events);
	const zone = menu?.timeZone ?? "UTC";
	const today = localParts(Date.parse(now), zone).slice(0, 10);
	const year = Number(today.slice(0, 4));
	const rows = kpiRowsOf(
		events,
		localParts(Date.parse(school.asOf), zone).slice(0, 7),
	);
	const views = viewsOf(school);
	const months = Array.from(
		{ length: 12 },
		(_, index) => `${year}-${String(index + 1).padStart(2, "0")}`,
	);
	const days = months.map(
		(month) =>
			views.finance.months[month]?.grossByDay ??
			new Array<number>(
				new Date(Date.UTC(year, Number(month.slice(5)), 0)).getUTCDate(),
			).fill(0),
	);
	const contributions: KpiContributions = {};
	for (const month of months)
		for (const [cell, byMonth] of Object.entries(
			views.contributions[month]?.contributions ?? {},
		))
			contributions[cell] = { ...contributions[cell], ...byMonth };
	const tiers = menu?.tiers.map((tier) => tier.id) ?? [];
	const extra = [
		...new Set(
			rows
				.filter((row) => row.kpiId.startsWith("revenue_by_tier:"))
				.map((row) => row.kpiId.slice("revenue_by_tier:".length)),
		),
	]
		.filter((plan) => !tiers.includes(plan))
		.sort();
	const context: KpiDocumentContext = {
		school: school.id,
		currency: menu?.currency ?? "usd",
		clock: { today, now: localParts(Date.parse(school.asOf), zone) },
		days,
		plans: [...tiers, ...extra],
	};
	return { rows, contributions, context, year };
};

export const expectedKpiDocument = (
	school: SeededSchool,
	now: string,
	audience: Audience,
	pinLocked: boolean,
) => {
	const { rows, contributions, context, year } = kpiInputs(school, now);
	return wire(
		kpiDocument(
			rows,
			contributions,
			{ size: sizeOf(rows, year), file: DISCLOSURE_FILE, override: {} },
			audience,
			pinLocked,
			context,
		),
	);
};

export type { KpiDocumentRow };
