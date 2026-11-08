import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AdapterError } from "$contract/http/errors.ts";
import {
	codeMessages,
	kindMessages,
	messageFor,
	serverCodes,
} from "../../src/effect/messages.ts";
import { toUiError, UiError } from "../../src/effect/ui-error.ts";

/** The kinds as the contract writes them (packages/ledger-ui/src/http/errors.ts), read from its source so that a
 * kind added there and missing here fails this test, whatever this package's lists say. */
const contractKinds = (): string[] => {
	const source = readFileSync(
		join(import.meta.dir, "../../../ledger-ui/src/http/errors.ts"),
		"utf8",
	);
	const union =
		/export type AdapterErrorKind =([^;]+);/.exec(source)?.[1] ?? "";
	return [...union.matchAll(/"([a-z_]+)"/g)].map((match) => match[1] ?? "");
};

describe("the message table", () => {
	test("the contract's kinds are read", () => {
		expect(contractKinds().length).toBeGreaterThan(10);
	});
	test("every AdapterErrorKind of the contract has an entry", () => {
		const missing = contractKinds().filter((kind) => !(kind in kindMessages));
		expect(missing).toEqual([]);
	});
	test("unexpected has an entry", () => {
		expect(kindMessages.unexpected.title).toBeTruthy();
	});
	test("every server code of S9-plan section 5 has an entry", () => {
		expect([...serverCodes]).toEqual([
			"stale_etag",
			"invalid_config",
			"step_up_required",
			"owner_only",
			"finance_required",
			"audience_not_allowed",
			"stripe_permission_missing",
		]);
		for (const code of serverCodes) expect(codeMessages[code]).toBeDefined();
	});
	test("every entry says what happened and what to do", () => {
		const entries = [
			...Object.values(kindMessages),
			...Object.values(codeMessages),
		];
		for (const entry of entries) {
			expect(entry.title.length).toBeGreaterThan(0);
			expect(entry.what).toBeTruthy();
			expect(entry.doThis).toBeTruthy();
		}
	});
	test("unavailable says the ledger is catching up, with Retry", () => {
		const message = messageFor(
			toUiError(new AdapterError("unavailable", "503", { status: 503 })),
		);
		expect(message.title).toBe("The ledger is catching up");
		expect(message.what).toBe("Try again in a minute.");
		expect(message.action).toBe("retry");
	});
	test("a server code wins over its kind", () => {
		const error = toUiError(
			new AdapterError("forbidden", "403", { status: 403, code: "owner_only" }),
		);
		expect(messageFor(error).title).toBe("Owners only");
		const stale = toUiError(
			new AdapterError("conflict", "412", { status: 412, code: "stale_etag" }),
		);
		expect(messageFor(stale)).toMatchObject({
			title: "Someone changed this. Review their change",
			action: "reload",
		});
	});
	test("step_up asks to confirm it is you", () => {
		const error = toUiError(
			new AdapterError("step_up", "403", { code: "step_up_required" }),
		);
		expect(messageFor(error)).toMatchObject({
			title: "Confirm it is you",
			action: "confirm_identity",
		});
	});
	test("pin_locked says how long to wait", () => {
		const error = toUiError(
			new AdapterError("pin_locked", "429", { retryAfterSeconds: 125 }),
		);
		expect(messageFor(error).doThis).toBe("Wait 2 min 5 s, then try again.");
		const minute = toUiError(
			new AdapterError("pin_locked", "429", { retryAfterSeconds: 60 }),
		);
		expect(messageFor(minute).doThis).toBe("Wait 1 minute, then try again.");
	});
	test("invalid_config counts its problems and points at the fields", () => {
		const error = new UiError({
			kind: "bad_request",
			detail: {
				code: "invalid_config",
				problems: [
					{ path: "contact.email", message: "Not an email address" },
					{ path: "embed.origin", message: "Must start with https://" },
				],
			},
			reason: "422",
			retryable: false,
		});
		expect(messageFor(error)).toMatchObject({
			what: "2 fields need a change.",
			action: "show_problems",
		});
	});
});
