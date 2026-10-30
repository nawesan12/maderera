import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Las copias del repo de los agentes (worktrees) y lo de Go.
    ".claude/**",
    "backend/**",
  ]),
  {
    rules: {
      /**
       * El guion bajo adelante quiere decir "acá va un parámetro que la firma
       * exige y este cuerpo no usa". Pasa en cada Server Action: `useActionState`
       * llama con `(estadoPrevio, formData)` y casi ninguna mira el previo.
       * Sin esta regla, la alternativa es un `eslint-disable` por archivo.
       */
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },  {
    /**
     * **Next no le habla a la base.** Todo dato pasa por la API de Go
     * (docs/go/progreso.md). Los archivos de abajo son los que todavía no se
     * mudaron: la lista solo puede achicarse, y cuando quede vacía se borran
     * lib/db y drizzle.
     */
    ignores: [
      "lib/db/**",
      "scripts/**",
      "bench/**",
      "tests/**",
      "backend/**",
      "app/(public)/carrito-actions.ts",
      "app/(public)/carrito/actions.ts",
      "app/(public)/carrito/confirmar/actions.ts",
      "app/(public)/corte/actions.ts",
      "app/(public)/pago-actions.ts",
      "app/admin/pagos/actions.ts",
      "app/admin/pagos/banco.tsx",
      "lib/cobros/recibo.ts",
      "lib/cola/index.ts",
      "lib/compras/congelar.ts",
      "lib/dal/admin/auditoria.ts",
      "lib/dal/admin/pagos.ts",
      "lib/dal/carrito.ts",
      "lib/dal/credito.ts",
      "lib/dal/numeracion-ventas.ts",
      "lib/dal/pagos.ts",
      "lib/dal/seguimiento.ts",
      "lib/inventario/locks.ts",
      "lib/inventario/reservas.ts",
      "lib/limites/index.ts",
      "lib/mostrador/offline/cola.ts",
      "lib/mostrador/offline/sincronizar.ts",
      "lib/mostrador/offline/use-caja.ts",
      "lib/mostrador/offline/use-copia-local.ts",
      "lib/notificaciones/avisos.ts",
      "lib/notificaciones/cobros.ts",
      "lib/notificaciones/presupuestos.ts",
      "lib/notificaciones/push.ts",
      "lib/pagos/acreditar.ts",
      "lib/pagos/crear.ts",
      "lib/pagos/webhook.ts",
      "lib/tareas/index.ts",
      "lib/ventas/factores.ts",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "@/lib/db", message: "Next no le habla a la base: pedíselo a la API de Go (lib/api/servidor)." },
            { name: "drizzle-orm", message: "Next no le habla a la base: pedíselo a la API de Go (lib/api/servidor)." },
          ],
          patterns: [
            {
              group: ["@/lib/db/*", "drizzle-orm/*"],
              allowTypeImports: true,
              message: "Next no le habla a la base: pedíselo a la API de Go (lib/api/servidor).",
            },
          ],
        },
      ],
    },
  },
]);

export default eslintConfig;
