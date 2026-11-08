// The part of jsonld 9 (https://github.com/digitalbazaar/jsonld.js) this package calls; jsonld ships no types.
declare module "jsonld" {
	type RemoteDocument = {
		contextUrl: string | null;
		documentUrl: string;
		document: unknown;
	};
	type CanonizeOptions = {
		algorithm: "RDFC-1.0";
		format: "application/n-quads";
		documentLoader: (url: string) => Promise<RemoteDocument>;
		safe: boolean;
		base: string | null;
	};
	const jsonld: {
		canonize(input: unknown, options: CanonizeOptions): Promise<string>;
	};
	export default jsonld;
}
