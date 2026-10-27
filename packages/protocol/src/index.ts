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

/**
 * Lugares con nombre propio. El nexo es la entrada: un vestíbulo fuera del mapa con
 * portales a los distritos (la plaza) y a los proyectos de la comunidad.
 */
export const PLACES = { nexo: "c_0_-1000", plaza: "c_0_0" } as const;

/** Categorías de proyecto que los clientes conocen (otras se tratan como "other"). */
export const PROJECT_CATEGORIES = ["game3d", "game2d", "social", "tool", "other"] as const;
export type ProjectCategory = (typeof PROJECT_CATEGORIES)[number];

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

/**
 * Lo que puede construir el agente de una parcela (10 × 10 m, hasta maxHeight m de alto). Cuenta
 * lo de su proyecto, no lo del chunk: 16 parcelas llenas caben en un distrito y en unas gafas.
 */
export const PARCEL_BUDGETS = { maxEntities: 48, maxTris: 24_000, maxLights: 1, maxHeight: 12 } as const;

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
  /**
   * Estilo del rótulo: "plain" (texto claro con contorno, el de siempre) o "neon"
   * (letras de tubo de neón que se encienden de noche). Los clientes que no lo
   * conozcan lo dibujan como "plain".
   */
  style: z.string().regex(/^[a-z_]{1,16}$/).default("plain"),
  /** Color del texto (o del neón). Si falta, el cliente elige uno legible. */
  color: HexColor.optional(),
  /**
   * Ancho máximo en metros: el texto se parte en varias líneas centradas. Si falta, una línea.
   * Los clientes que no lo conozcan lo dibujan en una línea.
   */
  width: z.number().min(0.5).max(40).optional(),
  /**
   * Distancia (m) a partir de la cual el texto se desvanece y deja de verse: para los textos
   * secundarios, que solo hacen falta de cerca. Si falta, se ve siempre.
   */
  max_distance: z.number().min(1).max(500).optional(),
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

/**
 * Portal: un marco de `size` metros (ancho × alto), centrado en el transform y mirando a +Z.
 * Un cliente lo activa cuando el jugador entra en la franja de PORTAL_ZONE_DEPTH metros delante
 * del marco (y tan ancha como él):
 *  - `chunk`: viaja a ese chunk (y aparece en `spawn` mirando hacia `yaw` grados, si vienen).
 *  - `project`: muestra la ficha del proyecto del Directory (portada, autor, enlace). Nunca
 *    abre un enlace sin que la persona pulse: el enlace sale del Directory, no del portal.
 */
/** Fondo de la franja que activa un portal, delante del marco (m). Llega hasta su peana. */
export const PORTAL_ZONE_DEPTH = 3.4;

export const PortalV1 = z.object({
  to: z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("chunk"),
      chunk_id: ChunkId,
      spawn: Vec3.optional(),
      /** Hacia dónde mira al llegar, en grados (0 = norte, −Z; 90 = oeste). */
      yaw: z.number().min(-360).max(360).optional(),
    }),
    z.object({ kind: z.literal("project"), project_id: z.string().regex(/^[a-zA-Z0-9_-]{4,40}$/) }),
  ]),
  size: z.tuple([z.number().min(0.5).max(16), z.number().min(0.5).max(16)]).default([4, 2.25]),
  /** Portada (imagen subida con /assets?kind=cover). Sin portada, el cliente dibuja un velo de luz. */
  cover: Hash.optional(),
  /** Nombre que se enseña al acercarse (dato, no instrucciones). */
  title: z.string().min(1).max(BUDGETS.maxLabelChars).optional(),
  i18n: z
    .record(z.string().regex(/^[a-z]{2}$/), z.string().min(1).max(BUDGETS.maxLabelChars))
    .refine((o) => Object.keys(o).length <= 12, "máximo 12 idiomas")
    .optional(),
  /** Categoría ("game3d", "game2d", "social", "tool", "other"…): pista de color para el cliente. */
  category: z.string().regex(/^[a-z0-9_]{1,16}$/).optional(),
  /** Color del velo de luz (sin portada). Si no está, el de la categoría. */
  color: HexColor.optional(),
  /**
   * Cerrado («próximamente»): el cliente lo dibuja apagado y, al entrar en su franja, solo avisa;
   * no viaja. El servidor del destino tampoco deja entrar (salvo a moderación).
   */
  closed: z.boolean().optional(),
});

/**
 * Holograma: la geometría de la entidad (su `mesh@1` o su `primitive@1`) se dibuja como luz
 * proyectada, translúcida y del color dado, con líneas de barrido. No hace sombra ni tapa nada.
 * Los clientes que no lo conozcan la dibujan normal.
 */
export const HologramV1 = z.object({
  color: HexColor.optional(),
  /** 0,05–1: cuánto se ve (por defecto 0,6). */
  opacity: z.number().min(0.05).max(1).default(0.6),
});

/* --- Actividades (búsquedas, carreras y marcadores). Las valida el servidor del lugar. --- */

/** Nombre corto de una búsqueda o una carrera (único por dueño dentro del lugar). */
export const ActivityId = z.string().regex(/^[a-z0-9_-]{1,32}$/);

/**
 * Objeto de una búsqueda: se recoge al acercarse (`radius` m). El cliente avisa con COLLECT y el
 * servidor comprueba que la pose de esa sesión esté cerca de verdad. Cada cuenta lleva su cuenta;
 * lo recogido deja de dibujarse para quien ya lo tiene. Lo que se ve es su `mesh@1` o `primitive@1`.
 */
/** Texto corto de una actividad en varios idiomas (dato del mundo, nunca instrucciones). */
export const ActivityNote = z
  .record(z.string().regex(/^[a-z]{2}$/), z.string().min(1).max(240))
  .refine((o) => Object.keys(o).length <= 12, "máximo 12 idiomas");

export const CollectibleV1 = z.object({
  set: ActivityId,
  radius: z.number().min(0.5).max(5).default(1.5),
  /** Lo que cuenta al recogerlo (un trozo de historia). Opcional; viaja en COLLECTED. */
  note: ActivityNote.optional(),
});

/**
 * Punto de una carrera: `start` (salida), `cp` (en orden por `order`, desde 1) y `finish` (meta).
 * El cliente avisa con CHECKPOINT al entrar en el círculo de `radius` m; el tiempo lo mide el
 * servidor, que exige el orden y la cercanía y rechaza lo imposible de rápido.
 */
export const CheckpointV1 = z.object({
  race: ActivityId,
  role: z.enum(["start", "cp", "finish"]),
  order: z.number().int().min(0).max(63).default(0),
  radius: z.number().min(0.5).max(8).default(2.5),
});

/**
 * Tablero de baldosas (el juego de la plaza de Píxel): `cols` × `rows` baldosas de `size` m,
 * centrado en la entidad y en el suelo (sin giro). El servidor enciende una figura cada ronda
 * mientras hay alguien encima y la marca como pisada con la pose de cada sesión (TILES); el
 * cliente solo la dibuja. Cada ronda ganada da un punto del día a cada cuenta que pisó alguna.
 */
export const TilesV1 = z.object({
  id: ActivityId,
  cols: z.number().int().min(2).max(12).default(8),
  rows: z.number().int().min(2).max(12).default(8),
  size: z.number().min(1).max(5).default(3),
});

/**
 * Placa de impulso: quien la pisa corre más durante unos segundos (en el cliente; el servidor no
 * cuenta nada). Para las carreras: `speed` no pasa de 12 m/s, por debajo del límite con el que el
 * servidor anula un tiempo imposible. Las gafas la ignoran (allí manda el casco).
 */
export const BoostV1 = z.object({
  speed: z.number().min(6).max(12).default(9),
  seconds: z.number().min(0.5).max(4).default(2),
  radius: z.number().min(0.5).max(5).default(1.8),
});

/** Marcador de una carrera o una búsqueda de este lugar (y del mismo dueño). El cliente pide SCORES. */
export const ScoreboardV1 = z.object({
  /** `points`: puntos (el tablero de baldosas); `builds`: lo que construyen los agentes en las parcelas. */
  kind: z.enum(["race", "hunt", "points", "builds"]),
  /**
   * De cuándo: `all` (de siempre; por defecto en carreras y búsquedas), `week` (semana ISO, UTC)
   * o `day` (hoy, UTC; por defecto en los puntos).
   */
  period: z.enum(["all", "week", "day"]).optional(),
  id: ActivityId,
  /** Tamaño del panel (ancho × alto, m). */
  size: z.tuple([z.number().min(1).max(12), z.number().min(1).max(8)]).default([4, 3]),
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
  "portal@1": PortalV1,
  "hologram@1": HologramV1,
  "collectible@1": CollectibleV1,
  "checkpoint@1": CheckpointV1,
  "scoreboard@1": ScoreboardV1,
  "boost@1": BoostV1,
  "tiles@1": TilesV1,
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
  "portal@1",
  "hologram@1",
  "collectible@1",
  "checkpoint@1",
  "scoreboard@1",
  "boost@1",
  "tiles@1",
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
    "portal@1": PortalV1.optional(),
    "hologram@1": HologramV1.optional(),
    "collectible@1": CollectibleV1.optional(),
    "checkpoint@1": CheckpointV1.optional(),
    "scoreboard@1": ScoreboardV1.optional(),
    "boost@1": BoostV1.optional(),
    "tiles@1": TilesV1.optional(),
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
  z.object({
    client_type: ClientType,
    capabilities: Capabilities,
    display_name: z.string().max(32).optional(),
    /**
     * Avatar de serie elegido por un invitado o un agente (solo los que publica el servidor).
     * Las personas registradas llevan el de su cuenta y esto se ignora.
     */
    avatar: z.lazy(() => AvatarRef).optional(),
  }),
);

/** El cliente NO dice qué entidad mueve: el servidor la deduce de la sesión. */
/**
 * Gesto que el avatar está haciendo ("dance", "wave", "sit", "talk"…). Es texto libre corto:
 * cada cliente reproduce los que conoce y trata los demás como si no hubiera gesto.
 */
export const Emote = z.string().regex(/^[a-z_]{1,24}$/);
export const EMOTES = ["dance", "wave", "sit", "talk", "cheer", "crouch"] as const;

export const PoseMsg = envelope(
  "POSE",
  z.object({ t: z.number(), head: Pose, hand_l: Pose.optional(), hand_r: Pose.optional(), emote: Emote.optional() }),
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

/** Actividades: «estoy en este objeto / este punto de carrera» y «dame el marcador». */
export const CollectMsg = envelope("COLLECT", z.object({ entity_id: EntityId }));
export const CheckpointMsg = envelope("CHECKPOINT", z.object({ entity_id: EntityId }));
export const ScoresRequestMsg = envelope("SCORES_GET", z.object({ entity_id: EntityId }));

export const ClientMessage = z.discriminatedUnion("type", [HelloMsg, PoseMsg, MutateWorldMsg, PingMsg, ChatMsg, CollectMsg, CheckpointMsg, ScoresRequestMsg]);
export type ClientMessage = z.infer<typeof ClientMessage>;

/* --- servidor → cliente --- */

export const AvatarPose = z.object({
  session_id: z.string(),
  head: Pose,
  hand_l: Pose.optional(),
  hand_r: Pose.optional(),
  emote: Emote.optional(),
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
  /** Número de jugador de una persona registrada (por orden de alta; el 0 es el fundador). */
  player_no: z.number().int().min(0).optional(),
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
    /**
     * Lugar en solitario (el nexo): no hay más gente, ni poses, ni chat. El cliente no manda POSE
     * y no enseña el chat. Sin el campo, el lugar es compartido.
     */
    solo: z.boolean().optional(),
    /**
     * Hasta dónde se puede caminar, en metros del chunk (mín. y máx. en X y en Z). En lugares más
     * grandes que su chunk (el nexo, en solitario, y los distritos grandes, compartidos: en ellos las
     * poses llegan solo de quien está cerca). Sin el campo: 1..CHUNK_SIZE-1.
     */
    walk: z.tuple([z.number(), z.number()]).optional(),
    /**
     * Pista de decorado de un distrito: qué ciudad de fondo dibujar alrededor (uno de
     * DISTRICT_THEMES) y su color. Un cliente que no la entienda la ignora.
     */
    theme: z.object({ id: z.string().regex(/^[a-z0-9_-]{1,24}$/), color: z.string().regex(/^#[0-9a-fA-F]{6}$/) }).optional(),
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

/** Lo que esta cuenta ya tiene en este lugar (tras el SNAPSHOT; solo personas registradas). */
export const ProgressMsg = envelope(
  "PROGRESS",
  z.object({
    collected: z.array(EntityId),
    /** Mejor tiempo (ms) de cada carrera de este lugar, por la entidad de su salida. */
    best: z.record(z.string(), z.number().int().nonnegative()),
  }),
);
/** Un objeto recogido: cuántos lleva de su búsqueda y si la ha completado. */
export const CollectedMsg = envelope(
  "COLLECTED",
  z.object({
    entity_id: EntityId,
    set: ActivityId,
    count: z.number().int(),
    total: z.number().int(),
    complete: z.boolean(),
    /** El texto del objeto (`collectible@1.note`), si lo tiene. */
    note: ActivityNote.optional(),
  }),
);
/**
 * Estado de la carrera de esta sesión: `start` (el servidor empieza a contar), `cp` (`next` = el
 * siguiente punto que toca), `finish` (`ms`, `best` y `rank` en el marcador) o `reset` (se canceló).
 */
export const RaceMsg = envelope(
  "RACE",
  z.object({
    race: ActivityId,
    state: z.enum(["start", "cp", "finish", "reset"]),
    next: z.number().int().optional(),
    total: z.number().int().optional(),
    ms: z.number().int().nonnegative().optional(),
    best: z.number().int().nonnegative().optional(),
    rank: z.number().int().positive().optional(),
  }),
);
/** Marcador (los 10 primeros): tiempo en ms en las carreras; fecha en la que se completó, en las búsquedas. */
export const ScoresMsg = envelope(
  "SCORES",
  z.object({
    entity_id: EntityId,
    kind: z.enum(["race", "hunt", "points", "builds"]),
    period: z.enum(["all", "week", "day"]).optional(),
    rows: z.array(z.object({ name: z.string(), player_no: z.number().int().min(0).optional(), value: z.number(), ts: z.number() })),
  }),
);

/**
 * Estado de un tablero de baldosas (a todo el lugar): `show` (ronda en juego: `lit` encendidas,
 * `done` ya pisadas, `ms_left`), `won`/`lost` (fin de ronda) o `idle` (nadie encima). Las
 * baldosas van por índice: fila × cols + columna, desde la esquina noroeste.
 */
export const TilesMsg = envelope(
  "TILES",
  z.object({
    entity_id: EntityId,
    round: z.number().int().nonnegative(),
    state: z.enum(["show", "won", "lost", "idle"]),
    lit: z.array(z.number().int().min(0).max(143)),
    done: z.array(z.number().int().min(0).max(143)),
    ms_left: z.number().int().nonnegative().optional(),
  }),
);

export const ServerMessage = z.discriminatedUnion("type", [
  ProgressMsg,
  TilesMsg,
  CollectedMsg,
  RaceMsg,
  ScoresMsg,
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

/* ------------------------------------------------------------------ */
/* xenxo.json: la ficha de un juego (en la raíz de su web)              */
/* ------------------------------------------------------------------ */

export const GAME_MANIFEST_SCHEMA = "xenxo.game/0" as const;

/** Texto en varios idiomas: español e inglés obligatorios; otros, opcionales (código de 2 letras). */
const GameText = (max: number) =>
  z
    .object({ es: z.string().trim().min(1).max(max), en: z.string().trim().min(1).max(max) })
    .catchall(z.string().trim().min(1).max(max))
    .refine((o) => Object.keys(o).every((k) => /^[a-z]{2}$/.test(k)), "idiomas: códigos de 2 letras (es, en, ca…)");

const HttpsUrl = z.string().max(300).regex(/^https:\/\/[^\s]+$/, "https://…");

/**
 * Ficha del juego (v0). El servidor la lee al registrar el juego (fase 4) y la plantilla
 * `create-xenxo` la trae rellena. `privacy` y `thumbnail` se exigen al publicar, no al desarrollar.
 */
export const GameManifest = z
  .object({
    schema: z.literal(GAME_MANIFEST_SCHEMA),
    name: GameText(60),
    description: GameText(280),
    category: z.enum(PROJECT_CATEGORIES),
    /** En qué equipos funciona. */
    devices: z.array(z.enum(["pc", "mobile", "vr"])).min(1).max(3),
    multiplayer: z.boolean(),
    /**
     * Qué se ve de quien entra con xenxo dentro del juego:
     *  - "character": manejas un personaje y es el tuyo de xenxo (sin cuenta, uno de serie).
     *  - "badge": no hay personaje, pero se ven tu nombre y tu número (y, si quiere, tu retrato).
     *  - "none": el juego no usa tu identidad de xenxo.
     * Si falta: "badge" con «Entrar con xenxo» (`xenxo.clientId`) y "none" sin él. Con «Entrar con
     * xenxo», "none" no vale. La revisión comprueba que sea verdad.
     */
    avatar: z.enum(["character", "badge", "none"]).optional(),
    /** "all" o "+14": los invitados solo abren juegos "all" y revisados. */
    ageRating: z.enum(["all", "+14"]),
    /** Anuncios o compras dentro del juego (se avisan antes de abrirlo). Nunca juego con dinero real. */
    monetization: z.object({ hasAds: z.boolean(), hasPurchases: z.boolean() }).strict(),
    author: z.string().trim().min(1).max(60),
    /** Un email o una web de contacto. */
    contact: z.string().trim().min(3).max(200),
    /** Página de privacidad del juego (https). */
    privacy: HttpsUrl.optional(),
    /** Portada 16:9: ruta de la propia web ("/portada.webp") o https. */
    thumbnail: z.string().max(300).regex(/^(\/[^\s]*|https:\/\/[^\s]+)$/, "/ruta o https://…").optional(),
    /** ¿Se puede abrir dentro de xenxo (iframe aislado)? Si no, solo por portal. */
    embed: z.boolean().default(true),
    /** Lo que da xenxo al registrar: el juego para «Entrar con xenxo» y su proyecto (su parcela). */
    xenxo: z
      .object({
        clientId: z.string().regex(/^xg_[A-Za-z0-9_]{6,30}$/).optional(),
        project: z.string().regex(/^[A-Za-z0-9_-]{4,40}$/).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type GameManifest = z.infer<typeof GameManifest>;
export * from "./district-kit";
