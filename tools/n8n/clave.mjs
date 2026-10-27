// Crea la clave de solo lectura para el resumen de moderación (n8n) y la línea de AGENT_KEYS.
//   node tools/n8n/clave.mjs
// La clave va SOLO en las credenciales de n8n; la línea (con su hash, no la clave), en el secreto
// AGENT_KEYS de GitHub (el despliegue lo pasa al Worker).
import { createHash, randomBytes } from "node:crypto";

const key = `n8n_${randomBytes(24).toString("base64url")}`;
const hash = createHash("sha256").update(key).digest("hex");
console.log("Clave para n8n (guárdala en sus credenciales, no la pegues en ningún sitio más):\n");
console.log(`  ${key}\n`);
console.log("Añade esto al secreto AGENT_KEYS de GitHub (Settings → Secrets → Actions), tras una coma si ya tiene algo:\n");
console.log(`  n8n:${hash}:mod_summary\n`);
console.log("Y el de la firma de los avisos (otro, distinto): secreto N8N_WEBHOOK_SECRET de GitHub y el mismo en n8n:\n");
console.log(`  ${randomBytes(32).toString("base64url")}\n`);
