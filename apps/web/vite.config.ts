import { copyFileSync, createReadStream, existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/**
 * El motor de MediaPipe (WebAssembly, Apache-2.0) para la funda desde una foto: se copia del paquete
 * de npm a public/mediapipe/ al arrancar o compilar, para servirlo desde xenxo (nunca de un CDN).
 */
function mediapipeWasm(): Plugin {
  const pkg = dirname(createRequire(import.meta.url).resolve("@mediapipe/tasks-vision"));
  const copy = () => {
    const out = join(__dirname, "public", "mediapipe");
    mkdirSync(out, { recursive: true });
    for (const f of ["vision_wasm_internal.js", "vision_wasm_internal.wasm", "vision_wasm_nosimd_internal.js", "vision_wasm_nosimd_internal.wasm"]) {
      const dst = join(out, f);
      if (!existsSync(dst)) copyFileSync(join(pkg, "wasm", f), dst);
    }
  };
  return {
    name: "xenxo-mediapipe-wasm",
    buildStart: copy,
    // En desarrollo, Vite no deja cargar como script lo de public/: se sirve directamente.
    configureServer(server) {
      copy();
      server.middlewares.use((req, res, next) => {
        const m = /^\/mediapipe\/(vision_wasm_(?:nosimd_)?internal\.(js|wasm))(\?.*)?$/.exec(req.url ?? "");
        if (!m) return next();
        res.setHeader("Content-Type", m[2] === "js" ? "text/javascript" : "application/wasm");
        createReadStream(join(pkg, "wasm", m[1]!)).pipe(res);
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), mediapipeWasm()],
  server: { host: true, port: 5173 },
  build: { target: "es2022", chunkSizeWarningLimit: 1500 },
});
