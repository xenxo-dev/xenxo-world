# tools/talk — los gestos de hablar, desde el pipeline de vídeo

«Hablar con el cuerpo» (`apps/web/src/world/people/talk.ts` y `talk-pose.ts`) usa las posturas y las
reglas del pipeline de vídeo de Xen (`bench/xen_toon/mh_plano.py`, en el equipo del dueño; no es
público), que se sigue afinando. Una vez por semana, una tarea programada lee ese archivo, mira qué
ha cambiado desde la última vez y, si algo de hablar ha cambiado, lo pasa a xenxo en una PR que el
dueño aprueba (al fusionarla se despliega como todo).

- `fuente.py <mh_plano.py>` lee lo que usa hablar **sin ejecutar nada del archivo** (con `ast`): los
  datos (las manos, `POSES`, `FORMAS`, `VIVAS`, `EMOCIONES`, `SEGUIDOS`, `ALTOS` y `POLO_BRAZO`) y
  una huella de cada bloque de código de arriba del todo. Del código no se guarda más que la huella, y
  de lo que no es de hablar, ni el nombre.
  - `--diff tools/talk/mh_plano.json`: qué ha cambiado. La primera línea dice `CAMBIOS: sí` o `no`; si
    cambia un bloque de código de hablar, solo dice cuál (hay que leerlo en el archivo nuevo); lo
    nuevo de otras partes sale con su nombre, por si es de hablar.
  - `--write tools/talk/mh_plano.json [--leido <fecha ISO>]`: lo leído pasa a ser lo último que se ha traído.
- `mh_plano.json`: lo que se trajo la última vez. **`npm run test:talk -w @xenxo/web` comprueba que
  `talk.ts` es eso** (posturas, formas y conjuntos), salvo lo que es de xenxo y lo que no se trae
  (`OWN_*` y `LEFT_*` en `apps/web/test/talk.mts`): si se actualiza `mh_plano.json` y no se pasa algo,
  falla y dice qué.

## Cómo se pasa

| pipeline (`mh_plano.py`) | xenxo (`talk.ts`) |
|---|---|
| `POSES[n] = _pose(ik, y, z, d, polo)` | `P[n] = pose(ik, fingers, palm, hand, pole)`, con los mismos números: la muñeca respecto al hombro (fuera, delante, arriba; brazo de 55 cm: `SRC_ARM`), `y` = hacia dónde van los dedos, `z` = hacia dónde mira la palma |
| `d`: `SUELTA`, `MEDIA` / `ABIERTA` / `INDICE` / `PUNO` / `PULGAR` | `"relaxed"` / `"open"` / `"point"` / `"fist"` / `"thumb"` (las formas de la mano son las de xenxo, `people/hands.ts`: si en el pipeline cambian los valores de una mano, aquí no se tocan) |
| `polo` (sin él, `POLO_BRAZO` de quien no es Xen) | `pole` (sin él, `POLE`) |
| `FORMAS` (con `"cuelga"`) | `FORMS` (con `null`: lo que ya hiciera el brazo) |
| `VIVAS` | `LIVELY` |
| `SEGUIDOS` (dentro de `if GESTOS_CLAVE`) | `HELD` |
| el plan de cada frase (`_clave`, `if GESTOS_CLAVE`: trozos, variantes, golpes) | `planSay` y sus constantes |
| la vida (`gestos_clave`, `postura_en`, `RESORTE`, `_ruido`, `_pulso`, `_env`, `if VIDA`…: el muelle de la muñeca, el vaivén, la voz, el arrastre, el hombro, la cabeza) | `sampleSay`, `wristTarget`, `voice` y sus constantes |
| los brazos (`limitar_muneca`, `empuje_tronco`, `sacar_antebrazo`, `giro_antebrazo`…) | `talk-pose.ts` (`SAY_WRIST`, `fitArm`; el tronco de cada personaje sale de `rig.ts` → `trunk`) |

Un gesto nuevo entra con las palabras que lo disparan en `cueOf` (castellano, inglés y emojis; lo de
todos los días no debe dispararlo) y sus casos en `test/talk.mts`. Si una postura nueva mete una mano
en el cuerpo de algún personaje de serie, `test:talk` lo dice: se corrige lo justo (y se apunta en
`OWN_POSE`) o se deja la de antes.

## Lo que es de xenxo (se respeta al traer cambios)

- **celebra**: algo más abierta (`ik[0]` 0,13 en vez de 0,10): con hombreras, el antebrazo rozaba el hombro.
- **saluda**: la mano del gesto «wave» de xenxo (en el pipeline no hay saludo).
- **barbilla**: su mano es `"curl"` (en el pipeline, unos dedos propios), y su forma (`[[null, "barbilla"]]`) es de xenxo.
- **asiente**: solo la cabeza.
- **Del texto al gesto** (`cueOf`): en el vídeo el gesto lo dice el guion; aquí sale del mensaje.
- Lo que el vídeo no tiene: sin voz, el ritmo de las palabras (`timed`); la IK sobre VRM; el tronco
  de cada personaje; `FEATURES.talk`; los ciudadanos.

## Lo que no se trae (y por qué)

- **cuelga**: aquí, «colgar» es lo que ya esté haciendo el brazo (el reposo, andar): `null`.
- **amenaza** y **rabia**: no pegan en el chat de un mundo para todos.
- **frota**, **mando**, **jarras**, **bolsillo**, **rasca**, **manos_juntas**, **cabeza** y **salta**:
  de los guiones de la comedia; en un chat no hay palabras que las pidan (si algún día las hay, se traen).
- Lo de solo Xen (`if QUIEN == 'xen'`: con su parka, los brazos más fuera), las caras (los personajes
  de serie no tienen expresiones), las reacciones de quien escucha (`_reaccion_auto`), la captura de
  vídeo, la cámara y Blender.
