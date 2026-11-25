import { expect, test, type Page } from "@playwright/test";

/*
 * El rebote de permisos dice por qué (comité final, «Permisos»): quien
 * teclea una pantalla que no es suya cae en el inicio de su rol con un aviso
 * breve que se va solo, una vez. Entra con cada rol (no hay sesión guardada
 * para ellos): E2E_CLAVE_ROLES cambia la clave de los usuarios de prueba.
 */

const CLAVE = process.env.E2E_CLAVE_ROLES ?? "Prueba1234";

async function entrar(page: Page, correo: string) {
  await page.goto("/ingresar");
  await page.getByLabel("Correo electrónico").fill(correo);
  await page.getByLabel("Contraseña").fill(CLAVE);
  await page.getByRole("button", { name: "Ingresar" }).click();
  await page.waitForURL(/\/(admin|taller)/);
}

test("un vendedor que teclea /admin/precios cae en el resumen con el aviso, una vez", async ({ page }) => {
  test.skip(test.info().project.name === "telefono", "el panel se prueba en escritorio");
  await entrar(page, "vendedor@mjbj.com.ar");
  await page.goto("/admin/precios");
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByText("No tenés acceso a Precios")).toBeVisible();
  // El parámetro se va de la dirección: recargar no lo repite.
  await expect(page.getByText("No tenés acceso a Precios")).toHaveCount(0, { timeout: 10_000 });
  await page.reload();
  await expect(page.getByRole("main")).toBeVisible();
  await expect(page.getByText("No tenés acceso a Precios")).toHaveCount(0);
});

test("el aserradero en /admin/clientes cae en el taller con el aviso", async ({ page }) => {
  test.skip(test.info().project.name === "telefono", "el panel se prueba en escritorio");
  await entrar(page, "aserradero@mjbj.com.ar");
  await page.goto("/admin/clientes");
  await expect(page).toHaveURL(/\/taller$/);
  await expect(page.getByText("No tenés acceso a Clientes")).toBeVisible();
});
