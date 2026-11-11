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
   * Quien conduce va en el centro (es un concept con el puesto de mando central) y recostado, como en
   * un deportivo de verdad (sentado como en una silla, la cabeza atravesaba el techo): dónde queda su
   * cadera, cuánto se echa hacia atrás (rad), sus ojos (primera persona) y dónde se pone de pie fuera,
   * entre la puerta abierta y la carrocería. En la animación de sentarse (sit_idle) la cadera queda
   * 54 cm por encima de los pies y 33 cm por detrás.
   */
  driverHips: { x: 0, y: 0.28, z: 0.12 },
  lean: 0.42,
  sitHips: { up: 0.54, back: 0.33 },
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
  /**
   * El casco con el que choca la carrocería (alturas sobre el suelo, m): los bajos entre los ejes
   * (`keel`: su media anchura, por dentro de las ruedas), el morro y la cola más altos (en cuña), el
   * estribo —desde ahí el costado va a todo lo ancho— y la línea de la cintura; encima, el habitáculo.
   * `round`: el radio de sus cantos.
   */
  hull: { belly: 0.24, keel: 0.62, nose: 0.54, tail: 0.5, sill: 0.5, top: 0.74, round: 0.09 },
  /** Rozamiento de la chapa contra lo que toque (paredes, quitamiedos): poco, para rozar sin clavarse. */
  bodyFriction: 0.08,
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
  /**
   * Apoyo aerodinámico (N por cada m²/s² de velocidad, hacia el suelo del coche y solo con ruedas
   * apoyadas): a 110 km/h pesa casi el doble. Es lo que lo pega a un peralte o a lo alto del looping.
   */
  downforce: 14,
  /**
   * Topes de la suspensión: a partir de `bumpFrom` m de compresión el muelle se va endureciendo,
   * hasta `1 + bumpGain` veces al final del recorrido. Con el muelle de calle solo, un apoyo fuerte
   * (el pie del looping, la caída de un salto) lo aplastaba y rozaba la carrocería.
   */
  bumpFrom: 0.11,
  bumpGain: 3,
  /**
   * En el aire (un salto, un cambio de rasante): el coche se alinea con hacia donde vuela, como una
   * flecha, a `airAlign` rad/s por cada radián que se desvía; `airBlend` es cuánto se acerca a eso en
   * cada paso. Sin esto, al despegar agacha el morro (las ruedas de delante dejan la rampa antes) y
   * cae de punta.
   */
  airAlign: 3.5,
  airBlend: 0.12,
  /**
   * Looping: subiendo en vertical o del revés con las ruedas apoyadas, no baja de `loopHold` m/s
   * (un empujón de hasta `loopPush` m/s²): arriba (9 m de radio) hacen falta 9,4 m/s para no caerse.
   */
  loopHold: 16,
  loopPush: 26,
  /**
   * Y allí las ruedas agarran de lado solo esta parte de lo normal (al coche lo guían los
   * quitamiedos: el looping lo cambia de carril) y el morro se alinea con la velocidad a `loopAlign`
   * rad/s por cada radián de desvío (`loopAlignBlend`: cuánto se acerca a eso en cada paso).
   */
  loopSideGrip: 0.15,
  loopAlign: 6,
  loopAlignBlend: 0.25,
  /** Placas de turbo: lo que suman de golpe (m/s) y hasta qué velocidad (m/s). */
  turboKick: 7,
  turboMax: 38,
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

/**
 * Dónde van los pies de quien conduce (en ejes del coche) para que, echado `lean` hacia atrás, su
 * cadera caiga en `driverHips`. El giro del personaje es: el del coche · inclinación (−lean en X) ·
 * media vuelta en Y (los personajes miran a −Z).
 */
export function driverRoot(lean: number = CAR.lean): { x: number; y: number; z: number } {
  const t = -lean;
  const y0 = CAR.sitHips.up, z0 = -CAR.sitHips.back; // la cadera respecto a los pies, ya girada media vuelta
  const y = y0 * Math.cos(t) - z0 * Math.sin(t);
  const z = y0 * Math.sin(t) + z0 * Math.cos(t);
  return { x: CAR.driverHips.x, y: CAR.driverHips.y - y, z: CAR.driverHips.z - z };
}

/** Pintura del coche de alguien (siempre la misma para la misma sesión). */
export function paintFor(seed: string): string {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return CAR.paints[(h >>> 0) % CAR.paints.length]!;
}
