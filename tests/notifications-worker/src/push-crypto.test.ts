// Web Push crypto (PW-5): the payload encryption reproduces RFC 8291
// Appendix A byte for byte, and a VAPID token (RFC 8292, ES256) round-trips
// through verification. WebCrypto only — the same calls Workers make.

import {
  MAX_PLAINTEXT_BYTES,
  VAPID_TOKEN_TTL_SECONDS,
  audienceOf,
  base64urlDecode,
  base64urlEncode,
  deriveWebPushSecrets,
  ecdhWith,
  encryptWebPush,
  generateServerKeys,
  importP256PrivateKey,
  importPkcs8SigningKey,
  signEs256Jwt,
  vapidAuthorization,
  verifyEs256Jwt,
} from "@notifications-worker/push/crypto";

/** base64url as the RFC prints it, wrapped and spaced: whitespace removed. */
const b64 = (text: string): Uint8Array => {
  const bytes = base64urlDecode(text.replace(/\s+/g, ""));
  if (!bytes) throw new Error(`not base64url: ${text}`);
  return bytes;
};

// RFC 8291 §5 and Appendix A.
const RFC = {
  plaintext: b64("V2hlbiBJIGdyb3cgdXAsIEkgd2FudCB0byBiZSBhIHdhdGVybWVsb24"),
  asPublic: b64("BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIg Dll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8"),
  asPrivate: b64("yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw"),
  uaPublic: b64("BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcx aOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4"),
  uaPrivate: b64("q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94"),
  salt: b64("DGv6ra1nlYgDCS1FRnbzlw"),
  authSecret: b64("BTBZMqHH6r4Tts7J_aSIgg"),
  ecdhSecret: b64("kyrL1jIIOHEzg3sM2ZWRHDRB62YACZhhSlknJ672kSs"),
  ikm: b64("S4lYMb_L0FxCeq0WhDx813KgSYqU26kOyzWUdsXYyrg"),
  cek: b64("oIhVW04MRdy2XN9CiKLxTg"),
  nonce: b64("4h_95klXJ5E_qnoN"),
  header: b64("DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z 9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml mlMoZIIgDll6e3vCYLocInmYWAmS6Tlz AC8wEqKK6PBru3jl7A8"),
  ciphertext: b64("8pfeW0KbunFT06SuDKoJH9Ql87S1QUrd irN6GcG7sFz1y1sqLgVi1VhjVkHsUoEs bI_0LpXMuGvnzQ"),
  body: b64(`DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml
             mlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPT
             pK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN`),
};

async function rfcServer() {
  return { publicKey: RFC.asPublic, privateKey: await importP256PrivateKey(RFC.asPrivate, RFC.asPublic, "ecdh") };
}

describe("RFC 8291 Appendix A", () => {
  it("derives the example's ECDH secret, IKM, content key and nonce", async () => {
    const secrets = await deriveWebPushSecrets(RFC.uaPublic, RFC.authSecret, RFC.salt, await rfcServer());
    expect(base64urlEncode(secrets.ecdhSecret)).toBe(base64urlEncode(RFC.ecdhSecret));
    expect(base64urlEncode(secrets.ikm)).toBe(base64urlEncode(RFC.ikm));
    expect(base64urlEncode(secrets.cek)).toBe(base64urlEncode(RFC.cek));
    expect(base64urlEncode(secrets.nonce)).toBe(base64urlEncode(RFC.nonce));
  });

  it("encrypts the example to exactly the RFC's body: the 86-octet header, then the ciphertext", async () => {
    const body = await encryptWebPush(RFC.plaintext, RFC.uaPublic, RFC.authSecret, { salt: RFC.salt, server: await rfcServer() });
    expect(body.length).toBe(86 + RFC.ciphertext.length);
    expect(base64urlEncode(body.slice(0, 86))).toBe(base64urlEncode(RFC.header));
    expect(base64urlEncode(body.slice(86))).toBe(base64urlEncode(RFC.ciphertext));
    expect(base64urlEncode(body)).toBe(base64urlEncode(RFC.body));
    expect(new TextDecoder().decode(RFC.plaintext)).toBe("When I grow up, I want to be a watermelon");
  });

  it("is what the receiver decrypts with its own private key (the other side of the ECDH)", async () => {
    // A fresh salt and server key, as every real send has: the user agent's
    // side of the derivation must land on the same content key and nonce.
    const server = await generateServerKeys();
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const body = await encryptWebPush(RFC.plaintext, RFC.uaPublic, RFC.authSecret, { salt, server });

    expect(body.slice(0, 16)).toEqual(salt);
    expect(new DataView(body.buffer, body.byteOffset).getUint32(16)).toBe(4096);
    expect(body[20]).toBe(65);
    const asPublic = body.slice(21, 86);
    expect(asPublic).toEqual(server.publicKey);

    const uaPrivate = await importP256PrivateKey(RFC.uaPrivate, RFC.uaPublic, "ecdh");
    const asKey = await crypto.subtle.importKey("raw", asPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
    const ecdh = new Uint8Array(await crypto.subtle.deriveBits(ecdhWith(asKey), uaPrivate, 256));
    const derived = await deriveWebPushSecrets(RFC.uaPublic, RFC.authSecret, salt, server);
    expect(ecdh).toEqual(derived.ecdhSecret);

    const key = await crypto.subtle.importKey("raw", derived.cek, { name: "AES-GCM" }, false, ["decrypt"]);
    const record = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: derived.nonce }, key, body.slice(86)));
    expect(record[record.length - 1]).toBe(0x02);
    expect(new TextDecoder().decode(record.slice(0, -1))).toBe("When I grow up, I want to be a watermelon");
  });

  it("refuses keys of the wrong shape and a payload one record cannot hold", async () => {
    await expect(encryptWebPush(RFC.plaintext, RFC.uaPublic.slice(1), RFC.authSecret)).rejects.toThrow(/p256dh/);
    await expect(encryptWebPush(RFC.plaintext, RFC.uaPublic, RFC.authSecret.slice(1))).rejects.toThrow(/auth/);
    await expect(encryptWebPush(new Uint8Array(MAX_PLAINTEXT_BYTES + 1), RFC.uaPublic, RFC.authSecret)).rejects.toThrow(/too large/);
    expect((await encryptWebPush(new Uint8Array(MAX_PLAINTEXT_BYTES), RFC.uaPublic, RFC.authSecret)).length).toBe(86 + 4096);
  });
});

describe("base64url", () => {
  it("round-trips bytes and refuses what is not base64url", () => {
    const bytes = crypto.getRandomValues(new Uint8Array(65));
    expect(base64urlDecode(base64urlEncode(bytes))).toEqual(bytes);
    expect(base64urlDecode("AQID")).toEqual(Uint8Array.of(1, 2, 3));
    expect(base64urlDecode("AQI=")).toEqual(Uint8Array.of(1, 2));
    expect(base64urlDecode("A+/=")).toBeNull();
    expect(base64urlDecode("A")).toBeNull();
    expect(base64urlDecode("not base64!")).toBeNull();
  });
});

describe("VAPID (RFC 8292)", () => {
  async function vapidPair() {
    const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
    const publicRaw = new Uint8Array((await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer);
    const pkcs8 = new Uint8Array((await crypto.subtle.exportKey("pkcs8", pair.privateKey)) as ArrayBuffer);
    return { publicRaw, pkcs8 };
  }

  it("signs an ES256 token that verifies with the public key, and with no other", async () => {
    const { publicRaw, pkcs8 } = await vapidPair();
    const signer = await importPkcs8SigningKey(pkcs8);
    const exp = Math.floor(Date.parse("2026-11-07T12:00:00Z") / 1000) + VAPID_TOKEN_TTL_SECONDS;
    const claims = { aud: audienceOf("https://fcm.googleapis.com/fcm/send/abc:def"), exp, sub: "mailto:no-reply@mail.cookpool.store" };
    const jwt = await signEs256Jwt(claims, signer);

    const [header, payload, signature] = jwt.split(".");
    expect(JSON.parse(new TextDecoder().decode(base64urlDecode(header!)!))).toEqual({ typ: "JWT", alg: "ES256" });
    expect(JSON.parse(new TextDecoder().decode(base64urlDecode(payload!)!))).toEqual(claims);
    expect(base64urlDecode(signature!)!.length).toBe(64);
    expect(jwt).not.toMatch(/[+/=]/);

    expect(await verifyEs256Jwt(jwt, publicRaw)).toEqual({ aud: "https://fcm.googleapis.com", exp, sub: "mailto:no-reply@mail.cookpool.store" });
    const other = await vapidPair();
    expect(await verifyEs256Jwt(jwt, other.publicRaw)).toBeNull();
    // Tampered claims, a truncated token, another algorithm: none verify.
    const forged = `${header}.${base64urlEncode(new TextEncoder().encode(JSON.stringify({ ...claims, aud: "https://evil.example" })))}.${signature}`;
    expect(await verifyEs256Jwt(forged, publicRaw)).toBeNull();
    expect(await verifyEs256Jwt(`${header}.${payload}`, publicRaw)).toBeNull();
    const none = `${base64urlEncode(new TextEncoder().encode(JSON.stringify({ typ: "JWT", alg: "none" })))}.${payload}.${signature}`;
    expect(await verifyEs256Jwt(none, publicRaw)).toBeNull();
  });

  it("names the push service's origin as the audience and puts the token and key in the header", () => {
    expect(audienceOf("https://web.push.apple.com/QGuQyavXutnMH8pq?x=1")).toBe("https://web.push.apple.com");
    expect(audienceOf("https://updates.push.services.mozilla.com:443/wpush/v2/gAAA")).toBe("https://updates.push.services.mozilla.com");
    expect(vapidAuthorization("a.b.c", "BKey")).toBe("vapid t=a.b.c, k=BKey");
  });

  it("imports a raw private scalar with its public point for signing, as the RFC example's keys are printed", async () => {
    const signer = await importP256PrivateKey(RFC.asPrivate, RFC.asPublic, "sign");
    const jwt = await signEs256Jwt({ aud: "https://push.example.net", exp: 1, sub: "mailto:a@b.c" }, signer);
    expect(await verifyEs256Jwt(jwt, RFC.asPublic)).toMatchObject({ aud: "https://push.example.net" });
  });
});
