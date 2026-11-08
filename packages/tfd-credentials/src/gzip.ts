/**
 * GZIP (RFC 1952) through the Compression Streams API, which Bun, Node 18+, Cloudflare Workers and current browsers
 * all provide, so no inflate code ships here. Decompression stops at a byte cap: an `encodedList` comes from the
 * network and a few hundred bytes of gzip can expand to gigabytes.
 */
import { CredentialsError } from "./errors.js";

const readAll = async (
	stream: ReadableStream<Uint8Array>,
	maxBytes: number,
): Promise<Uint8Array> => {
	const reader = stream.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		total += value.length;
		if (total > maxBytes) {
			await reader.cancel();
			throw new CredentialsError(
				"gzip_failed",
				`inflates past ${maxBytes} bytes`,
			);
		}
		chunks.push(value);
	}
	const out = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		out.set(chunk, offset);
		offset += chunk.length;
	}
	return out;
};

const pipe = async (
	bytes: Uint8Array,
	transform: CompressionStream | DecompressionStream,
	maxBytes: number,
): Promise<Uint8Array> => {
	const writer = transform.writable.getWriter();
	// Copy into a fresh ArrayBuffer-backed view: some runtimes refuse a view over a SharedArrayBuffer.
	const written = writer
		.write(new Uint8Array(bytes))
		.then(() => writer.close());
	// When the reader gives up at the cap the write side rejects too; that rejection is already reported.
	written.catch(() => undefined);
	const read = readAll(
		transform.readable as ReadableStream<Uint8Array>,
		maxBytes,
	);
	try {
		const [, out] = await Promise.all([written, read]);
		return out;
	} catch (error) {
		if (error instanceof CredentialsError) throw error;
		throw new CredentialsError(
			"gzip_failed",
			error instanceof Error ? error.message : "gzip failed",
		);
	}
};

const UNLIMITED = Number.MAX_SAFE_INTEGER;

export const gzip = (bytes: Uint8Array): Promise<Uint8Array> =>
	pipe(bytes, new CompressionStream("gzip"), UNLIMITED);

export const gunzip = (
	bytes: Uint8Array,
	maxBytes: number,
): Promise<Uint8Array> =>
	pipe(bytes, new DecompressionStream("gzip"), maxBytes);
