// Fuente empaquetada con la app: los textos 3D no dependen de ningún CDN externo.
import inter from "@fontsource/inter/files/inter-latin-600-normal.woff?url";
import interLatinExt from "@fontsource/inter/files/inter-latin-ext-600-normal.woff?url";
import interCyrillic from "@fontsource/inter/files/inter-cyrillic-600-normal.woff?url";
import interCyrillicExt from "@fontsource/inter/files/inter-cyrillic-ext-600-normal.woff?url";
import interGreek from "@fontsource/inter/files/inter-greek-600-normal.woff?url";
import interGreekExt from "@fontsource/inter/files/inter-greek-ext-600-normal.woff?url";
import interVietnamese from "@fontsource/inter/files/inter-vietnamese-600-normal.woff?url";
import { Text as TroikaText, configureTextBuilder } from "troika-three-text";
import { COVERAGE } from "./font-coverage";

export const FONT_URL: string = inter;

// Rótulos de neón: Tilt Neon (Andy Clymer, SIL Open Font License), dibujada para imitar tubos de neón.
import tiltNeon from "@fontsource/tilt-neon/files/tilt-neon-latin-400-normal.woff?url";

export const NEON_FONT_URL: string = tiltNeon;

// Carteles nítidos (estilo "sign") y nombres de distritos: Space Grotesk (SIL Open Font License).
import spaceGrotesk from "@fontsource/space-grotesk/files/space-grotesk-latin-700-normal.woff?url";

export const SIGN_FONT_URL: string = spaceGrotesk;

/* ------------------------------------------------------------------ */
/* Letras de otros alfabetos sin salir de xenxo                         */
/* ------------------------------------------------------------------ */

/*
 * troika (la librería de los textos 3D) pide a jsDelivr una fuente para cualquier carácter que no
 * tenga la nuestra, y entonces el navegador de quien mira hablaría con un tercero por culpa de lo que
 * escribe otra persona (CLAUDE.md: el navegador del visitante no habla con terceros). Así que, antes
 * de componer cada texto:
 *   - si su fuente no lo cubre, se usa la parte de Inter que más letras suyas tenga (latín ampliado,
 *     cirílico, griego, vietnamita), con Inter latín detrás para lo demás;
 *   - lo que siga sin fuente (chino, árabe, emoji…) se dibuja como «?». En el chat y el panel 2D se ve
 *     normal, con las fuentes del sistema.
 * La CSP (public/_headers) es la segunda barrera: aunque algo se escapara, el navegador no lo pediría.
 */

type Ranges = readonly number[];
const has = (r: Ranges, c: number) => {
  for (let i = 0; i < r.length; i += 2) if (c >= r[i]! && c <= r[i + 1]!) return true;
  return false;
};
const BASE: Record<string, Ranges> = {
  [inter]: COVERAGE.interLatin,
  [spaceGrotesk]: COVERAGE.spaceGrotesk,
  [tiltNeon]: COVERAGE.tiltNeon,
};
const EXTRA: [string, Ranges][] = [
  [interLatinExt, COVERAGE.interLatinExt],
  [interCyrillic, COVERAGE.interCyrillic],
  [interCyrillicExt, COVERAGE.interCyrillicExt],
  [interGreek, COVERAGE.interGreek],
  [interGreekExt, COVERAGE.interGreekExt],
  [interVietnamese, COVERAGE.interVietnamese],
];
const SPACE = /\s/;

/** La fuente con la que componer `text` (pedida: `base`) y el texto con «?» donde ninguna llega. */
export function fitText(text: string, base: string): { text: string; font: string } {
  const own = BASE[base] ?? COVERAGE.interLatin;
  const covered = (c: number, ch: string) => SPACE.test(ch) || has(own, c) || has(COVERAGE.interLatin, c);
  let missing: number[] | null = null;
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    if (!covered(c, ch)) (missing ??= []).push(c);
  }
  if (!missing) return { text, font: base };
  let best: [string, Ranges] | null = null;
  let bestN = 0;
  for (const e of EXTRA) {
    const n = missing.filter((c) => has(e[1], c)).length;
    if (n > bestN) [best, bestN] = [e, n];
  }
  let out = "";
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    out += SPACE.test(ch) || has(COVERAGE.interLatin, c) || (best && has(best[1], c)) || (!best && has(own, c)) ? ch : "?";
  }
  return { text: out, font: best ? best[0] : base };
}

// Lo que la fuente elegida no tenga lo pone Inter latín (troika la prueba después de la del texto).
configureTextBuilder({ defaultFontURL: inter });

type TroikaText = (typeof TroikaText)["prototype"] & { __xBase?: string; __xFont?: string };
const proto = TroikaText.prototype as TroikaText;
const sync = proto.sync;
proto.sync = function (this: TroikaText, cb?: () => void) {
  // La fuente que pidió la app (y no la que eligió este parche la vez anterior).
  if (typeof this.font === "string" && this.font !== this.__xFont) this.__xBase = this.font;
  const base = this.__xBase;
  if (base && BASE[base] && typeof this.text === "string") {
    const fit = fitText(this.text, base);
    if (fit.text !== this.text) this.text = fit.text;
    this.__xFont = fit.font;
    if (this.font !== fit.font) this.font = fit.font;
  }
  return sync.call(this, cb);
};
