/**
 * El coche: medidas y piezas del modelo (Car Concept de Khronos, CC BY 4.0, preparado con
 * tools/models/library/concept-car.mjs, que imprime los pivotes) y su física. Metros, kilos,
 * newtons y segundos. El frente es +Z y la izquierda +X; el origen está en el suelo, en el centro
 * entre las ruedas a lo ancho (a lo largo, la carrocería va de −1,94 a 2,42).
 */
export const CAR = {
  /** Piezas de seed-assets: carrocería (con el interior), puertas y ruedas (izquierda y derecha). */
  models: { body: "vehicle_car", doorL: "vehicle_car_door_l", doorR: "vehicle_car_door_r", wheelL: "vehicle_car_wheel_l", wheelR: "vehicle_car_wheel_r" },
  /** Medidas de la carrocería (sin retrovisores). */
  length: 4.36,
  centerZ: 0.24,
  width: 2.24,
  height: 1.15,
  /** Eje de cada rueda (delante izquierda, delante derecha, detrás izquierda, detrás derecha). */
  wheels: [
    { x: 0.975, y: 0.384, z: 1.486, front: true, left: true },
    { x: -0.977, y: 0.384, z: 1.484, front: true, left: false },
    { x: 0.983, y: 0.384, z: -1.314, front: false, left: true },
    { x: -0.982, y: 0.384, z: -1.314, front: false, left: false },
  ],
  wheelRadius: 0.384,
  /** Bisagras de las puertas (giran en vertical; la izquierda abre con giro negativo) y cuánto abren. */
  hingeL: { x: 1.089, y: 0.643, z: 0.998 },
  hingeR: { x: -1.087, y: 0.643, z: 0.998 },
  doorOpen: 1.05,
  /**
   * Quien conduce va en el centro (es un concept con el puesto de mando central): dónde se apoya el
   * personaje sentado (sus pies, mirando a +Z), sus ojos (primera persona) y dónde se pone de pie
   * fuera, entre la puerta abierta y la carrocería.
   */
  seat: { x: 0, y: -0.15, z: 0.45 },
  eye: { x: 0, y: 0.93, z: 0.3 },
  entry: { x: 1.62, z: -0.3 },
  /** Pinturas de serie (la de cada coche sale de quien lo conduce). */
  paints: ["#a3121b", "#16181d", "#e6e7ea", "#59616d", "#1c3d78", "#0e5a49", "#c99a1f", "#5e1b52"],

  /* --- Física (vehículo de rayos de Rapier: cada rueda es un rayo con muelle y amortiguador) --- */
  mass: 1350,
  /** Centro de masas bajo (respecto al origen): no vuelca en una curva normal. */
  centerOfMass: { x: 0, y: 0.42, z: 0.22 },
  /** Muelle: largo en reposo, recorrido, dureza y amortiguación (escalados por la masa, como Bullet). */
  suspensionRest: 0.26,
  suspensionTravel: 0.2,
  suspensionStiffness: 34,
  suspensionCompression: 3.6,
  suspensionRelaxation: 4.4,
  suspensionMaxForce: 45000,
  /** Agarre de los neumáticos: delante un poco más que detrás (con el freno de mano, derrapa). */
  frictionFront: 2.7,
  frictionRear: 2.4,
  frictionRearHandbrake: 0.9,
  /** Motor (tracción trasera): fuerza por rueda y velocidades máximas (m/s). */
  engineForce: 3600,
  topSpeed: 31,
  reverseSpeed: 7,
  /** Frenos (impulso por rueda en cada paso de 1/60 s) y freno motor. */
  brake: 46,
  handbrake: 72,
  engineBrake: 3,
  /** Aire y rodadura. */
  drag: 0.4,
  rolling: 170,
  /** Dirección: giro máximo de las ruedas (rad) en parado; a más velocidad, menos. */
  steerMax: 0.6,
  steerSpeedFalloff: 14,
  /** Rapidez del volante (rad/s). */
  steerRate: 2.6,
} as const;

/** Lo que pide quien conduce, de -1 a 1 (y el freno de mano). */
export interface Drive {
  throttle: number;
  steer: number;
  handbrake: boolean;
}

/** Pintura del coche de alguien (siempre la misma para la misma sesión). */
export function paintFor(seed: string): string {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return CAR.paints[(h >>> 0) % CAR.paints.length]!;
}
