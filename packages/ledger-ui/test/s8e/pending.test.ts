import { describe, expect, test } from "bun:test";
import {
	createPendingStore,
	memoryStorage,
	pendingStorageKey,
} from "../../src/http/pending.ts";
import {
	memoryStore,
	otherSchoolId,
	schoolId,
	sequentialKeys,
} from "./helpers.ts";

const store = (storage = memoryStore()) => ({
	storage,
	pending: createPendingStore({ storage, newKey: sequentialKeys() }),
});

describe("the pending store", () => {
	test("survives a reload: a new store over the same storage reads the same writes", () => {
		const { storage, pending } = store();
		const entry = pending.begin({
			method: "refund",
			school: schoolId,
			request: { amountCents: 2500 },
		});
		pending.accept(entry.id, "2026-11-07T12:05:00.000Z");
		const reloaded = createPendingStore({
			storage,
			newKey: sequentialKeys("other"),
		});
		expect(reloaded.all()).toEqual([
			{
				id: "action-0001",
				method: "refund",
				school: schoolId,
				request: { amountCents: 2500 },
				state: "accepted",
				shipsBy: "2026-11-07T12:05:00.000Z",
			},
		]);
		expect(JSON.parse(storage.getItem(pendingStorageKey) ?? "[]")).toHaveLength(
			1,
		);
	});

	test("the same action still sending reuses its key; a different request or an accepted one does not", () => {
		const { pending } = store();
		const first = pending.begin({
			method: "refund",
			school: schoolId,
			request: { b: 1, a: 2 },
		});
		expect(
			pending.begin({
				method: "refund",
				school: schoolId,
				request: { a: 2, b: 1 },
			}).id,
		).toBe(first.id);
		expect(
			pending.begin({ method: "refund", school: schoolId, request: { a: 3 } })
				.id,
		).not.toBe(first.id);
		pending.accept(first.id, null);
		expect(
			pending.begin({
				method: "refund",
				school: schoolId,
				request: { a: 2, b: 1 },
			}).id,
		).not.toBe(first.id);
	});

	test("clearShipped drops the school's accepted writes the manifest asOf has passed, and only those", () => {
		const { pending } = store();
		const early = pending.begin({
			method: "refund",
			school: schoolId,
			request: 1,
		});
		const late = pending.begin({
			method: "refund",
			school: schoolId,
			request: 2,
		});
		const elsewhere = pending.begin({
			method: "refund",
			school: otherSchoolId,
			request: 3,
		});
		const sending = pending.begin({
			method: "refund",
			school: schoolId,
			request: 4,
		});
		const unknown = pending.begin({
			method: "refund",
			school: schoolId,
			request: 5,
		});
		pending.accept(early.id, "2026-11-07T12:00:00.000Z");
		pending.accept(late.id, "2026-11-07T12:10:00.000Z");
		pending.accept(elsewhere.id, "2026-11-07T12:00:00.000Z");
		pending.accept(unknown.id, null);
		expect(pending.clearShipped(schoolId, "2026-11-07T12:05:00Z")).toBe(1);
		expect(pending.all().map(({ id }) => id)).toEqual([
			late.id,
			elsewhere.id,
			sending.id,
			unknown.id,
		]);
		expect(pending.clearShipped(schoolId, "2026-11-07T12:10:00Z")).toBe(1);
	});

	test("unreadable storage is an empty list, never a crash", () => {
		const storage = memoryStore();
		storage.setItem(pendingStorageKey, "{not json");
		expect(
			createPendingStore({ storage, newKey: sequentialKeys() }).all(),
		).toEqual([]);
		const browser = memoryStorage();
		browser.setItem("k", "v");
		expect(browser.getItem("k")).toBe("v");
	});
});
