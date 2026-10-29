import { expect, test, type Page } from "@playwright/test";

/*
 * «Mi cuenta», de punta a punta, con una cuenta de cliente propia de esta
 * prueba: se registra la primera vez y después solo entra, así cada corrida
 * no deja una cuenta nueva. Las lecturas y las acciones las hace Go
 * (backend/internal/portal). La dirección que agrega, la borra.
 */

const CORREO = "e2e-portal@prueba.test";
const CLAVE = "Portal-e2e-1234";

async function entrar(page: Page) {
  await page.goto("/ingresar?volver=/mi-cuenta");
  await page.getByLabel("Correo electrónico").fill(CORREO);
  await page.getByLabel("Contraseña").fill(CLAVE);
  await page.getByRole("button", { name: "Ingresar" }).click();
  try {
    await page.waitForURL((u) => u.pathname.startsWith("/mi-cuenta"), { timeout: 8000 });
    return;
  } catch {
    // Todavía no existe: se registra.
  }
  await page.goto("/registro?volver=/mi-cuenta");
  await page.getByLabel("Nombre y apellido").fill("Prueba de punta a punta");
  await page.getByLabel("Correo electrónico").fill(CORREO);
  await page.getByLabel("Teléfono").fill("223 555-0000");
  await page.getByLabel("Contraseña", { exact: true }).fill(CLAVE);
  await page.getByLabel("Repetir contraseña").fill(CLAVE);
  await page.getByRole("button", { name: "Crear mi cuenta" }).click();
  await page.waitForURL((u) => u.pathname.startsWith("/mi-cuenta"));
}

test("el cliente entra a su cuenta y agrega y borra una dirección", async ({ page }) => {
  test.skip(test.info().project.name === "telefono", "con una pasada alcanza");
  await entrar(page);
  await expect(page.getByRole("heading", { name: "Bienvenido, Prueba" })).toBeVisible();

  await page.goto("/mi-cuenta/direcciones");
  await page.getByRole("button", { name: "Agregar una dirección" }).click();
  await page.getByLabel("Nombre").fill("Obra E2E");
  await page.getByLabel("Localidad").fill("Mar del Plata");
  await page.getByLabel("Calle y altura").fill("Juan B. Justo 1234");
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByText("Obra E2E")).toBeVisible();

  const tarjeta = page.locator("li, article, div").filter({ hasText: "Obra E2E" }).filter({ has: page.getByRole("button", { name: /Borrar/ }) }).last();
  await tarjeta.getByRole("button", { name: /Borrar/ }).click();
  await expect(page.getByText("Obra E2E")).toHaveCount(0);
});
