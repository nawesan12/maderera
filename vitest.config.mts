import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * Tests de la lógica que mueve plata.
 *
 * Deliberadamente acotado: nada de componentes ni de base de datos. Lo que se
 * prueba acá es lo que, si se rompe, se descubre por una diferencia en un
 * papel o en una cuenta corriente —y para entonces ya se le facturó mal a
 * alguien—.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
});
