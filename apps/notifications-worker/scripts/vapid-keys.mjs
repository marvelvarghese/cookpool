#!/usr/bin/env node
// Generate a VAPID key pair for Web Push (Cookpool PW-5), with WebCrypto.
//
//   node apps/notifications-worker/scripts/vapid-keys.mjs
//
// Prints to stdout only — it writes no file and keeps nothing:
//
//   VAPID_PUBLIC_KEY=<base64url of the uncompressed P-256 point, 65 bytes>
//   VAPID_PRIVATE_KEY=<base64url (no padding) of the PKCS#8 DER>
//
// These are exactly the forms notifications-worker reads (src/push/vapid.ts).
// One pair per environment (stage, prod):
//
//   - the public key goes in wrangler.template.jsonc, `env.<env>.vars.VAPID_PUBLIC_KEY`
//     (not a secret: it is what the app subscribes with);
//   - the private key is a secret: store it with
//       orun secrets set VAPID_PRIVATE_KEY --workspace ws_QX130J0D --env <env>
//     (it prompts for the value, or reads stdin), and never commit or paste
//     it anywhere else.
//
// Changing an environment's pair invalidates every subscription made with the
// old public key: browsers must subscribe again (the app does on its next
// launch with push on).
//
// `--check` generates a pair, signs and verifies with it, and prints only
// "ok" — a self-test that prints no key.

const { subtle } = globalThis.crypto;

function base64url(bytes) {
  return Buffer.from(bytes).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const algorithm = { name: "ECDSA", namedCurve: "P-256" };
const pair = await subtle.generateKey(algorithm, true, ["sign", "verify"]);
const publicRaw = new Uint8Array(await subtle.exportKey("raw", pair.publicKey));
const pkcs8 = new Uint8Array(await subtle.exportKey("pkcs8", pair.privateKey));
if (publicRaw.length !== 65 || publicRaw[0] !== 0x04) throw new Error("unexpected public key shape");

// The pair must round-trip in the forms printed: the worker imports exactly these.
const imported = await subtle.importKey("pkcs8", pkcs8, algorithm, false, ["sign"]);
const verifier = await subtle.importKey("raw", publicRaw, algorithm, false, ["verify"]);
const probe = new TextEncoder().encode("cookpool vapid pair check");
const signature = await subtle.sign({ name: "ECDSA", hash: "SHA-256" }, imported, probe);
if (!(await subtle.verify({ name: "ECDSA", hash: "SHA-256" }, verifier, signature, probe))) {
  throw new Error("the generated pair does not verify");
}

if (process.argv.includes("--check")) {
  process.stdout.write("ok\n");
} else {
  process.stdout.write(`VAPID_PUBLIC_KEY=${base64url(publicRaw)}\nVAPID_PRIVATE_KEY=${base64url(pkcs8)}\n`);
}
