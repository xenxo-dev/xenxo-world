# Seguridad · Security

## Cómo avisar de un fallo

Si encuentras un fallo de seguridad en xenxo (la web, el servidor, el SDK, el MCP, el kit de
distritos o la plantilla), escríbenos a **contact@xenxo.io** con «Seguridad» en el asunto. No abras
una issue pública ni lo pruebes contra datos de otras personas: con una cuenta tuya y tu propio
contenido basta.

Cuéntanos qué has visto, cómo reproducirlo y qué crees que permite. Te contestamos en cuanto
podamos, te decimos qué vamos a hacer y, si quieres, te nombramos en el arreglo.

## Reporting a vulnerability

If you find a security issue in xenxo (web, server, SDK, MCP server, district kit or template),
email **contact@xenxo.io** with "Security" in the subject. Please don't open a public issue and
don't test against other people's data: your own account and content are enough.

Tell us what you saw, how to reproduce it and what you think it allows. We'll answer as soon as we
can, tell you what we'll do and, if you like, credit you in the fix.

## Lo que ya hace xenxo · What xenxo already does

- Una sola puerta de escritura del mundo (`MUTATE_WORLD` en `chunk-room.ts`) con esquema,
  presupuestos, propiedad, versión e idempotencia; topes por conexión y por cuenta.
- Los modelos se vuelven a inspeccionar en el servidor (`packages/assets`): extensiones permitidas,
  límites de estructura, texturas embebidas y presupuestos.
- Sesiones con versión (cerrar sesión en todos los dispositivos), vida máxima de 30 días, passkeys,
  Google atado al navegador que empezó y «Entrar con xenxo» solo con PKCE S256.
- Límites por dirección de red sin guardar la IP, cuerpos con tope y chunks inventados que dan 404.
- CSP estricta en la web: el navegador solo habla con xenxo (también las fuentes de los textos 3D).
- Los despliegues solo salen de `main` del propio repositorio, con los secretos en los pasos que
  los usan.
