import { defineConfig } from "vite";

// three.js y three-vrm pesan unos 700 KB: es normal en un juego 3D, no hace falta el aviso.
export default defineConfig({
  build: { chunkSizeWarningLimit: 1500 },
});
