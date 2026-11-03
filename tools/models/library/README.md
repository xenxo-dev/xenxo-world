# Modelos de bibliotecas libres

Modelos sacados de fuentes libres (las de `docs/RECURSOS.md` y repositorios abiertos con licencia
que permita el uso comercial) cuando hay que prepararlos antes de empaquetar (separar piezas, quitar
lo que sobra). Cada carpeta lleva `model.glb` y
`meta.json` con el mismo formato que `tools/models/generated/` (más `source` y `license`), y
`tools/forge/pack.mjs` los empaqueta igual: a su tamaño, de pie en Y = 0 y con dos niveles (con
`keep_origin`, tal cual: piezas que van juntas, cada una con su pivote en el origen).

| Carpeta | Origen | Cómo se hizo |
|---|---|---|
| `vehicle_car`, `vehicle_car_door_l`, `vehicle_car_door_r`, `vehicle_car_wheel_l`, `vehicle_car_wheel_r` | «Car Concept» de [glTF-Sample-Assets](https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/CarConcept) (Khronos, CC BY 4.0) | `tsx tools/models/library/concept-car.mjs <clon>/Models/CarConcept/glTF-Binary/CarConcept.glb`: sin logotipos, simplificado y en piezas; imprime los pivotes (`apps/web/src/world/vehicle/car.ts`) |

| `weapon_pipa`, `weapon_chispa`, `weapon_canon`, `weapon_rafaga`, `weapon_trueno`, `weapon_tormenta`, `weapon_halcon`, `loot_crate`, `loot_crate_lid` | [Blaster Kit](https://kenney.nl/assets/blaster-kit) de Kenney (CC0, `tools/kits/kenney/blaster-kit`) | `node tools/models/library/blasters.mjs`: el cañón hacia +Z, a su largo y con la empuñadura en el origen; el cofre, caja y tapa por separado. Imprime la boca del cañón, el guardamanos y la bisagra (`apps/web/src/world/people/arms.ts`). Las fichas del HUD (`apps/web/public/armas/`), con `python3 tools/models/library/blasters-icons.py` |

Añade cada uno a `CREDITS.md` (con su atribución si no es CC0).
