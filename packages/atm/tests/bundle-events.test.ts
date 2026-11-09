/** `bundleLog`: a committed bundle as the event log a shipper would hold, led by one `catalog.published` per menu version. */
import { describe, expect, test } from "bun:test";
import { membersOf } from "../src/ledger/summary.js";
import { bundleLog } from "../src/scenario/bundle-events.js";

describe("bundleLog", () => {
	test("a bundle on two menu versions publishes both, and its members replay under their own", async () => {
		const log = await bundleLog("credits-menu-version");
		expect(log.versions).toEqual(["1", "2"]);
		const published = log.events.filter(
			(event) => event.event_type === "catalog.published",
		);
		expect(published.map((event) => event.payload.version)).toEqual([1, 2]);
		expect(log.events.slice(0, 2)).toEqual(published);
		const last = log.events
			.map((event) => event.event_time)
			.sort()
			.at(-1);
		const result = membersOf(log.events, new Date(String(last)));
		if (!result.ok) throw new Error(result.error.message);
		expect(
			Object.values(result.members).map((member) => [
				member.key,
				member.plan,
				member.features.visit?.available,
			]),
		).toEqual([
			["family:fam_8k2", "sparkle-2@v1", 4],
			["family:fam_b2", "sparkle-2@v2", 3],
		]);
	});

	test("a bundle with one menu publishes version 1", async () => {
		const log = await bundleLog("credits-adjust-never-expires");
		expect(log.versions).toEqual(["1"]);
		expect(
			log.events.some((event) => event.event_type === "credit.adjusted"),
		).toBe(true);
	});

	test("an unknown bundle is refused", async () => {
		await expect(bundleLog("no-such-bundle")).rejects.toThrow();
	});
});
