/** Imprime el sha256 de una clave de agente, para la variable AGENT_KEYS del servidor. */
import { createHash, randomBytes } from "node:crypto";

const key = process.argv[2] ?? randomBytes(24).toString("base64url");
if (!process.argv[2]) console.log(`Clave nueva (guárdala como secreto XENXO_AGENT_KEY): ${key}`);
console.log(`sha256: ${createHash("sha256").update(key).digest("hex")}`);
