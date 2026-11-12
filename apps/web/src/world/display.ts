/**
 * Los mismos colores con y sin post-proceso.
 *
 * Sin post-proceso (gafas, móviles, nivel ligero) cada material sale ya como se ve: los que llevan
 * luz, con su mapeo de tonos; una foto (el cielo de día), un tono medido en ella o lo que se pinta a
 * juego con ella (la megaciudad del nexo), tal cual. Con post-proceso (escritorio) todo se pinta
 * antes en un búfer lineal y el mapeo de tonos (ACES) se le pasa al final a la imagen entera: también
 * a las fotos, que salían apagadas y lechosas, y a la bruma, que se mezclaba en lineal y de día
 * espesaba el doble.
 *
 * Aquí está lo que hace falta para que lo que ya es «como se ve» llegue igual a la pantalla por los
 * dos caminos:
 *  - `DISPLAY_GLSL`, para los shaders propios: `xenxoLinearOut()` (¿estoy pintando en ese búfer?),
 *    `xenxoAces(c)` (el mapeo de tonos de Three.js, para hacerlo a mano) y `xenxoShown(c)` (deja un
 *    color «como se ve» de forma que el mapeo del final lo devuelva igual; lo muy claro, con un
 *    hombro suave para no pasar de 1 y que no lo encienda el bloom).
 *  - la bruma de los materiales de Three.js (`fog_fragment`): si es clara (de día), en ese búfer se
 *    mezcla como en la pantalla; la oscura (de noche) sigue como estaba.
 *
 * Se sabe en qué camino se está por la conversión de salida que Three.js pone a cada shader
 * (`linearToOutputTexel`): hacia la pantalla o las gafas, sRGB; hacia un búfer, ninguna.
 */
import * as THREE from "three";

export const DISPLAY_GLSL = /* glsl */ `
  bool xenxoLinearOut() { return linearToOutputTexel(vec4(0.5, 0.5, 0.5, 1.0)).r < 0.6; }
  // ACESFilmicToneMapping de Three.js (con exposición 1), tal cual.
  vec3 xenxoAces(vec3 color) {
    const mat3 inMat = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
    const mat3 outMat = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
    vec3 v = inMat * (color / 0.6);
    vec3 a = v * (v + 0.0245786) - 0.000090537;
    vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
    return clamp(outMat * (a / b), 0.0, 1.0);
  }
  // Su inversa: qué hay que pintar para que, tras el mapeo, salga ese color.
  vec3 xenxoUnAces(vec3 shown) {
    const mat3 inInv = mat3(vec3(1.76474, -0.14703, -0.03634), vec3(-0.67578, 1.16025, -0.16244), vec3(-0.08896, -0.01322, 1.19877));
    const mat3 outInv = mat3(vec3(0.64304, 0.05927, 0.00596), vec3(0.31119, 0.93144, 0.06393), vec3(0.04578, 0.00929, 0.93012));
    vec3 y = clamp(outInv * shown, 0.0, 0.99);
    vec3 A = 1.0 - 0.983729 * y;
    vec3 B = 0.0245786 - 0.4329510 * y;
    vec3 C = -(0.000090537 + 0.238081 * y);
    vec3 v = (-B + sqrt(max(B * B - 4.0 * A * C, 0.0))) / (2.0 * A);
    return max(inInv * v, 0.0) * 0.6;
  }
  vec3 xenxoShown(vec3 c) {
    if (!xenxoLinearOut()) return c;
    // El mapeo no da más de 0,76: lo más claro se comprime hacia ahí (conservando el tono) en vez de
    // cortarse, y así lo que se pinta no pasa de 1.
    float peak = max(c.r, max(c.g, c.b));
    if (peak > 0.6) c *= (0.6 + 0.16 * (1.0 - exp(-(peak - 0.6) / 0.16))) / peak;
    return min(xenxoUnAces(c), vec3(1.0));
  }
`;

let patched = false;

/**
 * La bruma de los materiales de Three.js, igual por los dos caminos (ver arriba). Una vez, antes
 * de que se compile ningún material.
 */
export function patchFog() {
  if (patched) return;
  patched = true;
  THREE.ShaderChunk.fog_fragment = /* glsl */ `
#ifdef USE_FOG
	#ifdef FOG_EXP2
		float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
	#else
		float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
	#endif
	// xenxo (display.ts): en el búfer lineal del post-proceso, la bruma clara se mezcla como en la pantalla.
	float xenxoBright = linearToOutputTexel( vec4( 0.5, 0.5, 0.5, 1.0 ) ).r < 0.6 ? smoothstep( 0.08, 0.3, dot( fogColor, vec3( 0.2126, 0.7152, 0.0722 ) ) ) : 0.0;
	if ( xenxoBright > 0.0 ) {
		vec3 xenxoMixed = pow( mix( pow( max( gl_FragColor.rgb, vec3( 0.0 ) ), vec3( 0.4545 ) ), pow( fogColor, vec3( 0.4545 ) ), fogFactor ), vec3( 2.2 ) );
		gl_FragColor.rgb = mix( mix( gl_FragColor.rgb, fogColor, fogFactor ), xenxoMixed, xenxoBright );
	} else {
		gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
	}
#endif
`;
}
