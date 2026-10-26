# Texturas generadas con IA

Además de los escaneos CC0 de Poly Haven, xenxo admite texturas **generadas con IA**
(Higgsfield u otras plataformas parecidas) para sus materiales `xenxo:<biblioteca>`.

## Cómo añadir una

1. Genérala **sin coste sorpresa**: las plataformas gastan créditos de la cuenta de xenxo; pide
   permiso antes de generar.
2. Pídela **repetible sin costuras** (*seamless, tileable*), vista de frente, sin sombras ni luz
   direccional, cuadrada (1024 px o más).
3. Crea `tools/materials/generated/<biblioteca>/` con:
   - `albedo.png` — la textura (obligatoria).
   - `normal.png` y `rough.png` — opcionales; si faltan, se calculan (relieve a partir de la
     luminancia y rugosidad constante).
   - `meta.json`:

   ```json
   {
     "platform": "Higgsfield",
     "model": "gpt_image_2_5",
     "date": "2026-10-26",
     "plan": "plus",
     "prompt": "seamless tileable dark tech floor panels, top-down, flat even lighting",
     "tile": 2.0,
     "mode": "tint",
     "keep": 0.2,
     "roughness": 0.7,
     "metalness": 0.0
   }
   ```

   `tile` = metros que cubre una repetición. `mode`: `tint` (el color lo pone el tinte del
   modelo) o `color` (se respeta el de la imagen). `keep` = saturación conservada en `tint`.
4. `python3 tools/materials/fetch.py <biblioteca>` → la prepara a 512 y 1024 px en WebP en
   `apps/web/public/materials/` y la apunta en `material-library.json`.
5. Añádela a `CREDITS.md` (sección «Generado con IA») y a la tabla de `docs/PROTOCOL.md` §12 bis.
   Si la usará la forja, añade su rugosidad y metal a `LIBRARY` en `tools/forge/kit.py`.

## Reglas

- La plataforma tiene que dar **la propiedad y el uso comercial** de lo generado (Higgsfield lo
  hace en sus condiciones de uso) y la imagen tiene que salir **sin marca de agua** (plan de pago).
- Se guarda en el repo y se sirve desde xenxo: nunca se enlaza a la plataforma.
- El prompt no pide marcas, logotipos, obras, personajes ni personas reales, ni «al estilo de» nadie.
- **No es CC0.** Las condiciones de Higgsfield prohíben usar lo generado para entrenar modelos de
  IA; esa condición viaja con estas imágenes (ver `CREDITS.md`).
