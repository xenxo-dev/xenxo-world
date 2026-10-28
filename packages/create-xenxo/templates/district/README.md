# {{title}} — distrito de xenxo

Un distrito de la comunidad de [xenxo.io](https://xenxo.io): 256 × 256 m del mundo, descritos en
`xenxo-district.json` y con los modelos de esta carpeta. *(In English: create it with `--lang en`.)*

```bash
npm install
npm run validate        # comprueba el distrito como lo hará xenxo
```

Después, súbelo desde **xenxo.io → Cuenta → Tu distrito → Subir carpeta**: queda en borrador (solo
lo ves tú), lo pruebas y lo envías a revisión. Todas las reglas y medidas: **AGENTS.md** (también
para tu IA). Pon tu nombre y tu contacto en `author` y `contact`.

## Si `npm install` falla con un 404 en `@xenxo/district-kit`

Aún no está publicado en npm. Mientras tanto, sácalo del repositorio
([xenxo-dev/xenxo-world](https://github.com/xenxo-dev/xenxo-world)):

```bash
# una vez, en otra carpeta:
git clone https://github.com/xenxo-dev/xenxo-world && cd xenxo-world && npm install
mkdir -p ~/xenxo-paquetes && npm pack -w @xenxo/district-kit --pack-destination ~/xenxo-paquetes
# en la carpeta del distrito:
npm install -D ~/xenxo-paquetes/xenxo-district-kit-*.tgz
```

MIT.
