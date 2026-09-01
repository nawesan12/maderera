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
      /**
       * `server-only` lanza una excepción apenas se lo importa fuera de un
       * Server Component, y varios módulos que sí queremos probar —las
       * plantillas de correo, por ejemplo— arrastran esa marca por sus
       * dependencias. Acá se resuelve a un módulo vacío: la marca existe para
       * que el código no llegue al navegador, y un test no es el navegador.
       */
      "server-only": fileURLToPath(
        new URL("./tests/vacio.ts", import.meta.url),
      ),
    },
  },
});
