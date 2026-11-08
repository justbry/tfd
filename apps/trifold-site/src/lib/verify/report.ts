/**
 * What the verify page says about one check: a fact headline, the four-row checklist (signature, key, books, seal) and
 * the guidance for each outcome. Pure, so the copy is tested without a browser. Copy rules: facts only ("signed with …
 * and unchanged since …"); never that a payment happened, tax status, "fraud", or a witness that doesn't exist yet.
 */
import type { KeyEntry } from "tfd-verify";
import type { Outcome } from "tfd-verify/check";
import { formatAmount, monthName } from "#lib/samples/sample";

/** pass ✓ · fail ✗ · neutral ○ (not bad: unsealed, or couldn't be checked) · skip — (not checked). */
export type RowState = "pass" | "fail" | "neutral" | "skip";

export type CheckRow = {
	id: "signature" | "key" | "books" | "seal";
	/** Plain words. */
	label: string;
	/** The technical name, shown as a mono label. */
	term: string;
	state: RowState;
	note: string;
};

/** pass: everything checked holds. mismatch: something doesn't match. unchecked: couldn't check (calm, not a failure). */
export type Tone = "pass" | "mismatch" | "unchecked";

export type Report = {
	tone: Tone;
	eyebrow: string;
	headline: string;
	body: string;
	/** What to do next, for anything but a pass. */
	guidance: string | null;
	rows: CheckRow[];
	/** Offer "check against a different key list". */
	offerKeys: boolean;
};

export type ReportContext = {
	/** The school's display name for a school id. */
	orgName: (school: string) => string;
	/** The key the receipt names, as the key list has it (undefined when it isn't listed). */
	keyEntry: string | KeyEntry | undefined;
	/** "sample": the page's own demo key list. "custom": a list the visitor pasted. */
	keySource: "sample" | "custom";
	/** When the receipt's month was sealed (the latest good seal's sealed_at), if known. */
	sealedAt: string | null;
};

/** Every result carries this line. */
export const DOESNT_TELL_YOU =
	"It can't tell you that money moved, that the school delivered what was paid for, or how a tax or scholarship program will treat it.";

export const KEY_CAVEAT =
	"It also can't tell you the key is the school's: that holds only if you got the key list from the school or from Trifold.";

const DATE = new Intl.DateTimeFormat("en-US", {
	year: "numeric",
	month: "long",
	day: "numeric",
	timeZone: "UTC",
});
const TIME = new Intl.DateTimeFormat("en-US", {
	hour: "2-digit",
	minute: "2-digit",
	hour12: false,
	timeZone: "UTC",
});

/** "2026-10-03" or an RFC 3339 instant → "October 3, 2026". */
export const formatDate = (value: string): string => {
	const date = new Date(value.length === 10 ? `${value}T00:00:00Z` : value);
	return Number.isNaN(date.getTime()) ? value : DATE.format(date);
};

/** An RFC 3339 instant → "October 3, 2026 at 19:32 UTC". */
export const formatInstant = (value: string): string => {
	const date = new Date(value);
	return Number.isNaN(date.getTime())
		? value
		: `${DATE.format(date)} at ${TIME.format(date)} UTC`;
};

const notChecked = (why: string): Pick<CheckRow, "state" | "note"> => ({
	state: "skip",
	note: `Not checked: ${why}.`,
});

const row = (id: CheckRow["id"], state: RowState, note: string): CheckRow => {
	const names = {
		signature: ["The signature", "sig · Ed25519"],
		key: ["The key", "key_id"],
		books: ["In the school's books", "event_hash"],
		seal: ["The month's seal", "seal"],
	} as const;
	const [label, term] = names[id];
	return { id, label, term, state, note };
};

/** The checklist before anything has run: what will be checked. */
export const PENDING_ROWS: CheckRow[] = [
	row("signature", "skip", "Matches the receipt's exact bytes."),
	row("key", "skip", "Published by the school, not revoked, in date."),
	row("books", "skip", "The same payment is in the school's books, unchanged."),
	row(
		"seal",
		"skip",
		"Its month is sealed. An unsealed month isn't a problem.",
	),
];

const keyPassNote = (entry: ReportContext["keyEntry"]): string => {
	if (typeof entry === "object")
		return entry.not_after
			? `Published for receipts, in use from ${formatDate(entry.not_before)} to ${formatDate(entry.not_after)}, not revoked.`
			: `Published for receipts, in use since ${formatDate(entry.not_before)}, not revoked.`;
	return "Published on the school's key list.";
};

export const reportOf = (outcome: Outcome, context: ReportContext): Report => {
	const entry =
		typeof context.keyEntry === "object" ? context.keyEntry : undefined;
	const offerKeys = false;

	if (outcome.kind === "signed") {
		const { receipt, key_id } = outcome.signed;
		const org = context.orgName(receipt.school);
		const month = monthName(receipt.date.slice(0, 7));
		const owner =
			context.keySource === "sample" ? `${org}'s key` : `the key you supplied`;
		const since =
			receipt.v === 2 ? formatInstant(receipt.issued_at) : "it was signed";
		const amount = `${formatAmount(receipt.amount, receipt.currency)} ${receipt.currency.toUpperCase()}`;
		const kind =
			receipt.event_type === "payment.refunded"
				? "a refund of"
				: "a payment of";
		const body = `It records ${kind} ${amount} on ${formatDate(receipt.date)}, exactly as signed.`;
		const signature = row(
			"signature",
			"pass",
			"Matches the receipt's exact bytes. Change one character and it fails.",
		);
		const key = row("key", "pass", keyPassNote(context.keyEntry));

		if (outcome.books === null) {
			const why = `this page doesn't hold ${org}'s books`;
			return {
				tone: "pass",
				eyebrow: "Signed and unchanged",
				headline: `Signed with ${owner} and unchanged since ${since}.`,
				body,
				guidance: null,
				rows: [
					signature,
					key,
					row("books", "skip", notChecked(why).note),
					row(
						"seal",
						"skip",
						`Not checked here. Ask ${org} for its sealed month to check the rest.`,
					),
				],
				offerKeys,
			};
		}

		if (outcome.books !== "ok") {
			const books =
				outcome.books === "missing_event"
					? row(
							"books",
							"fail",
							`${org}'s books have no entry with this receipt's event id.`,
						)
					: outcome.books === "event_changed"
						? row(
								"books",
								"fail",
								"The entry in the books differs from what this receipt signed.",
							)
						: row(
								"books",
								"fail",
								"The entry in the books is a kind that doesn't get a receipt.",
							);
			const headline =
				outcome.books === "missing_event"
					? `Signed with ${owner}, but ${org}'s books have no record of it.`
					: outcome.books === "event_changed"
						? `Signed with ${owner}, but ${org}'s books now say something different.`
						: `Signed with ${owner}, but the matching entry in the books doesn't get a receipt.`;
			return {
				tone: "mismatch",
				eyebrow: "Signed, but the books don't match",
				headline,
				body: "The receipt itself hasn't changed since it was signed. The school's books don't agree with it.",
				guidance: `Ask ${org} why its books differ from the receipt it signed.`,
				rows: [
					signature,
					key,
					books,
					row("seal", "skip", notChecked("the books don't match").note),
				],
				offerKeys,
			};
		}

		const books = row(
			"books",
			"pass",
			"Found in the school's books, unchanged.",
		);
		const seal = outcome.seal;
		const sealedOn = context.sealedAt
			? ` on ${formatDate(context.sealedAt)}`
			: "";
		if (seal && seal.verdict !== "ok" && seal.verdict !== "superseded") {
			return {
				tone: "mismatch",
				eyebrow: "Signed, but the seal doesn't match",
				headline: `Signed with ${owner} and found in the books, but the ${month} seal doesn't match them.`,
				body: "The receipt and its entry in the books agree. The month's seal doesn't agree with the books.",
				guidance: `Ask ${org} about its ${month} seal: the month's books changed after it was sealed, or the seal is damaged.`,
				rows: [
					signature,
					key,
					books,
					row(
						"seal",
						"fail",
						`The ${month} seal doesn't match the school's books.`,
					),
				],
				offerKeys,
			};
		}
		const sealRow =
			seal?.verdict === "ok" && seal.covers
				? row(
						"seal",
						"pass",
						`${month} was sealed${sealedOn}, and the seal lists this receipt.`,
					)
				: seal?.verdict === "ok"
					? row(
							"seal",
							"neutral",
							`${month} is sealed, but the seal doesn't list this receipt yet.`,
						)
					: row(
							"seal",
							"neutral",
							`${month} isn't sealed yet. That's normal until the month closes.`,
						);
		return {
			tone: "pass",
			eyebrow: "Signed and unchanged",
			headline: `Signed with ${owner} and unchanged since ${since}.`,
			body,
			guidance: null,
			rows: [signature, key, books, sealRow],
			offerKeys,
		};
	}

	const afterSignature = (why: string) => [
		row("books", "skip", notChecked(why).note),
		row("seal", "skip", notChecked(why).note),
	];

	if (outcome.kind === "bad_signature")
		return {
			tone: "mismatch",
			eyebrow: "Doesn't match its signature",
			headline: "This receipt doesn't match its signature.",
			body: "Something in it changed after it was signed, or it was never signed with the key it names. Don't rely on the amount or date it shows.",
			guidance:
				"Ask the school to send the receipt again, straight from its email or portal.",
			rows: [
				row(
					"signature",
					"fail",
					"Doesn't match the receipt's bytes: changed after signing, or signed with another key.",
				),
				row("key", "skip", notChecked("the signature failed first").note),
				...afterSignature("the signature failed"),
			],
			offerKeys,
		};

	if (outcome.kind === "unknown_key")
		return {
			tone: "unchecked",
			eyebrow: "Couldn't check",
			headline: "This receipt names a key this page doesn't have.",
			body: `It says it was signed with key ${outcome.keyId}, which isn't on the key list in use. Without the key, the signature can't be checked either way.`,
			guidance:
				"Ask the school for its published key list, then check the receipt against it.",
			rows: [
				row("signature", "skip", notChecked("no key to check it with").note),
				row("key", "neutral", `Not on this key list: ${outcome.keyId}.`),
				...afterSignature("the signature wasn't checked"),
			],
			offerKeys: true,
		};

	if (outcome.kind === "key_revoked")
		return {
			tone: "mismatch",
			eyebrow: "Key revoked",
			headline: "This receipt was signed with a key the school has revoked.",
			body: "The signature matches, but a revoked key vouches for nothing it signed, before or after it was revoked.",
			guidance: "Ask the school for a receipt signed with its current key.",
			rows: [
				row("signature", "pass", "Matches the receipt's exact bytes."),
				row(
					"key",
					"fail",
					entry?.revoked_at
						? `Revoked on ${formatDate(entry.revoked_at)}: ${outcome.keyId}.`
						: `Revoked: ${outcome.keyId}.`,
				),
				...afterSignature("the key doesn't vouch for it"),
			],
			offerKeys,
		};

	if (outcome.kind === "key_wrong_purpose")
		return {
			tone: "mismatch",
			eyebrow: "Wrong kind of key",
			headline: "This receipt was signed with a key that isn't for receipts.",
			body: `Key ${outcome.keyId} is published for ${entry ? `${entry.purpose}s` : "another purpose"}, so it can't vouch for a receipt.`,
			guidance: "Ask the school for a receipt signed with its receipt key.",
			rows: [
				row("signature", "pass", "Matches the receipt's exact bytes."),
				row(
					"key",
					"fail",
					`Published for ${entry ? `${entry.purpose}s` : "another purpose"}, not receipts.`,
				),
				...afterSignature("the key doesn't vouch for it"),
			],
			offerKeys,
		};

	if (outcome.kind === "outside_key_window")
		return {
			tone: "mismatch",
			eyebrow: "Outside the key's dates",
			headline: "This receipt says it was signed when its key wasn't in use.",
			body: entry
				? `Key ${outcome.keyId} was in use from ${formatDate(entry.not_before)}${entry.not_after ? ` to ${formatDate(entry.not_after)}` : " on"}. The signing time inside the receipt falls outside that.`
				: `The signing time inside the receipt falls outside the dates key ${outcome.keyId} was in use.`,
			guidance: "Ask the school for a re-signed receipt.",
			rows: [
				row("signature", "pass", "Matches the receipt's exact bytes."),
				row("key", "fail", "Not in use at the time the receipt was signed."),
				...afterSignature("the key doesn't vouch for it"),
			],
			offerKeys,
		};

	if (outcome.kind === "key_requires_v2")
		return {
			tone: "unchecked",
			eyebrow: "Couldn't check",
			headline: "This receipt is in an older format its key doesn't accept.",
			body: `Key ${outcome.keyId} only vouches for receipts that record when they were signed. This one doesn't, so it can't be matched to the key's dates.`,
			guidance: "Ask the school for a current copy of the receipt.",
			rows: [
				row("signature", "pass", "Matches the receipt's exact bytes."),
				row(
					"key",
					"neutral",
					"Has dates; this receipt doesn't say when it was signed.",
				),
				...afterSignature("the key doesn't vouch for it"),
			],
			offerKeys,
		};

	return {
		tone: "unchecked",
		eyebrow: "Couldn't check",
		headline: "This isn't a Trifold receipt.",
		body: "It's missing fields, has extra ones, or isn't valid JSON. Check that you copied the whole receipt.",
		guidance:
			"Open the receipt link from the school's email, or ask the school for the receipt file.",
		rows: PENDING_ROWS.map((pending) => ({ ...pending, note: "" })),
		offerKeys,
	};
};
