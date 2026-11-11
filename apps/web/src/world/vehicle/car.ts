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
   * Quien conduce va en el centro (es un concept con el puesto de mando central), sentado en su
   * asiento de verdad: un baquet hondo, con el cojín a 12 cm del suelo en lo más bajo (z = 0,65), que
   * sube hasta 29 cm en el borde de delante (z = 1,0), y el respaldo echado atrás (de z = 0,49 a la
   * altura de la cadera a z = 0,22 a la de la nuca). `driverHips`: dónde queda su cadera (9 cm sobre
   * el cojín, 12 por delante del respaldo); `lean`: cuánto va recostado (rad); `grip`: dónde se coge
   * el aro del volante a las nueve y las tres (el aro va de y = 0,51 a 0,79, inclinado) y `wrist`,
   * dónde queda la muñeca con la mano cerrada sobre él (x: la izquierda; la derecha, en espejo).
   * `sitHips`: en la animación de sentarse (sit_enter) la cadera acaba 54 cm por encima de los pies y
   * 33 por detrás (para subir y bajar; sentado, la cadera la fija el asiento: people/rig.ts → `seat`).
   * `eye`: sus ojos (primera persona). `entry`: dónde se pone de pie fuera, entre la puerta abierta y
   * la carrocería.
   */
  driverHips: { x: 0, y: 0.22, z: 0.63 },
  lean: 0.45,
  grip: { x: 0.165, y: 0.64, z: 0.93 },
  wrist: { x: 0.19, y: 0.645, z: 0.855 },
  /**
   * Los pedales: dónde quedan los tobillos (el izquierdo, en el reposapiés; el derecho, en el
   * acelerador), a los lados de la columna del volante, con el talón en el suelo (a 9 cm).
   */
  ankleL: { x: 0.2, y: 0.18, z: 1.33 },
  ankleR: { x: -0.19, y: 0.19, z: 1.37 },
  /**
   * El techo: lo más alto que puede quedar la coronilla sobre la cadera (el forro está a 1,05 m del
   * suelo). A quien mide más sentado se le recuesta más (`leanFor`), hasta `leanMax`.
   */
  headroom: 0.78,
  leanMax: 0.62,
  sitHips: { up: 0.54, back: 0.33 },
  eye: { x: 0, y: 0.9, z: 0.4 },
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
  /**
   * La salida del looping: desde lo alto hasta volver al llano, la velocidad de lado (respecto a
   * la dirección de la pista) se pierde a este ritmo (1/s). El looping cambia de carril: sin esto el
   * coche salía cruzado (8° hacia el otro lado, lo que le había dado el quitamiedos a media vuelta)
   * y, si no se corregía a tiempo, iba rozando el quitamiedos hasta el salto y caía sobre él. Así
   * baja pegado al quitamiedos de fuera y sale recto por su carril.
   */
  loopExitGrip: 5,
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
 * Dónde va la raíz (los pies) de quien se sienta (en ejes del coche) para que, echado `lean` hacia
 * atrás y con la pose de sentarse, su cadera caiga en `driverHips`. El giro del personaje es: el del
 * coche · inclinación (−lean en X) · media vuelta en Y (los personajes miran a −Z). Sin objetos
 * nuevos si se le pasa dónde escribir.
 */
export function driverRoot(lean: number = CAR.lean, out: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 }): { x: number; y: number; z: number } {
  const t = -lean;
  const y0 = CAR.sitHips.up, z0 = -CAR.sitHips.back; // la cadera respecto a los pies, ya girada media vuelta
  const y = y0 * Math.cos(t) - z0 * Math.sin(t);
  const z = y0 * Math.sin(t) + z0 * Math.cos(t);
  out.x = CAR.driverHips.x;
  out.y = CAR.driverHips.y - y;
  out.z = CAR.driverHips.z - z;
  return out;
}

/**
 * Cuánto va recostado (rad) quien mide `sitHeight` de la cadera a la coronilla: lo del asiento y, si
 * no cabe bajo el techo, lo que haga falta (los personajes van de 1,49 a 2,02 m).
 */
export function leanFor(sitHeight: number): number {
  const need = Math.acos(Math.min(1, CAR.headroom / Math.max(0.3, sitHeight)));
  return Math.min(CAR.leanMax, Math.max(CAR.lean, need));
}

/** Pintura del coche de alguien (siempre la misma para la misma sesión). */
export function paintFor(seed: string): string {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return CAR.paints[(h >>> 0) % CAR.paints.length]!;
}
