/** Llamadas HTTP de la API de xenxo (cuentas, assets, proyectos), para pruebas y agentes. */
import { SoftwarePasskey } from "./webauthn";

export interface ApiError {
  status: number;
  error: string;
  message?: string;
  detail?: unknown;
}

export class Api {
  constructor(
    public baseUrl: string,
    public token?: string,
    /** Origen que se envía (las passkeys y CORS lo comprueban). */
    public origin = "http://localhost:5173",
  ) {}

  async call<T>(method: string, path: string, body?: unknown, raw?: Uint8Array): Promise<{ ok: true; data: T } | ({ ok: false } & ApiError)> {
    const headers: Record<string, string> = { Origin: this.origin };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    let payload: BodyInit | undefined;
    if (raw) {
      headers["Content-Type"] = path.includes("kind=cover") ? "image/png" : "model/gltf-binary";
      payload = raw as Uint8Array<ArrayBuffer>;
    } else if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      payload = JSON.stringify(body);
    }
    const res = await fetch(new URL(path, this.baseUrl), { method, headers, body: payload });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) return { ok: false, status: res.status, error: String(data.error ?? res.status), message: data.message as string, detail: data.detail };
    return { ok: true, data: data as T };
  }

  /** Alta completa con una passkey por software. Devuelve la passkey para poder volver a entrar. */
  async register(displayName: string) {
    const opts = await this.call<{ flow_id: string; options: never }>("POST", "/auth/passkey/register/options", {
      display_name: displayName,
      age_confirmed: true,
      accept_terms: "2026-10",
    });
    if (!opts.ok) throw new Error(`register/options: ${opts.error} ${opts.message ?? ""}`);
    const passkey = new SoftwarePasskey(this.origin);
    const response = await passkey.create(opts.data.options);
    const done = await this.call<{ token: string; user: { id: string; display_name: string } }>("POST", "/auth/passkey/register/verify", {
      flow_id: opts.data.flow_id,
      response,
    });
    if (!done.ok) throw new Error(`register/verify: ${done.error} ${done.message ?? ""}`);
    this.token = done.data.token;
    return { passkey, user: done.data.user };
  }

  async login(passkey: SoftwarePasskey) {
    const opts = await this.call<{ flow_id: string; options: never }>("POST", "/auth/passkey/login/options", {});
    if (!opts.ok) throw new Error(`login/options: ${opts.error}`);
    const response = await passkey.get(opts.data.options);
    const done = await this.call<{ token: string }>("POST", "/auth/passkey/login/verify", { flow_id: opts.data.flow_id, response });
    if (!done.ok) throw new Error(`login/verify: ${done.error} ${done.message ?? ""}`);
    this.token = done.data.token;
    return done.data;
  }

  async agentToken(key: string) {
    const r = await fetch(new URL("/auth/agent", this.baseUrl), { method: "POST", headers: { Authorization: `Bearer ${key}` } });
    if (!r.ok) throw new Error(`auth/agent → HTTP ${r.status}`);
    this.token = ((await r.json()) as { token: string }).token;
    return this.token;
  }

  upload(bytes: Uint8Array, kind: "avatar" | "model" | "monument" | "cover") {
    return this.call<{ hash: string; triangles: number; bytes: number; format: string; existed: boolean }>("POST", `/assets?kind=${kind}`, undefined, bytes);
  }
}
