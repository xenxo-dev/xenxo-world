/**
 * Sustituto de `sharp` en el archivo único del servidor MCP. Una dependencia de gltf-transform lo
 * importa para tratar imágenes en Node, pero el MCP no lo usa (las texturas grandes las rechaza el
 * servidor con su explicación) y es un módulo nativo que no cabe en un solo archivo.
 */
export default function sharp(): never {
  throw new Error("sharp no está disponible en el servidor MCP de xenxo");
}
