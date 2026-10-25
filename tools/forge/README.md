# La forja

Genera la arquitectura de la plaza con código (Blender 5 como módulo de Python, sin pantalla):
soportales, balcones de forja, campanario, fuente, puerta, farolas, bancos, naranjos, terraza
y suelo. Hornea la oclusión ambiental de cada pieza **en su sitio** (con sus vecinas haciendo
sombra) y exporta dos niveles de detalle: el detallado para escritorio y el ligero para Quest y móvil.

```bash
pip install --break-system-packages bpy==5.2.3   # Blender 5.2 como módulo
npm run forge                                    # forja + empaquetado
```

- `plaza-layout.json` (en `apps/realtime/src/`) es la única fuente de la disposición: la usan la forja y `seed.ts`.
- `pack.mjs` añade la oclusión, cuantiza, comprime con meshopt, comprueba el presupuesto con el
  mismo inspector que el servidor y deja los GLB **por hash** en `apps/realtime/seed-assets/`
  (recursos estáticos del Worker) y el índice en `apps/realtime/src/seed-assets.ts`.
- Al cambiar los modelos cambian sus hashes y, con ellos, la huella de la semilla: el servidor
  vuelve a sembrar la plaza solo.

Los materiales se llaman `xenxo:<biblioteca>.<tinte>`: el cliente los viste con las texturas de
`tools/materials/fetch.py` (Poly Haven, CC0). Ver `docs/PROTOCOL.md` §12 bis.
