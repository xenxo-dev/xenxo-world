/**
 * Autenticador de passkeys por software (ES256), solo para pruebas.
 * Permite probar el alta y el acceso reales de WebAuthn sin navegador ni hardware.
 */
import { createHash, randomBytes, webcrypto } from "node:crypto";
import { isoBase64URL, isoCBOR } from "@simplewebauthn/server/helpers";

const subtle = webcrypto.subtle;
const sha256 = (data: Uint8Array | string) => new Uint8Array(createHash("sha256").update(data).digest());
const b64 = (u: Uint8Array) => isoBase64URL.fromBuffer(u as Uint8Array<ArrayBuffer>);

function concat(...parts: Uint8Array[]) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** Firma ECDSA cruda (r||s) → DER, que es lo que espera WebAuthn. */
function rawToDer(raw: Uint8Array): Uint8Array {
  const int = (b: Uint8Array) => {
    let i = 0;
    while (i < b.length - 1 && b[i] === 0) i++;
    let v = b.subarray(i);
    if (v[0]! & 0x80) v = concat(new Uint8Array([0]), v);
    return concat(new Uint8Array([0x02, v.length]), v);
  };
  const r = int(raw.subarray(0, 32));
  const s = int(raw.subarray(32));
  return concat(new Uint8Array([0x30, r.length + s.length]), r, s);
}

interface CreationOptions {
  challenge: string;
  rp: { id?: string };
  user: { id: string };
}
interface RequestOptions {
  challenge: string;
  rpId?: string;
}

export class SoftwarePasskey {
  private credentialId = new Uint8Array(randomBytes(16));
  private userHandle = "";
  private counter = 0;
  private keys!: CryptoKeyPair;

  constructor(private origin: string) {}

  get id() {
    return b64(this.credentialId);
  }

  private clientData(type: string, challenge: string) {
    return new TextEncoder().encode(JSON.stringify({ type, challenge, origin: this.origin, crossOrigin: false }));
  }

  async create(o: CreationOptions) {
    this.keys = (await subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
    this.userHandle = o.user.id;
    const jwk = await subtle.exportKey("jwk", this.keys.publicKey);
    const cose = new Map<number, number | Uint8Array>([
      [1, 2], // kty: EC2
      [3, -7], // alg: ES256
      [-1, 1], // crv: P-256
      [-2, isoBase64URL.toBuffer(jwk.x!)],
      [-3, isoBase64URL.toBuffer(jwk.y!)],
    ]);
    const credLen = new Uint8Array([0, this.credentialId.length]);
    const authData = concat(
      sha256(o.rp.id ?? "localhost"),
      new Uint8Array([0x45]), // UP | UV | AT
      new Uint8Array([0, 0, 0, 0]),
      new Uint8Array(16), // AAGUID
      credLen,
      this.credentialId,
      isoCBOR.encode(cose),
    );
    const attestationObject = isoCBOR.encode(new Map<string, unknown>([["fmt", "none"], ["attStmt", new Map()], ["authData", authData]]) as never);
    return {
      id: this.id,
      rawId: this.id,
      type: "public-key",
      response: {
        clientDataJSON: b64(this.clientData("webauthn.create", o.challenge)),
        attestationObject: b64(attestationObject),
        transports: ["internal"],
      },
      clientExtensionResults: {},
    };
  }

  async get(o: RequestOptions) {
    this.counter++;
    const authData = concat(
      sha256(o.rpId ?? "localhost"),
      new Uint8Array([0x05]), // UP | UV
      new Uint8Array([(this.counter >>> 24) & 255, (this.counter >>> 16) & 255, (this.counter >>> 8) & 255, this.counter & 255]),
    );
    const clientDataJSON = this.clientData("webauthn.get", o.challenge);
    const raw = new Uint8Array(
      await subtle.sign({ name: "ECDSA", hash: "SHA-256" }, this.keys.privateKey, concat(authData, sha256(clientDataJSON))),
    );
    return {
      id: this.id,
      rawId: this.id,
      type: "public-key",
      response: {
        clientDataJSON: b64(clientDataJSON),
        authenticatorData: b64(authData),
        signature: b64(rawToDer(raw)),
        userHandle: this.userHandle,
      },
      clientExtensionResults: {},
    };
  }
}
