# Kits de modelos (CC0)

Material de partida para las ciudades de los distritos. **No se sirve tal cual**: la forja o un
script de `tools/` lo importa, lo recolorea con la paleta del distrito y lo empaqueta en un GLB
autocontenido (sin texturas externas, sin Draco) antes de que llegue al mundo.

Cada carpeta guarda solo los GLB (con su atlas `Textures/`) y el `License.txt` que venía en el zip.

## Kenney (`kenney/`)

Descargados de kenney.nl el 27-10-2026. Licencia: Creative Commons Zero (CC0), comprobada en el
`License.txt` de cada pack. Atribución no obligatoria («Support by crediting… this is not a requirement»).

| Carpeta | Pack | Para |
|---|---|---|
| `city-kit-commercial` | City Kit (Commercial) 2.1 | Arcade (horizonte), relleno |
| `city-kit-industrial` | City Kit (Industrial) 2.0 | Taller |
| `city-kit-roads` | City Kit (Roads) | Calles de todos |
| `city-kit-suburban` | City Kit (Suburban) 2.0 | Periferia |
| `modular-buildings` | Modular Buildings | Detalle de fachadas |
| `building-kit` | Building Kit | Taller |
| `factory-kit` | Factory Kit 3.0 | Taller |
| `mini-arcade` | Mini Arcade | Arcade (atrezo) |
| `coaster-kit` | Coaster Kit | Arcade (monumento) |
| `racing-kit` | Racing Kit | Arcade |
| `retro-urban-kit` | Retro Urban Kit | Píxel |
| `retro-fantasy-kit` | Retro Fantasy Kit | Píxel |
| `fantasy-town-kit` | Fantasy Town Kit 2.0 | Ágora |
| `space-kit` | Space Kit | Frontera |
| `car-kit` | Car Kit | Calles |
| `mini-market` | Mini Market | Ágora, tiendas |

Reglas:
- Se ha quitado `mini-arcade/gambling-machine.glb`: en xenxo no hay juego con dinero, ni de adorno.
- Los atlas son externos (`Textures/colormap.png`): al importar se meten dentro del GLB.
- Escala: 1 unidad de Kenney = una casilla; se normaliza a metros al importar.
- Nada de Quaternius sin su `License.txt` CC0 dentro del zip (su web publica una licencia propia
  desde agosto de 2026 que no permite redistribuir).
