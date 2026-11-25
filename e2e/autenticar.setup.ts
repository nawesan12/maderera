import { expect, test as setup } from "@playwright/test";
import { SESION_ADMIN } from "./sesion-guardada";

/*
 * Entra una sola vez con el admin y guarda la sesión: las pruebas del panel
 * la reusan (storageState) en vez de entrar cada una. Si cada una entrara, la
 * suite pasaría el freno de intentos de entrada (10 cada 5 minutos por IP) y
 * fallaría por eso y no por un error de verdad. Las pruebas de sesión
 * (sesion.spec.ts) siguen entrando de verdad: es lo que prueban.
 */

setup("entrar como admin", async ({ page }) => {
  await page.goto("/ingresar");
  await page.getByLabel("Correo electrónico").fill(process.env.E2E_CORREO ?? "admin@mjbj.com.ar");
  await page.getByLabel("Contraseña").fill(process.env.E2E_CLAVE ?? "Admin1234");
  await page.getByRole("button", { name: "Ingresar" }).click();
  await expect(page).toHaveURL(/\/admin/);
  await page.context().storageState({ path: SESION_ADMIN });
});
