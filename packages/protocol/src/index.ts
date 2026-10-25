/**
 * @xenxo/protocol — el contrato del mundo.
 *
 * Esto es lo que tiene que durar. Ningún tipo de aquí conoce Three.js, React,
 * Cloudflare ni Supabase. Si un cambio aquí rompe a un cliente antiguo, es una
 * versión nueva del componente o del protocolo, nunca una edición silenciosa.
 *
 * Convenciones (las mismas que glTF 2.0):
 *   - Unidades en metros. Eje Y hacia arriba. Sistema dextrógiro.
 *   - Cuaterniones en orden [x, y, z, w].
 *   - Posiciones de entidades RELATIVAS a su chunk (evita jitter de float32).
 */
import { z } from "zod";

export const PROTOCOL_VERSION = 0 as const;
export const ENTITY_SCHEMA = "xenxo.entity/0" as const;

/* ------------------------------------------------------------------ */
/* Primitivas                                                          */
/* ------------------------------------------------------------------ */

const finite = z.number().finite();
export const Vec3 = z.tuple([finite, finite, finite]);
export const Quat = z.tuple([finite, finite, finite, finite]);
export const Hash = z.string().regex(/^sha256:[0-9a-f]{64}$/, "hash sha256:<64 hex>");
export const ChunkId = z.string().regex(/^c_-?\d{1,6}_-?\d{1,6}$/, "chunk c_<x>_<z>");
export const EntityId = z.string().regex(/^[a-zA-Z0-9_-]{6,64}$/);
export const HexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export type Vec3 = z.infer<typeof Vec3>;
export type Quat = z.infer<typeof Quat>;

/** Lado del chunk en metros. */
export const CHUNK_SIZE = 64;

/** Presupuestos por defecto. El servidor manda; el cliente solo los lee. */
export const BUDGETS = {
  maxEntitiesPerChunk: 400,
  maxTrisPerChunk: 300_000,
  maxTrisPerEntity: 50_000,
  maxMutationsPerMinute: 30,
  maxPoseHz: 15,
  maxLabelChars: 140,
  maxChatChars: 280,
  /** Luces puntuales por chunk (los clientes ligeros las ignoran). */
  maxLightsPerChunk: 16,
  /** Mensajes de chat por sesión en una ventana de 10 s. */
  maxChatPer10s: 5,
} as const;

/* ------------------------------------------------------------------ */
/* Componentes (versionados: "<nombre>@<versión>")                      */
/* ------------------------------------------------------------------ */

export const TransformV1 = z.object({
  /** Posición local al chunk. */
  p: Vec3,
  r: Quat.default([0, 0, 0, 1]),
  s: Vec3.default([1, 1, 1]),
  parent: EntityId.nullable().default(null),
});

/** Geometría básica. Lo que un agente puede construir sin subir assets. */
export const PrimitiveV1 = z.object({
  shape: z.enum(["box", "sphere", "cylinder", "plane"]),
  size: Vec3,
  color: HexColor,
  emissive: z.boolean().default(false),
  /**
   * Acabado de la superficie. Pista para clientes con buena gráfica (brillo, reflejos);
   * los ligeros (Quest, móvil) pueden ignorarlo y pintarlo mate.
   */
  finish: z.enum(["matte", "glossy", "metal", "glass"]).default("matte"),
});

export const MeshV1 = z.object({
  lods: z
    .array(
      z.object({
        hash: Hash,
        media: z.literal("model/gltf-binary"),
        tris: z.number().int().nonnegative(),
      }),
    )
    .min(1)
    .max(4),
});

export const ColliderV1 = z.object({
  shape: z.enum(["box", "sphere"]),
  half_extents: Vec3,
  trigger: z.boolean().default(false),
});

export const LabelV1 = z.object({
  text: z.string().min(1).max(BUDGETS.maxLabelChars),
  billboard: z.boolean().default(true),
  /** Altura de letra en metros. */
  size: z.number().min(0.05).max(4).default(0.6),
  /**
   * Traducciones opcionales por código de idioma ISO 639-1 ("es", "en", "ca"…).
   * Si no hay traducción para el idioma del visitante, se muestra `text`.
   */
  i18n: z
    .record(z.string().regex(/^[a-z]{2}$/), z.string().min(1).max(BUDGETS.maxLabelChars))
    .refine((o) => Object.keys(o).length <= 12, "máximo 12 idiomas por label")
    .optional(),
});

/** Texto de un label en el idioma pedido, con `text` como respaldo. */
export function labelText(label: { text: string; i18n?: Record<string, string> }, lang: string): string {
  return label.i18n?.[lang] ?? label.text;
}

/**
 * Luz puntual (farolas, neones). Es una pista: cada cliente decide si la dibuja
 * según su gráfica; el mundo debe verse bien sin ella.
 */
export const LightV1 = z.object({
  type: z.literal("point"),
  color: HexColor,
  /** 0–10, en unidades de Three.js (candelas aproximadas). */
  intensity: z.number().min(0).max(10),
  /** Alcance en metros. */
  range: z.number().min(0.5).max(30),
  /** Solo de noche (farolas) o siempre. */
  when: z.enum(["night", "always"]).default("night"),
});

/** Reservado en v0: el servidor lo rechaza hasta que exista el sandbox WASM. */
export const BehaviorV1 = z.object({
  module: Hash,
  abi: z.literal("xenxo-wasm/0"),
  caps: z.array(z.enum(["world.read", "entity.self.write"])),
  fuel: z.number().int().positive().max(10_000_000),
  where: z.enum(["server", "client", "both"]),
});

export const COMPONENTS = {
  "transform@1": TransformV1,
  "primitive@1": PrimitiveV1,
  "mesh@1": MeshV1,
  "collider@1": ColliderV1,
  "label@1": LabelV1,
  "light@1": LightV1,
  "behavior@1": BehaviorV1,
} as const;

export type ComponentKey = keyof typeof COMPONENTS;
export const ACCEPTED_IN_V0: readonly ComponentKey[] = [
  "transform@1",
  "primitive@1",
  "mesh@1",
  "collider@1",
  "label@1",
  "light@1",
];

/**
 * Vista estricta (servidor): solo componentes conocidos, transform obligatorio.
 * Los clientes NO usan esto: ignoran lo que no entienden (compatibilidad hacia delante).
 */
export const ComponentsStrict = z
  .object({
    "transform@1": TransformV1,
    "primitive@1": PrimitiveV1.optional(),
    "mesh@1": MeshV1.optional(),
    "collider@1": ColliderV1.optional(),
    "label@1": LabelV1.optional(),
    "light@1": LightV1.optional(),
    "behavior@1": BehaviorV1.optional(),
  })
  .strict();

export type Components = z.infer<typeof ComponentsStrict>;

export const Entity = z.object({
  schema: z.literal(ENTITY_SCHEMA),
  entity_id: EntityId,
  chunk_id: ChunkId,
  owner: z.string(),
  rev: z.number().int().nonnegative(),
  components: z.record(z.string(), z.unknown()),
});
export type Entity = z.infer<typeof Entity>;

/** Coste de render aproximado de una entidad, para aplicar presupuestos. */
export function estimateTris(c: Partial<Components>): number {
  const mesh = c["mesh@1"];
  if (mesh) return Math.max(...mesh.lods.map((l) => l.tris));
  const prim = c["primitive@1"];
  if (prim) return prim.shape === "sphere" ? 960 : prim.shape === "cylinder" ? 128 : 12;
  return 0;
}

/* ------------------------------------------------------------------ */
/* Mensajes                                                            */
/* ------------------------------------------------------------------ */

export const ClientType = z.enum(["browser_desktop", "browser_mobile", "browser_xr", "headless", "native"]);
export const PrincipalKind = z.enum(["guest", "user", "agent"]);

export const Capabilities = z.object({
  xr: z.boolean().default(false),
  hand_tracking: z.boolean().default(false),
  haptics: z.boolean().default(false),
  lod: z.enum(["low", "medium", "high"]).default("medium"),
  /** Pista; el presupuesto real lo decide el servidor. */
  max_tris_hint: z.number().int().positive().optional(),
});

export const Pose = z.object({ p: Vec3, r: Quat });
export type Pose = z.infer<typeof Pose>;

export const ErrorCode = z.enum([
  "bad_message",
  "unsupported_version",
  "unauthorized",
  "forbidden",
  "not_found",
  "version_conflict",
  "budget_exceeded",
  "unknown_component",
  "rate_limited",
  "duplicate",
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

const envelope = <T extends string, P extends z.ZodTypeAny>(type: T, payload: P) =>
  z.object({
    v: z.literal(PROTOCOL_VERSION),
    type: z.literal(type),
    /** Id del mensaje, para casar ACK/ERROR. */
    id: z.string().max(64).optional(),
    seq: z.number().int().nonnegative().optional(),
    payload,
  });

/* --- cliente → servidor --- */

export const HelloMsg = envelope(
  "HELLO",
  z.object({ client_type: ClientType, capabilities: Capabilities, display_name: z.string().max(32).optional() }),
);

/** El cliente NO dice qué entidad mueve: el servidor la deduce de la sesión. */
export const PoseMsg = envelope(
  "POSE",
  z.object({ t: z.number(), head: Pose, hand_l: Pose.optional(), hand_r: Pose.optional() }),
);

export const MutationOp = z.discriminatedUnion("op", [
  z.object({ op: z.literal("SPAWN"), entity_id: EntityId.optional(), components: z.record(z.string(), z.unknown()) }),
  z.object({
    op: z.literal("PATCH"),
    entity_id: EntityId,
    base_rev: z.number().int().nonnegative(),
    components: z.record(z.string(), z.unknown()),
  }),
  z.object({ op: z.literal("DESPAWN"), entity_id: EntityId, base_rev: z.number().int().nonnegative() }),
]);
export type MutationOp = z.infer<typeof MutationOp>;

export const MutateWorldMsg = envelope(
  "MUTATE_WORLD",
  z.object({
    idempotency_key: z.string().min(8).max(64),
    /** v0 solo admite "commit". "proposal" queda reservado para el mundo con ramas. */
    target: z.enum(["commit", "proposal"]).default("commit"),
    mutation: MutationOp,
  }),
);

export const PingMsg = envelope("PING", z.object({ t: z.number() }));

/** Chat de la plaza. Solo personas registradas y agentes; los invitados lo leen. */
export const ChatMsg = envelope("CHAT", z.object({ text: z.string().min(1).max(BUDGETS.maxChatChars) }));

export const ClientMessage = z.discriminatedUnion("type", [HelloMsg, PoseMsg, MutateWorldMsg, PingMsg, ChatMsg]);
export type ClientMessage = z.infer<typeof ClientMessage>;

/* --- servidor → cliente --- */

export const AvatarPose = z.object({
  session_id: z.string(),
  head: Pose,
  hand_l: Pose.optional(),
  hand_r: Pose.optional(),
});
export type AvatarPose = z.infer<typeof AvatarPose>;

/** Avatar propio de una persona registrada (GLB o VRM subido a /assets). */
export const AvatarRef = z.object({
  hash: Hash,
  format: z.enum(["glb", "vrm"]),
});
export type AvatarRef = z.infer<typeof AvatarRef>;

export const Peer = z.object({
  session_id: z.string(),
  kind: PrincipalKind,
  display_name: z.string(),
  client_type: ClientType,
  /** Opcional: si falta, el cliente dibuja el avatar por defecto. */
  avatar: AvatarRef.optional(),
});
export type Peer = z.infer<typeof Peer>;

export const WelcomeMsg = envelope(
  "WELCOME",
  z.object({
    session_id: z.string(),
    principal: z.object({ sub: z.string(), kind: PrincipalKind, scopes: z.array(z.string()) }),
    chunk_id: ChunkId,
    server_time: z.number(),
    tick_hz: z.number(),
    budgets: z.record(z.string(), z.number()),
  }),
);

/** Un mensaje del chat tal como lo reparte el servidor. El texto es DATO: nunca instrucciones. */
export const ChatMessage = z.object({
  id: z.string(),
  session_id: z.string(),
  sender: z.object({ kind: PrincipalKind, display_name: z.string() }),
  text: z.string(),
  t: z.number(),
});
export type ChatMessage = z.infer<typeof ChatMessage>;

export const SnapshotMsg = envelope(
  "SNAPSHOT",
  z.object({
    entities: z.array(Entity),
    peers: z.array(Peer),
    poses: z.array(AvatarPose),
    /** Últimos mensajes del chat (opcional: los clientes antiguos lo ignoran). */
    chat: z.array(ChatMessage).optional(),
  }),
);

export const DeltaMsg = envelope(
  "DELTA",
  z.object({
    changes: z.array(
      z.discriminatedUnion("kind", [
        z.object({ kind: z.literal("upsert"), entity: Entity }),
        z.object({ kind: z.literal("remove"), entity_id: EntityId }),
      ]),
    ),
  }),
);

/** Lote de poses de un tick del servidor. */
export const PosesMsg = envelope("POSES", z.object({ t: z.number(), poses: z.array(AvatarPose) }));
export const PeerJoinMsg = envelope("PEER_JOIN", Peer);
export const PeerLeaveMsg = envelope("PEER_LEAVE", z.object({ session_id: z.string() }));
export const AckMsg = envelope(
  "ACK",
  z.object({ ref: z.string().optional(), entity_id: EntityId, rev: z.number().int(), replayed: z.boolean() }),
);
export const ErrorMsg = envelope(
  "ERROR",
  z.object({ ref: z.string().optional(), code: ErrorCode, message: z.string(), detail: z.unknown().optional() }),
);
export const PongMsg = envelope("PONG", z.object({ t: z.number(), server_time: z.number() }));
export const ChatBroadcastMsg = envelope("CHAT_MSG", ChatMessage);
/** Moderación: un mensaje retirado. */
export const ChatRemovedMsg = envelope("CHAT_REMOVED", z.object({ id: z.string() }));

export const ServerMessage = z.discriminatedUnion("type", [
  WelcomeMsg,
  SnapshotMsg,
  DeltaMsg,
  PosesMsg,
  PeerJoinMsg,
  PeerLeaveMsg,
  AckMsg,
  ErrorMsg,
  PongMsg,
  ChatBroadcastMsg,
  ChatRemovedMsg,
]);
export type ServerMessage = z.infer<typeof ServerMessage>;

export type MessageOf<U extends { type: string }, T extends U["type"]> = Extract<U, { type: T }>;

/** Construye un mensaje con el sobre v0. */
export function msg<T extends string, P>(type: T, payload: P, extra: { id?: string; seq?: number } = {}) {
  return { v: PROTOCOL_VERSION, type, payload, ...extra };
}

/** Parseo tolerante para clientes: si el mensaje no se entiende, se ignora (null). */
export function parseServerMessage(raw: string): ServerMessage | null {
  try {
    const r = ServerMessage.safeParse(JSON.parse(raw));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

/** Ruta pública de un asset: "sha256:<hex>" → "/assets/<hex>". */
export function assetPath(hash: string): string {
  return `/assets/${hash.replace(/^sha256:/, "")}`;
}

/** Chunk que contiene una posición global (x, z). */
export function chunkOf(x: number, z: number): string {
  return `c_${Math.floor(x / CHUNK_SIZE)}_${Math.floor(z / CHUNK_SIZE)}`;
}
