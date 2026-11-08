/**
 * The signet's geometry: a receipt's fingerprint and the guilloché rosette drawn from it. The fingerprint is the first
 * 8 hex of SHA-256 over the receipt's signed bytes (canonical JSON, keys sorted), so a changed receipt, even one with the
 * same event, gets a different rosette, and anyone can recompute it:
 *
 *   jq -jcS .receipt receipt.json | shasum -a 256 | cut -c1-8
 */

export const FINGERPRINT_COMMAND =
	"jq -jcS .receipt receipt.json | shasum -a 256 | cut -c1-8";

/** "cc2803f8" → "cc28 03f8". */
export const groupFingerprint = (fingerprint: string): string =>
	`${fingerprint.slice(0, 4)} ${fingerprint.slice(4, 8)}`;

/** mulberry32: a small, fast, deterministic generator. Same seed, same rosette, everywhere. */
const generator = (seed: number) => {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
};

export const CENTER = 120;
const TAU = Math.PI * 2;

export type Band = {
	/** Mean radius in the 240-unit viewBox. */
	radius: number;
	amplitude: number;
	/** Each band is drawn this many times, slightly rotated, which weaves the lattice. */
	copies: number;
};

/** Two woven bands for a full-size signet, one for a small one. */
export const BANDS_FULL: Band[] = [
	{ radius: 106.5, amplitude: 6.5, copies: 4 },
	{ radius: 95, amplitude: 4.5, copies: 3 },
];
export const BANDS_COMPACT: Band[] = [{ radius: 103, amplitude: 9, copies: 2 }];

/**
 * The rosette's paths for a fingerprint: per band, a rose r(θ) = R + A·sin(nθ + φ)·(0.7 + 0.3·cos(mθ + ψ)), its lobe
 * count, phases and envelope drawn from the fingerprint. A null fingerprint (nothing checked yet) draws a plain,
 * regular rosette.
 */
export const rosettePaths = (
	fingerprint: string | null,
	bands: Band[],
	steps = 480,
): string[] => {
	const seed = fingerprint ? Number.parseInt(fingerprint.slice(0, 8), 16) : 0;
	const random = generator(seed);
	const paths: string[] = [];
	for (const band of bands) {
		const lobes = fingerprint ? 15 + Math.floor(random() * 14) : 18;
		const envelope = fingerprint ? 2 + Math.floor(random() * 5) : 0;
		const phase = random() * TAU;
		const envelopePhase = random() * TAU;
		for (let copy = 0; copy < band.copies; copy++) {
			const turn = (copy * TAU) / (lobes * band.copies);
			let path = "";
			for (let step = 0; step <= steps; step++) {
				const theta = (step / steps) * TAU;
				const swing =
					envelope === 0
						? 1
						: 0.7 + 0.3 * Math.cos(envelope * theta + envelopePhase);
				const radius =
					band.radius +
					band.amplitude * Math.sin(lobes * theta + phase) * swing;
				const x = CENTER + radius * Math.cos(theta + turn);
				const y = CENTER + radius * Math.sin(theta + turn);
				path += `${step === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
			}
			paths.push(`${path}Z`);
		}
	}
	return paths;
};

/** A circle as a path starting at the top, clockwise: for ring text. */
export const circlePath = (radius: number): string =>
	`M${CENTER} ${CENTER - radius}a${radius} ${radius} 0 1 1 0 ${radius * 2}a${radius} ${radius} 0 1 1 0 ${-radius * 2}`;

/** The witness seal's notary edge: a scalloped ring of `bumps` lobes between two radii. */
export const scallopPath = (
	inner: number,
	outer: number,
	bumps: number,
): string => {
	const steps = bumps * 12;
	let path = "";
	for (let step = 0; step <= steps; step++) {
		const theta = (step / steps) * TAU;
		const wave = (1 + Math.cos(bumps * theta)) / 2;
		const radius = inner + (outer - inner) * wave ** 0.6;
		const x = CENTER + radius * Math.sin(theta);
		const y = CENTER - radius * Math.cos(theta);
		path += `${step === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
	}
	return `${path}Z`;
};

/** The signed bytes' fingerprint, or null when there's no receipt object to fingerprint. */
export const fingerprintOf = async (
	value: unknown,
	canonicalize: (value: unknown) => string,
): Promise<string | null> => {
	if (typeof value !== "object" || value === null) return null;
	const receipt = (value as { receipt?: unknown }).receipt;
	if (typeof receipt !== "object" || receipt === null) return null;
	const bytes = new TextEncoder().encode(canonicalize(receipt));
	const digest = await crypto.subtle.digest("SHA-256", bytes);
	return [...new Uint8Array(digest).slice(0, 4)]
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
};
