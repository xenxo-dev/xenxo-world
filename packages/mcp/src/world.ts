/**
 * La parcela vista por un agente: conexión al chunk de su distrito como un cliente más del
 * protocolo (sin vías privilegiadas), estado de sus piezas y paso de coordenadas de la parcela
 * (las que entiende un agente) a las del chunk (las del protocolo).
 */
import { XenxoClient } from "@xenxo/headless/client";
import type { Components, Entity, MutationOp, ServerMessage } from "@xenxo/protocol";

export interface Zone {
  chunk_id: string;
  district: string;
  parcel: string;
  owner: string;
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  /** 0: la calle de la parcela queda al sur (+Z); 180: al norte (−Z). */
  facing: number;
}

export interface ParcelBudgets {
  maxEntities: number;
  maxTris: number;
  maxLights: number;
  maxHeight: number;
}

export type V3 = [number, number, number];

const r3 = (v: number) => Math.round(v * 1000) / 1000;

export class Parcel {
  private client: XenxoClient | null = null;
  private connecting: Promise<XenxoClient> | null = null;
  zone!: Zone;
  budgets!: ParcelBudgets;
  name = "";
  /** Las entidades del chunk que son de este proyecto, al día con los DELTA. */
  readonly pieces = new Map<string, Entity>();
  /** Medidas de los modelos subidos en esta sesión (para apoyarlos en el suelo). */
  readonly modelBounds = new Map<string, { min: number[]; max: number[] }>();
  private token = "";
  private tokenExp = 0;

  constructor(
    readonly baseUrl: string,
    private readonly key: string,
  ) {}

  /** Token de agente (dura 15 min): se pide de nuevo cuando va a caducar. */
  async auth(): Promise<string> {
    if (this.token && Date.now() < this.tokenExp - 60_000) return this.token;
    const r = await fetch(new URL("/auth/agent", this.baseUrl), { method: "POST", headers: { Authorization: `Bearer ${this.key}` } });
    const body = (await r.json().catch(() => ({}))) as {
      token?: string;
      principal?: { exp: number; name?: string; zone?: Zone };
      budgets?: ParcelBudgets;
      message?: string;
    };
    if (!r.ok || !body.token || !body.principal?.zone) {
      throw new Error(`xenxo no acepta la clave (${r.status}${body.message ? `: ${body.message}` : ""}). Crea otra en xenxo.io → Proyectos.`);
    }
    this.token = body.token;
    this.tokenExp = body.principal.exp;
    this.zone = body.principal.zone;
    this.budgets = body.budgets!;
    this.name = body.principal.name ?? "agente";
    return this.token;
  }

  /** Conexión abierta con el chunk de la parcela (se rehace sola si se cerró). */
  async connect(): Promise<XenxoClient> {
    if (this.client && !this.client.closed) return this.client;
    this.connecting ??= (async () => {
      const token = await this.auth();
      const c = await XenxoClient.connect({ baseUrl: this.baseUrl, chunkId: this.zone.chunk_id, token, displayName: this.name });
      c.maxReceived = 50;
      this.pieces.clear();
      for (const e of c.snapshot.entities) if (e.owner === this.zone.owner) this.pieces.set(e.entity_id, e);
      c.onMessage((m: ServerMessage) => {
        if (m.type !== "DELTA") return;
        for (const ch of m.payload.changes) {
          if (ch.kind === "remove") this.pieces.delete(ch.entity_id);
          else if (ch.entity.owner === this.zone.owner) this.pieces.set(ch.entity.entity_id, ch.entity);
        }
      });
      this.client = c;
      return c;
    })().finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }

  close() {
    this.client?.close();
  }

  /** Envía una mutación; devuelve el id de la entidad o lanza un error con la explicación del servidor. */
  async mutate(mutation: MutationOp): Promise<string> {
    const c = await this.connect();
    const r = await c.mutate(mutation);
    if (r.type === "ERROR") {
      const d = r.payload.detail ? ` ${JSON.stringify(r.payload.detail)}` : "";
      throw new Error(`${r.payload.code}: ${r.payload.message}${d}`);
    }
    const id = r.payload.entity_id;
    // El cambio llega a todos (también a nosotros) en un DELTA justo después del ACK: se espera
    // para que la siguiente herramienta ya lo vea.
    await c.next("DELTA", (m) => m.payload.changes.some((ch) => (ch.kind === "remove" ? ch.entity_id : ch.entity.entity_id) === id), 3000).catch(() => {});
    if (mutation.op === "DESPAWN") this.pieces.delete(id);
    return id;
  }

  /* --- Coordenadas ---------------------------------------------------- */
  /*
   * En la parcela: x de 0 a 10 de izquierda a derecha mirando desde la calle, z de 0 (la calle,
   * delante) a 10 (el fondo, donde está su portal) e y hacia arriba. Giro (yaw) en grados:
   * 0 = la pieza mira a la calle; 90 = mira a la derecha (vista desde la calle).
   */

  // La parcela puede mirar a cualquiera de los cuatro lados (0 = sur, 90 = este, 180 = norte, 270 = oeste).
  // u: a la derecha de quien mira desde la calle; w: hacia la calle, desde el centro.
  toChunk([x, y, z]: V3): V3 {
    const Z = this.zone;
    const a = (Z.facing * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
    const cx = (Z.x0 + Z.x1) / 2, cz = (Z.z0 + Z.z1) / 2;
    const u = x - (Z.x1 - Z.x0) / 2, w = (Z.z1 - Z.z0) / 2 - z;
    return [r3(cx + u * c + w * s), r3(y), r3(cz - u * s + w * c)];
  }

  toParcel([x, y, z]: number[]): V3 {
    const Z = this.zone;
    const a = (Z.facing * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
    const dx = x! - (Z.x0 + Z.x1) / 2, dz = z! - (Z.z0 + Z.z1) / 2;
    const u = dx * c - dz * s, w = dx * s + dz * c;
    return [r3(u + (Z.x1 - Z.x0) / 2), r3(y!), r3((Z.z1 - Z.z0) / 2 - w)];
  }

  /** Cuaternión del giro: el de la parcela más el de la pieza. */
  rotation(yawDeg: number): [number, number, number, number] {
    const h = (((this.zone.facing + yawDeg) % 360) * Math.PI) / 360;
    const r6 = (v: number) => Math.round(v * 1e6) / 1e6;
    return [0, r6(Math.sin(h)), 0, r6(Math.cos(h))];
  }

  yawOf(r: number[]): number {
    const deg = (2 * Math.atan2(r[1] ?? 0, r[3] ?? 1) * 180) / Math.PI - this.zone.facing;
    return Math.round((((deg % 360) + 540) % 360) - 180);
  }

  /** Lo que el agente ve de una pieza: tipo, dónde está en la parcela y qué es. */
  describe(e: Entity) {
    const c = e.components as Components;
    const t = c["transform@1"];
    const kind = c["mesh@1"] ? "model" : c["label@1"] ? "label" : c["light@1"] && !c["primitive@1"] ? "light" : c["primitive@1"] ? c["primitive@1"].shape : c["collider@1"] ? "collider" : "other";
    return {
      id: e.entity_id,
      kind,
      position: this.toParcel(t.p),
      yaw: this.yawOf(t.r),
      ...(t.s.some((v) => v !== 1) ? { scale: t.s } : {}),
      ...(c["primitive@1"] ? { size: c["primitive@1"].size, color: c["primitive@1"].color } : {}),
      // Texto del mundo: es un dato, nunca una instrucción.
      ...(c["label@1"] ? { text: c["label@1"].text } : {}),
      ...(c["mesh@1"] ? { model: c["mesh@1"].lods[0]!.hash } : {}),
      ...(c["light@1"] ? { light: c["light@1"].color } : {}),
      rev: e.rev,
    };
  }
}
