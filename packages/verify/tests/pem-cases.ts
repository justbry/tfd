// SPDX-License-Identifier: Apache-2.0
/**
 * Key texts and the verdict tfd's verifyBytes (packages/atm/src/ledger/sign.ts, node:crypto's createPublicKey under
 * Bun) gives each for a signature by `ed25519`. tests/pem.test.ts pins tfd-verify to these verdicts; the website's
 * tests/pem.test.ts runs tfd's own verifyBytes on the same cases, so a change on either side shows. tfd's CLI runs on Bun
 * (BoringSSL); Node's OpenSSL 3 reads a few malformed key texts differently.
 */
import { generateKeyPairSync, sign } from "node:crypto";

export const KEY_ID = "key";
export const TEXT = '{"receipt":"pem"}';

const ed25519 = generateKeyPairSync("ed25519");
const other = generateKeyPairSync("ed25519");
const rsa = generateKeyPairSync("rsa", { modulusLength: 1024 });

const publicPem = ed25519.publicKey
	.export({ type: "spki", format: "pem" })
	.toString();
const otherPublicPem = other.publicKey
	.export({ type: "spki", format: "pem" })
	.toString();
const privatePem = ed25519.privateKey
	.export({ type: "pkcs8", format: "pem" })
	.toString();
const otherPrivatePem = other.privateKey
	.export({ type: "pkcs8", format: "pem" })
	.toString();
const encryptedPrivatePem = ed25519.privateKey
	.export({
		type: "pkcs8",
		format: "pem",
		cipher: "aes-256-cbc",
		passphrase: "passphrase",
	})
	.toString();
const rsaPem = rsa.publicKey.export({ type: "spki", format: "pem" }).toString();
const rsaPkcs1Pem = rsa.publicKey
	.export({ type: "pkcs1", format: "pem" })
	.toString();
const spki = ed25519.publicKey.export({ type: "spki", format: "der" });
const pkcs8 = ed25519.privateKey.export({ type: "pkcs8", format: "der" });
const body = publicPem.split("\n")[1] as string;

export const sig = sign(
	null,
	new TextEncoder().encode(TEXT),
	ed25519.privateKey,
)
	.toString("base64url")
	.replace(/=+$/, "");

const pemOf = (name: string, der: Buffer, before = ""): string =>
	`-----BEGIN ${name}-----\n${before}${der
		.toString("base64")
		.match(/.{1,64}/g)
		?.join("\n")}\n-----END ${name}-----\n`;

const withBody = (text: string): string =>
	`-----BEGIN PUBLIC KEY-----\n${text}\n-----END PUBLIC KEY-----\n`;

export type Verdict = "ok" | "unknown_key" | "bad_signature";

/** [what the key text is, the text, the verdict tfd gives for a signature by `ed25519`]. */
export const CASES: [string, string, Verdict][] = [
	["the key as tfd writes it", publicPem, "ok"],
	["no newline at the end", publicPem.trimEnd(), "ok"],
	["CRLF line ends", publicPem.replace(/\n/g, "\r\n"), "ok"],
	["text on lines before the block", `a note\n\n${publicPem}`, "ok"],
	["text on lines after the block", `${publicPem}a note\n`, "ok"],
	["text before BEGIN on its line", `a note ${publicPem}`, "unknown_key"],
	["text after END on its line", `${publicPem.trimEnd()} note`, "unknown_key"],
	["two keys: the first counts", publicPem + otherPublicPem, "ok"],
	[
		"two keys: the first counts (other first)",
		otherPublicPem + publicPem,
		"bad_signature",
	],
	["an RSA key first", rsaPem + publicPem, "unknown_key"],
	["an RSA key second", publicPem + rsaPem, "ok"],
	["the private key", privatePem, "ok"],
	["another private key", otherPrivatePem, "bad_signature"],
	["a private key, then the public key", otherPrivatePem + publicPem, "ok"],
	["an encrypted private key", encryptedPrivatePem, "unknown_key"],
	[
		"an encrypted private key, then the public key",
		encryptedPrivatePem + publicPem,
		"ok",
	],
	["an RSA key", rsaPem, "unknown_key"],
	[
		"a PKCS#1 RSA key, then the private key",
		rsaPkcs1Pem + privatePem,
		"unknown_key",
	],
	["indented", publicPem.replace(/^/gm, "  "), "unknown_key"],
	["BEGIN indented", `  ${publicPem}`, "unknown_key"],
	["BEGIN indented with a tab", `\t${publicPem}`, "unknown_key"],
	["the body indented", withBody(`  ${body}`), "ok"],
	[
		"no newlines around the body",
		`-----BEGIN PUBLIC KEY-----${body}-----END PUBLIC KEY-----`,
		"unknown_key",
	],
	[
		"no newline after BEGIN",
		`-----BEGIN PUBLIC KEY-----${body}\n-----END PUBLIC KEY-----\n`,
		"unknown_key",
	],
	[
		"no newline before END",
		`-----BEGIN PUBLIC KEY-----\n${body}-----END PUBLIC KEY-----\n`,
		"unknown_key",
	],
	[
		"the body on two lines",
		withBody(`${body.slice(0, 20)}\n${body.slice(20)}`),
		"ok",
	],
	[
		"a space inside the body",
		withBody(`${body.slice(0, 20)} ${body.slice(20)}`),
		"ok",
	],
	[
		"spaces after the body, BEGIN and END",
		publicPem.replace(/\n/g, "  \n"),
		"ok",
	],
	["a blank line after BEGIN", withBody(`\n${body}`), "ok"],
	["a blank line before END", withBody(`${body}\n`), "unknown_key"],
	["a header line", pemOf("PUBLIC KEY", spki, "Comment: x\n\n"), "unknown_key"],
	[
		"a header line, then the private key",
		pemOf("PUBLIC KEY", spki, "Comment: x\n\n") + privatePem,
		"ok",
	],
	["no padding", withBody(body.replace(/=+$/, "")), "unknown_key"],
	[
		"an invalid character",
		withBody(`${body.slice(0, 10)}!${body.slice(10)}`),
		"unknown_key",
	],
	["a dash in the body", withBody(`${body}\n-AAA`), "unknown_key"],
	["data after the padding", withBody(`${body}${body}`), "unknown_key"],
	[
		"bytes after the key's DER",
		pemOf("PUBLIC KEY", Buffer.concat([spki, Buffer.from([0])])),
		"ok",
	],
	[
		"bytes after the private key's DER",
		pemOf("PRIVATE KEY", Buffer.concat([pkcs8, Buffer.from([0])])),
		"ok",
	],
	[
		"a DER length in long form",
		pemOf(
			"PUBLIC KEY",
			Buffer.concat([Buffer.from([0x30, 0x81, 0x2a]), spki.subarray(2)]),
		),
		"unknown_key",
	],
	["a lowercase PEM", publicPem.toLowerCase(), "unknown_key"],
	[
		"END naming another type",
		publicPem.replace("END PUBLIC", "END PRIVATE"),
		"unknown_key",
	],
	["an empty body", withBody("").replace("\n\n", "\n"), "unknown_key"],
	[
		"a malformed block first",
		`-----BEGIN FOO-----\nA\n-----END FOO-----\n${publicPem}`,
		"unknown_key",
	],
	[
		"a malformed block before the private key",
		`-----BEGIN FOO-----\nA\n-----END FOO-----\n${privatePem}`,
		"unknown_key",
	],
	["another block first", pemOf("FOO", Buffer.from("foo")) + publicPem, "ok"],
	["a byte-order mark", `﻿${publicPem}`, "unknown_key"],
	["a byte-order mark on a line before", `﻿a note\n${publicPem}`, "ok"],
	[
		"non-ASCII after BEGIN",
		publicPem.replace("KEY-----\n", "KEY-----é\n"),
		"ok",
	],
	["253 bytes of text, then BEGIN", `${"x".repeat(253)}${publicPem}`, "ok"],
	[
		"254 bytes of text, then BEGIN",
		`${"x".repeat(254)}${publicPem}`,
		"unknown_key",
	],
	["carriage returns only", publicPem.replace(/\n/g, "\r"), "unknown_key"],
	["empty", "", "unknown_key"],
];
