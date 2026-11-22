import { Database } from "bun:sqlite";
import type { NoteTerms, Role } from "tfd-notes";
import type { CloudEnv } from "../src/env";
import { MemoryNoteStore } from "../src/notes/memory-store";
import { NoteDO } from "../src/notes/note-do";
import type { Clock, IdSource, MailSender } from "../src/notes/ports";
import { NoteService, type NoteServiceDeps } from "../src/notes/service";
import type { ActiveSession } from "../src/notes/sessions";
import type { NoteStore } from "../src/notes/store";
import { durableState, fakeEnv } from "./fakes";

export type SentMail = { to: string; subject: string; text: string };

/** Records every email instead of sending it. `failNext` makes the next send throw. */
export class RecordingMailer implements MailSender {
	readonly sent: SentMail[] = [];
	failNext = false;

	async send(message: SentMail): Promise<void> {
		if (this.failNext) {
			this.failNext = false;
			throw new Error("mail down");
		}
		this.sent.push(message);
	}

	to(email: string): SentMail[] {
		return this.sent.filter((message) => message.to === email);
	}

	/** The token in the newest link emailed to `email`. */
	linkTokenFor(email: string): string {
		const text = this.to(email).at(-1)?.text ?? "";
		const token = /[?&]t=([A-Za-z0-9_-]+)/.exec(text)?.[1];
		if (!token) throw new Error(`no link emailed to ${email}`);
		return token;
	}

	/** The newest link emailed to `email`, as a URL. */
	linkFor(email: string): string {
		const text = this.to(email).at(-1)?.text ?? "";
		const url = /(https:\/\/\S+\/enter\?t=[A-Za-z0-9_-]+)/.exec(text)?.[1];
		if (!url) throw new Error(`no link emailed to ${email}`);
		return url;
	}

	/** The 6-digit code in the newest email to `email`. */
	codeFor(email: string): string {
		const text = this.to(email).at(-1)?.text ?? "";
		const code = /\b(\d{6})\b/.exec(text)?.[1];
		if (!code) throw new Error(`no code emailed to ${email}`);
		return code;
	}
}

export class SettableClock implements Clock {
	constructor(private instant = "2026-11-22T09:00:00.000Z") {}
	now(): string {
		return this.instant;
	}
	set(instant: string): void {
		this.instant = instant;
	}
	advance(ms: number): void {
		this.instant = new Date(Date.parse(this.instant) + ms).toISOString();
	}
}

/** Unique, repeatable ids and tokens. Tokens are base64url-safe, so they travel in a link like real ones. */
export class DeterministicIds implements IdSource {
	private counter = 0;
	next(): string {
		this.counter += 1;
		return `id${this.counter}`;
	}
	token(bytes: number): string {
		this.counter += 1;
		return `tok${this.counter}x${"a".repeat(bytes)}`;
	}
}

export const LENDER_EMAIL = "maria@example.com";
export const BORROWER_EMAIL = "ana@example.com";
export const SECRET = "test-session-secret";
export const BASE_URL = "https://staging-ledger.trifold.app";
export const START = "2026-11-22T09:00:00.000Z";

export const TERMS: NoteTerms = {
	currency: "USD",
	exponent: 2,
	principal_minor: "1000000",
	issue_date: "2026-11-01",
	annual_rate: "0.05",
	day_count: "actual/365",
	rounding: "half-up",
	timezone: "America/Denver",
	schedule: {
		type: "amortized",
		frequency: "monthly",
		count: 4,
		first_due: "2026-12-01",
	},
};

export const HOUR = 3_600_000;
export const MINUTE = 60_000;

export type Harness = {
	store: NoteStore;
	mailer: RecordingMailer;
	clock: SettableClock;
	ids: DeterministicIds;
	service: NoteService;
	create: (idem?: string) => Promise<string>;
	enter: (
		noteId: string,
		role: Role,
	) => Promise<{ session: ActiveSession; cookie: string }>;
};

export const harness = (overrides: Partial<NoteServiceDeps> = {}): Harness => {
	const store = overrides.store ?? new MemoryNoteStore();
	const mailer = new RecordingMailer();
	const clock = new SettableClock(START);
	const ids = new DeterministicIds();
	const service = new NoteService({
		store,
		mailer,
		clock,
		ids,
		secret: SECRET,
		baseUrl: BASE_URL,
		...overrides,
	});
	const create = async (idem = "idem-1"): Promise<string> => {
		const result = await service.createNote({
			terms: TERMS,
			lender: { email: LENDER_EMAIL },
			borrower: { email: BORROWER_EMAIL },
			idem,
		});
		if (!result.ok) throw new Error(`create failed: ${result.message}`);
		return result.noteId;
	};
	const enter = async (noteId: string, role: Role) => {
		const email = role === "lender" ? LENDER_EMAIL : BORROWER_EMAIL;
		const opened = await service.sessions.redeem(
			noteId,
			mailer.linkTokenFor(email),
		);
		if (!opened) throw new Error("link did not open");
		const session = await service.sessions.resolve(noteId, opened.cookieValue);
		if (!session) throw new Error("session did not resolve");
		return { session, cookie: opened.cookieValue };
	};
	return { store, mailer, clock, ids, service, create, enter };
};

/** A namespace over real `NoteDO` objects, one SQLite database each, like the Worker's `NOTE` binding. */
export const noteNamespace = (env: CloudEnv) => {
	const objects = new Map<string, NoteDO>();
	return {
		idFromName: (name: string) => name,
		get: (id: unknown) => {
			const name = String(id);
			let object = objects.get(name);
			if (!object) {
				object = new NoteDO(durableState(new Database(":memory:")), env);
				objects.set(name, object);
			}
			const target = object;
			return { fetch: (request: Request) => target.fetch(request) };
		},
	};
};

export const LEDGER = "staging-ledger.trifold.app";
export const API = "staging-api.trifold.app";
export const API_KEY = "notes-api-key-for-tests";

/** A staging env with both notes secrets set and (unless `store` is passed to `notesRoute`) real note DOs. */
export const notesEnv = (overrides: Partial<CloudEnv> = {}): CloudEnv => {
	const base: CloudEnv = {
		...fakeEnv(),
		NOTES_SESSION_SECRET: SECRET,
		NOTES_API_KEY: API_KEY,
		...overrides,
	};
	return { ...base, NOTE: overrides.NOTE ?? noteNamespace(base) };
};
