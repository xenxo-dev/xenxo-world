# @xenxo/district-kit

Kit de distritos de [xenxo.io](https://xenxo.io) (MIT) *(English below)*. Comprueba en tu equipo que
tu distrito cumple los requisitos de xenxo antes de subirlo: tamaño (256 × 256 m), triángulos y
niveles de detalle (pensando en la Quest 3), texturas, colisiones, textos en español e inglés, nada
externo en los modelos, la zona de la puerta libre y los portales a tus juegos.

```bash
npm create xenxo@latest mi-distrito -- --district   # un distrito de ejemplo
cd mi-distrito && npm install
npx xenxo-district validate                         # o: npm run validate
```

- `--lang es|en` para el idioma (por defecto, el de tu sistema) y `--json` para usarlo en CI: sale con
  código 1 si hay problemas.
- **Problemas** (✗): xenxo rechazaría el distrito. **Avisos** (!): vale, pero revísalo (una portada
  que no es 16:9, o `author` y `contact` que siguen siendo los de la plantilla).
- Si el JSON está mal escrito, te dice la línea y la columna.
- En los portales, `game` admite el enlace del juego entero (`https://xenxo.io/j/mi-juego`) o solo su
  nombre (`mi-juego`).

La ficha (`xenxo-district.json`, esquema `xenxo.district/0`), las coordenadas y los presupuestos
están en el `AGENTS.md` de la plantilla y en `docs/PROTOCOL.md` del repositorio. El servidor vuelve
a comprobarlo todo con sus propias medidas. Necesitas Node.js 22 o más nuevo (vale desde el 20).

**¿`npm install` da 404?** Aún no está publicado en npm. Empaquétalo del repositorio
([xenxo-dev/xenxo-world](https://github.com/xenxo-dev/xenxo-world)): `npm install` y
`npm pack -w @xenxo/district-kit` en el repositorio, y en tu distrito
`npm install -D ruta/xenxo-district-kit-*.tgz`.

---

## English

District kit for [xenxo.io](https://xenxo.io) (MIT). It checks on your machine that your district
meets xenxo's requirements before you upload it: size (256 × 256 m), triangles and levels of detail
(with the Quest 3 in mind), textures, colliders, texts in Spanish and English, nothing external in
the models, a clear gate zone and the portals to your games.

```bash
npm create xenxo@latest my-district -- --district --lang en
cd my-district && npm install
npx xenxo-district validate --lang en     # or: npm run validate
```

`--json` for CI (exit code 1 on problems). **Problems** (✗) mean xenxo would reject it;
**warnings** (!) mean it's valid but worth a look (a cover that isn't 16:9, or the template's
`author` and `contact`). Broken JSON is reported with its line and column. Portal `game` accepts the
full game link (`https://xenxo.io/j/my-game`) or just its name (`my-game`). The manifest, coordinates
and budgets are in the template's `AGENTS.md` and in the repository's `docs/PROTOCOL.md`. Node.js 22
or newer (20 works).

**`npm install` returns 404?** It isn't on npm yet: in a clone of
[xenxo-dev/xenxo-world](https://github.com/xenxo-dev/xenxo-world), run `npm install` and
`npm pack -w @xenxo/district-kit`, then in your district `npm install -D path/xenxo-district-kit-*.tgz`.
