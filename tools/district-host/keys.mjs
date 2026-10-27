// Genera el par de claves Ed25519 de los distritos en otro servidor (docs/ALOJAMIENTO-DISTRITOS.md).
//
//   node tools/district-host/keys.mjs
//
// Escribe la PRIVADA en distrito-privada.jwk (para `wrangler secret put DISTRICT_SIGNING_KEY`, y
// después se borra) y enseña la PÚBLICA, que va en la configuración del servidor de distritos.
// La privada no se pega en ningún chat ni se sube al repo.
import { writeFileSync } from "node:fs";
import { webcrypto } from "node:crypto";

const { privateKey, publicKey } = await webcrypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
const priv = await webcrypto.subtle.exportKey("jwk", privateKey);
const pub = await webcrypto.subtle.exportKey("jwk", publicKey);
const out = process.argv[2] ?? "distrito-privada.jwk";
writeFileSync(out, JSON.stringify(priv), { mode: 0o600 });
console.log(`Clave privada en ${out} (solo para: npx wrangler secret put DISTRICT_SIGNING_KEY < ${out}; luego bórrala).`);
console.log("Clave pública (va en DISTRICT_PUBLIC_KEY del servidor de distritos):");
console.log(JSON.stringify(pub));
