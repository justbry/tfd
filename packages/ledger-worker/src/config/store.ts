/**
 * The config objects in R2: `schools/<id>/config/<name>.json`, written only through the conditional puts below, the
 * month's audit file `config/audit/YYYY-MM.jsonl` (one line per accepted write) and `config/manifest.json` (the hash, size
 * and last writer of each object). The manifest is rebuilt from the objects' own bytes, so a write that died between its
 * object and its manifest is repaired by the next one.
 */

import type { Store } from "../data/store-io.js";
import {
	bytesOf,
	canonicalJson,
	canonicalLine,
	sha256Hex,
} from "./canonical.js";
import {
	CONFIG_NAMES,
	type ConfigManifest,
	type ConfigName,
	type ManifestEntry,
	SCHEMA_VERSION,
} from "./types.js";

const decoder = new TextDecoder();
const MAX_ATTEMPTS = 5;
const MONTH_LENGTH = 7;
/** The manifest's `updatedBy` for a change nobody claimed (a hand edit found when the manifest is rebuilt). */
export const UNKNOWN_WRITER = "unknown";

export const configKey = (
	school: string,
	name: ConfigName | "manifest",
): string => `schools/${school}/config/${name}.json`;
export const auditKey = (school: string, month: string): string =>
	`schools/${school}/config/audit/${month}.jsonl`;

const isStoreError = (error: unknown, name: string): boolean =>
	error instanceof Error && error.name === name;

/** A conditional put that did not take: someone else wrote first (or deleted the object). */
const isLostRace = (error: unknown): boolean =>
	isStoreError(error, "Stale") ||
	isStoreError(error, "AlreadyExists") ||
	isStoreError(error, "NotFound");

export type StoredConfig = {
	text: string;
	/** The sha256 of the bytes: the ETag the routes speak. */
	sha256: string;
	bytes: number;
	/** The store's own ETag, for the conditional put. */
	etag: string;
};

/** The object as stored, or null when it is not there. */
export const readStored = async (
	store: Store,
	key: string,
): Promise<StoredConfig | null> => {
	try {
		const object = await store.get(key);
		return {
			text: decoder.decode(object.body),
			sha256: await sha256Hex(object.body),
			bytes: object.body.length,
			etag: object.etag,
		};
	} catch (error) {
		if (isStoreError(error, "NotFound")) return null;
		throw error;
	}
};

export type Expectation = { kind: "absent" } | { kind: "etag"; etag: string };

/** Writes `text` if the object still is what `expect` says; false when someone else got there first. */
export const putConditionally = async (
	store: Store,
	key: string,
	text: string,
	expect: Expectation,
): Promise<boolean> => {
	try {
		if (expect.kind === "absent") await store.putIfAbsent(key, bytesOf(text));
		else await store.putIfMatch(key, bytesOf(text), expect.etag);
		return true;
	} catch (error) {
		if (isLostRace(error)) return false;
		throw error;
	}
};

export const expectationOf = (current: StoredConfig | null): Expectation =>
	current === null ? { kind: "absent" } : { kind: "etag", etag: current.etag };

export type AuditLine = {
	at: string;
	/** The writer, opaque: never a profile id. */
	by: string;
	name: ConfigName;
	before: string | null;
	after: string;
};

/** Appends one line to the month's audit file; the put is conditional, so two writers each keep their line. */
export const appendAudit = async (
	store: Store,
	school: string,
	line: AuditLine,
): Promise<void> => {
	const key = auditKey(school, line.at.slice(0, MONTH_LENGTH));
	const entry = `${canonicalLine(line)}\n`;
	for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
		const current = await readStored(store, key);
		const text = `${current?.text ?? ""}${entry}`;
		if (await putConditionally(store, key, text, expectationOf(current)))
			return;
	}
	throw new Error("the audit file kept changing");
};

const readManifest = async (
	store: Store,
	school: string,
): Promise<{ stored: StoredConfig | null; manifest: ConfigManifest }> => {
	const stored = await readStored(store, configKey(school, "manifest"));
	const empty: ConfigManifest = { schemaVersion: SCHEMA_VERSION, objects: {} };
	if (stored === null) return { stored, manifest: empty };
	try {
		const parsed = JSON.parse(stored.text) as ConfigManifest;
		return {
			stored,
			manifest:
				typeof parsed === "object" &&
				parsed !== null &&
				typeof parsed.objects === "object"
					? parsed
					: empty,
		};
	} catch {
		return { stored, manifest: empty };
	}
};

/** `changed`: the manifest differs from what is stored (and, unless `dryRun`, was written: `wrote`). */
export type ManifestWrite = {
	wrote: boolean;
	changed: boolean;
	sha256: string;
};

/**
 * Brings the manifest in line with the objects: an entry whose hash is still the object's hash keeps its time and writer;
 * any other gets `now` and `by` (the object named in `changed`) or `UNKNOWN_WRITER`. Writes only when the canonical
 * manifest differs from the stored one, so a run that changed nothing changes no byte.
 */
export const updateManifest = async (
	store: Store,
	school: string,
	options: { now: string; by: string; changed?: ConfigName; dryRun?: boolean },
): Promise<ManifestWrite> => {
	for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
		const { stored, manifest } = await readManifest(store, school);
		const objects: Partial<Record<ConfigName, ManifestEntry>> = {};
		for (const name of CONFIG_NAMES) {
			const object = await readStored(store, configKey(school, name));
			if (object === null) continue;
			const previous = manifest.objects[name];
			objects[name] =
				previous !== undefined && previous.sha256 === object.sha256
					? { ...previous, bytes: object.bytes }
					: {
							sha256: object.sha256,
							bytes: object.bytes,
							updatedAt: options.now,
							updatedBy:
								options.changed === undefined || options.changed === name
									? options.by
									: UNKNOWN_WRITER,
						};
		}
		const text = canonicalJson({ schemaVersion: SCHEMA_VERSION, objects });
		const sha256 = await sha256Hex(bytesOf(text));
		if (stored?.sha256 === sha256)
			return { wrote: false, changed: false, sha256 };
		if (options.dryRun === true) return { wrote: false, changed: true, sha256 };
		if (
			await putConditionally(
				store,
				configKey(school, "manifest"),
				text,
				expectationOf(stored),
			)
		)
			return { wrote: true, changed: true, sha256 };
	}
	throw new Error("the manifest kept changing");
};
