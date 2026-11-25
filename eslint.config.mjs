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
    // Copias congeladas del TS viejo para los benchmarks, y los guiones del
    // navegador de los agentes (no van al repo).
    "bench/*/ts/**",
    ".playwright-mcp/**",
    // Los paquetes de diseño que llegan de afuera.
    "docs/diseno/**",
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
     * (docs/go/progreso.md); los tipos salen del contrato (lib/api/tipos).
     * Quedan afuera solo las herramientas: las semillas de la base de
     * desarrollo (lib/db), los scripts y los golden que leen el TS viejo.
     */
    ignores: ["lib/db/**", "scripts/**", "bench/**", "tests/**", "backend/**"],
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
              message: "Next no le habla a la base: pedíselo a la API de Go (lib/api/servidor).",
            },
          ],
        },
      ],
    },
  },
]);

export default eslintConfig;
