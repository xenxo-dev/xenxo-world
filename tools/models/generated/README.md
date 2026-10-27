# Modelos 3D generados con IA

Solo cuando ninguna fuente gratuita de `docs/RECURSOS.md` (Quaternius, Kenney, KayKit, Poly
Haven…) tiene algo con la calidad que hace falta.

## Cómo añadir uno

1. **Pide permiso antes de gastar créditos** y mira el coste (`get_cost`). Tripo por Higgsfield
   cuesta ≈ 5 créditos por modelo; Meshy, entre 25 y 38.
2. Prompt sin marcas, logotipos, personajes ni personas reales, ni «al estilo de» nadie. Pide
   «clean game asset» y un tope de caras (3.000–5.000).
3. Crea `tools/models/generated/<carpeta>/` con:
   - `model.glb`: lo que da la plataforma, tal cual.
   - `meta.json`:

   ```json
   {
     "name": "life_car",
     "platform": "Higgsfield",
     "model": "tripo_3d",
     "date": "2026-10-27",
     "plan": "plus",
     "job_id": "…",
     "prompt": "…",
     "fit": { "size": 4.2, "along": "length" },
     "yaw": -90,
     "lod1_ratio": 0.45,
     "glow": true
   }
   ```

   `name` = nombre en `seed-assets` (el que usan el servidor y el cliente). `fit` = medida real
   en metros, a lo largo (`length`) o a lo alto (`height`). `yaw` = giro (grados) para que el
   frente mire a +Z. `lod1_ratio` = triángulos del nivel ligero. `glow` = las luces pintadas en
   la textura brillan (material `xenxo-glow`, más de noche).
4. `npm run forge:pack` (o `tsx tools/forge/pack.mjs --keep`): lo apoya en el suelo, lo pone a su
   tamaño, hace los dos niveles (texturas WebP a 1024 y 512 px) y comprueba el presupuesto.
5. Añádelo a `CREDITS.md` (sección «Generado con IA»).

## Reglas

- La plataforma tiene que dar la propiedad y el uso comercial (Higgsfield en planes de pago) o
  una licencia abierta que lo permita (Meshy gratis: CC BY 4.0, con atribución).
- Se guarda en el repo y se sirve desde xenxo: nunca se enlaza a la plataforma.
- No es CC0: las condiciones de Higgsfield prohíben usar lo generado para entrenar IA.
- Nunca Hunyuan3D (su licencia excluye la UE).
