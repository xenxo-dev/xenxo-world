/**
 * El kit de fundas (tools/avatars/kit/forge_kit.py → public/fundas/): la jaula de MakeHuman con sus
 * ajustes, el esqueleto, las piezas y las texturas. Se carga solo en el configurador, por partes y
 * una vez (las piezas, al elegirlas).
 */
export type Dtype = "<u2" | "<i2" | "<i4" | "<u4" | "<f4" | "u1";
type Index = Record<string, [Dtype, number, number]>;

export interface KitPart {
  id: string;
  cat: PartCat;
  file: string;
  bytes: number;
  index: Index;
  verts: number;
  tris: number;
  scale: Record<"x" | "y" | "z", [number, number, number]> | Record<string, never>;
  z: number;
  base?: "f" | "m";
  tint?: "hair" | "cloth";
  es?: string;
  en?: string;
  tex?: string;
  thumb?: string;
  alpha?: boolean;
}
export type PartCat = "body" | "eyes" | "lashes" | "brows" | "hair" | "beard" | "top" | "bottom" | "outfit" | "shoes" | "hat" | "glasses" | "gloves";

export interface Kit {
  version: number;
  unit: number;
  q: number;
  cage: number;
  bases: Record<"f" | "m", { file: string; bytes: number; index: Index }>;
  body: string[];
  face: string[];
  faceFile: { file: string; bytes: number; index: Index };
  rig: { file: string; bytes: number; index: Index; bones: { name: string; parent: number }[] };
  parts: KitPart[];
  skins: { id: string; tex: string; tone: string }[];
  eyes: string[];
  humanoid: Record<string, string>;
}

export const KIT_BASE = "/fundas/";

/** Un .bin del kit con sus arrays por nombre. */
export class Bin {
  constructor(
    private buf: ArrayBuffer,
    private index: Index,
  ) {}
  has(name: string) {
    return name in this.index;
  }
  get<T extends ArrayBufferView>(name: string): T {
    const e = this.index[name];
    if (!e) throw new Error(`falta ${name} en el kit`);
    const [type, off, n] = e;
    switch (type) {
      case "<u2":
        return new Uint16Array(this.buf, off, n) as unknown as T;
      case "<i2":
        return new Int16Array(this.buf, off, n) as unknown as T;
      case "<i4":
        return new Int32Array(this.buf, off, n) as unknown as T;
      case "<u4":
        return new Uint32Array(this.buf, off, n) as unknown as T;
      case "<f4":
        return new Float32Array(this.buf, off, n) as unknown as T;
      case "u1":
        return new Uint8Array(this.buf, off, n) as unknown as T;
    }
  }
}

const cache = new Map<string, Promise<unknown>>();
function once<T>(key: string, fn: () => Promise<T>): Promise<T> {
  let p = cache.get(key) as Promise<T> | undefined;
  if (!p) {
    p = fn();
    cache.set(key, p);
    p.catch(() => cache.delete(key));
  }
  return p;
}

async function fetchBuf(path: string): Promise<ArrayBuffer> {
  const r = await fetch(KIT_BASE + path);
  if (!r.ok) throw new Error(`kit ${path}: ${r.status}`);
  return r.arrayBuffer();
}

export function loadKit(): Promise<Kit> {
  return once("kit", async () => {
    const r = await fetch(KIT_BASE + "kit.json");
    if (!r.ok) throw new Error(`kit: ${r.status}`);
    return (await r.json()) as Kit;
  });
}

export function loadBin(path: string, index: Index): Promise<Bin> {
  return once(`bin:${path}`, async () => new Bin(await fetchBuf(path), index));
}

export function partById(kit: Kit, id: string): KitPart | undefined {
  return kit.parts.find((p) => p.id === id);
}
