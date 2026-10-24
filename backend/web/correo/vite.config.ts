import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";

// En desarrollo, `npm run dev` sirve la SPA y le pasa /api al binario de Go
// (`mjbj correo` en el 8090). El build queda en dist/, que el binario
// embebe con go:embed.
export default defineConfig({
  plugins: [svelte()],
  build: { outDir: "dist", emptyOutDir: true, assetsDir: "assets" },
  server: { proxy: { "/api": "http://127.0.0.1:8090" } },
});
