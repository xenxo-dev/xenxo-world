# @xenxo/district-kit

Kit de distritos de [xenxo.io](https://xenxo.io) (MIT). Comprueba en tu equipo que tu distrito
cumple los requisitos de xenxo antes de subirlo: tamaño (256 × 256 m), triángulos y niveles de
detalle (pensando en la Quest 3), texturas, colisiones, textos en español e inglés, nada externo en
los modelos y la zona de la puerta libre.

```bash
npm create xenxo@latest mi-distrito -- --district   # un distrito de ejemplo
cd mi-distrito && npm install
npx xenxo-district validate                         # o: npm run validate
```

`--lang es|en` para el idioma, `--json` para usarlo en CI (sale con código 1 si hay problemas).

La ficha (`xenxo-district.json`, esquema `xenxo.district/0`), las coordenadas y los presupuestos
están en el `AGENTS.md` de la plantilla y en `docs/PROTOCOL.md` del repositorio. El servidor vuelve
a comprobarlo todo con sus propias medidas.

---

District kit for [xenxo.io](https://xenxo.io) (MIT). Checks on your machine that your district
meets xenxo's requirements before uploading it. `npx xenxo-district validate [folder] --lang en`.
