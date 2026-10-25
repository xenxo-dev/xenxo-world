# Crear tu personaje y el modelo de tu proyecto

Todo lo que subes a xenxo.io es un archivo **glTF binario** (`.glb`) o un **VRM** (`.vrm`, el estándar abierto de avatares). Se valida y se optimiza en tu propio navegador antes de subirlo: nada sale de tu equipo hasta que pulsas el botón.

## Presupuestos

| | Personaje | Modelo de proyecto |
|---|---|---|
| Triángulos | 30.000 | 50.000 |
| Tamaño del archivo | 4 MB | 6 MB |
| Texturas | 1024 px | 2048 px |
| Formatos | `.glb` o `.vrm` | `.glb` |

Si te pasas en triángulos, el navegador intenta simplificar la malla para que quepa. Las texturas grandes se reducen solas. Estos límites existen para que la plaza vaya fluida en unas gafas Meta Quest 3, donde se dibuja un personaje por cada persona cercana.

## Con Blender (gratis)

1. Modela tu personaje **de pie sobre el suelo** (los pies en Z = 0 en Blender) y **mirando hacia ti en la vista frontal** (tecla `1` del teclado numérico).
2. Altura: si es creíble (1,30–2,20 m) se respeta tal cual en los VRM; si no, la plaza lo escala a 1,75 m.
3. Aplica las transformaciones (`Ctrl + A` → *All Transforms*) para evitar escalas raras.
4. Materiales: usa *Principled BSDF*. Para que no parezca negro, deja **Metallic a 0** salvo en lo que de verdad sea metal.
5. `Archivo → Exportar → glTF 2.0`:
   - **Formato: glTF Binary (.glb)**.
   - Incluir: solo lo seleccionado (si tienes más cosas en la escena).
   - Transformar: *+Y Up* (viene marcado por defecto).
   - Malla: aplica modificadores.
   - **No actives la compresión Draco**: la plaza usa meshopt y la aplica sola.
   - Sin luces ni cámaras.
6. Animaciones (opcional): si incluyes una acción llamada `idle` (en reposo) y otra llamada `walk` (andar), la plaza las mezcla según la velocidad. Sin ellas, tu personaje se mueve con un pequeño rebote. En Blender, crea las acciones en el *Action Editor* y expórtalas con *Animation → Actions*. Si quieres todas las animaciones de la plaza sin hacerlas, exporta tu personaje como **VRM** con la extensión gratuita *VRM Add-on for Blender* (asigna los huesos humanoides con un clic).
7. Materiales de la plaza (opcional): si llamas a un material `xenxo:teja.b5583a`, `xenxo:piedra.d9c7a6`, `xenxo:neon.4fa3ff`… la plaza lo viste con sus texturas reales y lo enciende de noche si es neón, farol o ventana. La lista completa está en `docs/PROTOCOL.md` (§12 bis).

## Personajes de serie (sin hacer nada)

En *Personalizar → Tu personaje* puedes elegir una de las 8 personas de serie: son realistas (generadas con MakeHuman, CC0), van vestidas y tienen todas las animaciones. Sin cuenta, la elección se guarda en tu navegador; con cuenta, en tu perfil.

## Con VRoid Studio u otras apps de avatares

Exporta en **VRM** (0.x o 1.0). Es el formato recomendado: la plaza le pone **las mismas animaciones que a los personajes de serie** (reposo, andar, trotar, correr, saltar, sentarse, bailar, saludar…), porque las animaciones están en VRMA, el estándar de animación de VRM, y valen para cualquier humanoide. Se respetan huesos, expresiones y física de pelo y ropa (los muelles), y parpadea si el VRM trae la expresión `blink`. Si VRoid te da un archivo de más de 30.000 triángulos o 4 MB, en la exportación baja el número de polígonos y el tamaño de las texturas.

## Otras opciones

- **Modelos CC0** (por ejemplo, Kenney o Quaternius): ya vienen ligeros y en `.glb`.
- **IA de texto o imagen a 3D**: suelen salir pesados; pásalos por Blender con *Decimate* antes.
- **Escaneos con el móvil** (Polycam, Scaniverse, Luma): exporta en `.glb` con la textura a 1024–2048 px.

Solo puedes subir modelos tuyos, con licencia que lo permita (como CC0) o con permiso de su autor.

## Qué se rechaza y por qué

| Mensaje | Qué hacer |
|---|---|
| «no es un GLB» | Exporta como *glTF Binary (.glb)*, no como `.gltf` + carpeta |
| «referencia texturas o buffers externos» | Todo tiene que ir embebido en el `.glb` |
| «extensiones no admitidas: KHR_draco_mesh_compression» | Desactiva Draco al exportar |
| «extensiones no admitidas: KHR_lights_punctual» | Quita las luces de la escena |
| «supera el presupuesto» | Reduce triángulos (*Decimate*) o el tamaño de las texturas |
