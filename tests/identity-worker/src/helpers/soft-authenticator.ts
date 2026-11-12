// A software authenticator for the passkey tests (Cookpool PK-2): an ES256
// (P-256) key made in the test that builds real WebAuthn responses — CBOR
// attestation objects, authenticatorData and DER signatures over
// authenticatorData ‖ SHA-256(clientDataJSON). No real authenticator, no real
// account. Every field a test may want to get wrong is a knob.

import { webcrypto } from "node:crypto";

const subtle = webcrypto.subtle;

// ── encoding ────────────────────────────────────────────────────────

export function b64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await subtle.digest("SHA-256", bytes));
}

type Cbor = number | string | Uint8Array | Map<Cbor, Cbor> | { [k: string]: Cbor };

function cborHead(major: number, n: number): Uint8Array {
  if (n < 24) return Uint8Array.of((major << 5) | n);
  if (n < 0x100) return Uint8Array.of((major << 5) | 24, n);
  if (n < 0x10000) return Uint8Array.of((major << 5) | 25, n >> 8, n & 0xff);
  return Uint8Array.of((major << 5) | 26, (n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff);
}

/** The CBOR WebAuthn needs: integers, text, bytes and maps. */
export function cbor(value: Cbor): Uint8Array {
  if (typeof value === "number") return value >= 0 ? cborHead(0, value) : cborHead(1, -1 - value);
  if (typeof value === "string") {
    const b = utf8(value);
    return concat(cborHead(3, b.length), b);
  }
  if (value instanceof Uint8Array) return concat(cborHead(2, value.length), value);
  const entries: Array<[Cbor, Cbor]> = value instanceof Map ? [...value.entries()] : Object.entries(value);
  return concat(cborHead(5, entries.length), ...entries.flatMap(([k, v]) => [cbor(k), cbor(v)]));
}

/** WebCrypto's raw r‖s (64 bytes) as the DER SEQUENCE WebAuthn's ES256 uses. */
function rawToDer(raw: Uint8Array): Uint8Array {
  const int = (b: Uint8Array) => {
    let i = 0;
    while (i < b.length - 1 && b[i] === 0) i++;
    let v: Uint8Array = b.slice(i);
    if (v[0]! & 0x80) v = concat(Uint8Array.of(0), v);
    return concat(Uint8Array.of(0x02, v.length), v);
  };
  const body = concat(int(raw.slice(0, 32)), int(raw.slice(32)));
  return concat(Uint8Array.of(0x30, body.length), body);
}

// ── flags ───────────────────────────────────────────────────────────

const UP = 0x01;
const UV = 0x04;
const BE = 0x08;
const BS = 0x10;
const AT = 0x40;

export interface CeremonyKnobs {
  /** The origin the browser would put in clientDataJSON. */
  origin?: string;
  /** The RP ID whose hash goes in authenticatorData. */
  rpId?: string;
  /** Override the challenge the browser echoes. */
  challenge?: string;
  /** User verified (Face ID): on by default. */
  uv?: boolean;
  /** The sign count to report; by default one more than last time. */
  counter?: number;
  /** clientDataJSON.type. */
  type?: string;
  /** Override the user handle on an assertion (base64url), or null to leave it out. */
  userHandle?: string | null;
  /** credProps.rk on a registration. */
  rk?: boolean;
}

export interface SoftAuthenticator {
  credentialId: string;
  /** The user handle this passkey was made for (base64url), once created. */
  userHandle: string | null;
  counter: number;
  create(options: { challenge: string; rp: { id?: string }; user: { id: string } }, knobs?: CeremonyKnobs): Promise<RegistrationJSON>;
  get(options: { challenge: string; rpId?: string }, knobs?: CeremonyKnobs): Promise<AuthenticationJSON>;
}

export interface RegistrationJSON {
  id: string;
  rawId: string;
  type: "public-key";
  response: { clientDataJSON: string; attestationObject: string; transports: string[] };
  authenticatorAttachment: "platform";
  clientExtensionResults: { credProps?: { rk: boolean } };
}

export interface AuthenticationJSON {
  id: string;
  rawId: string;
  type: "public-key";
  response: { clientDataJSON: string; authenticatorData: string; signature: string; userHandle?: string };
  authenticatorAttachment: "platform";
  clientExtensionResults: Record<string, never>;
}

export const TEST_ORIGIN = "http://localhost:3000";
export const TEST_RP_ID = "localhost";

/** A new passkey-capable device: its own P-256 key and credential id. */
export async function softAuthenticator(opts: { backedUp?: boolean; transports?: string[] } = {}): Promise<SoftAuthenticator> {
  const pair = (await subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as webcrypto.CryptoKeyPair;
  const rawPub = new Uint8Array(await subtle.exportKey("raw", pair.publicKey));
  const credIdBytes = webcrypto.getRandomValues(new Uint8Array(32));
  const cose = cbor(
    new Map<Cbor, Cbor>([
      [1, 2], // kty: EC2
      [3, -7], // alg: ES256
      [-1, 1], // crv: P-256
      [-2, rawPub.slice(1, 33)],
      [-3, rawPub.slice(33, 65)],
    ]),
  );
  const flagsBase = opts.backedUp === false ? 0 : BE | BS;
  const transports = opts.transports ?? ["internal", "hybrid"];

  const clientData = (type: string, challenge: string, origin: string) =>
    utf8(JSON.stringify({ type, challenge, origin, crossOrigin: false }));

  const counterBytes = (n: number) => Uint8Array.of((n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff);

  const auth: SoftAuthenticator = {
    credentialId: b64url(credIdBytes),
    userHandle: null,
    counter: 0,

    async create(options, knobs = {}) {
      const rpId = knobs.rpId ?? options.rp.id ?? TEST_RP_ID;
      const flags = UP | (knobs.uv === false ? 0 : UV) | flagsBase | AT;
      const counter = knobs.counter ?? 0;
      auth.counter = counter;
      const authData = concat(
        await sha256(utf8(rpId)),
        Uint8Array.of(flags),
        counterBytes(counter),
        new Uint8Array(16), // AAGUID: zeros, as "none" attestation sends
        Uint8Array.of(credIdBytes.length >> 8, credIdBytes.length & 0xff),
        credIdBytes,
        cose,
      );
      const attestationObject = cbor({ fmt: "none", attStmt: new Map(), authData });
      auth.userHandle = options.user.id;
      return {
        id: auth.credentialId,
        rawId: auth.credentialId,
        type: "public-key",
        response: {
          clientDataJSON: b64url(clientData(knobs.type ?? "webauthn.create", knobs.challenge ?? options.challenge, knobs.origin ?? TEST_ORIGIN)),
          attestationObject: b64url(attestationObject),
          transports,
        },
        authenticatorAttachment: "platform",
        clientExtensionResults: { credProps: { rk: knobs.rk ?? true } },
      };
    },

    async get(options, knobs = {}) {
      const rpId = knobs.rpId ?? options.rpId ?? TEST_RP_ID;
      const flags = UP | (knobs.uv === false ? 0 : UV) | flagsBase;
      const counter = knobs.counter ?? auth.counter + 1;
      auth.counter = counter;
      const authData = concat(await sha256(utf8(rpId)), Uint8Array.of(flags), counterBytes(counter));
      const cdj = clientData(knobs.type ?? "webauthn.get", knobs.challenge ?? options.challenge, knobs.origin ?? TEST_ORIGIN);
      const signed = concat(authData, await sha256(cdj));
      const raw = new Uint8Array(await subtle.sign({ name: "ECDSA", hash: "SHA-256" }, pair.privateKey, signed));
      const userHandle = knobs.userHandle === undefined ? auth.userHandle : knobs.userHandle;
      return {
        id: auth.credentialId,
        rawId: auth.credentialId,
        type: "public-key",
        response: {
          clientDataJSON: b64url(cdj),
          authenticatorData: b64url(authData),
          signature: b64url(rawToDer(raw)),
          ...(userHandle ? { userHandle } : {}),
        },
        authenticatorAttachment: "platform",
        clientExtensionResults: {},
      };
    },
  };
  return auth;
}
