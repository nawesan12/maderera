import { defineConfig, devices } from "@playwright/test";

/**
 * Las pruebas de punta a punta (e2e/): el navegador contra Next y la API de
 * Go juntos, como los usa la gente. Son el requisito para mergear cada tanda
 * de la mudanza (docs/go/progreso.md): cada una suma su flujo.
 *
 *   npm run e2e          # levanta la API y Next si no están corriendo
 *
 * Corren contra la base de desarrollo con sus usuarios de prueba;
 * E2E_CORREO / E2E_CLAVE cambian el admin que usan.
 */
export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_URL ?? "http://localhost:3100",
    trace: "retain-on-failure",
    locale: "es-AR",
  },
  projects: [
    // Entra una vez y guarda la sesión del admin (ver e2e/autenticar.setup.ts).
    { name: "sesion", testMatch: /autenticar\.setup\.ts/ },
    { name: "escritorio", use: { ...devices["Desktop Chrome"] }, dependencies: ["sesion"] },
    { name: "telefono", use: { ...devices["Pixel 7"] }, dependencies: ["sesion"] },
  ],
  webServer: [
    {
      command: "npm run api:dev",
      url: "http://127.0.0.1:8080/salud",
      reuseExistingServer: true,
      timeout: 120_000,
    },
    {
      command: "npm run dev -- -p 3100",
      url: "http://localhost:3100/ingresar",
      reuseExistingServer: true,
      timeout: 180_000,
    },
  ],
});
