import { expect, test } from "@playwright/test";
import { SESION_ADMIN } from "./sesion-guardada";

/*
 * Los precios, de punta a punta: se edita un precio en la grilla del panel,
 * la API de Go lo guarda con su línea en el historial
 * (backend/internal/precios), y se vuelve al precio de antes.
 */

// El panel, con la sesión del admin que guardó autenticar.setup.ts.
test.use({ storageState: SESION_ADMIN });

test("un precio editado en la grilla queda guardado y en el historial", async ({ page }) => {
  test.skip(test.info().project.name === "telefono", "el panel se prueba en escritorio");
  await page.goto("/admin/precios");

  // Uno que ya tenga precio, para volver a dejarlo como estaba.
  const editar = page.getByRole("button", { name: /^Editar precio, actualmente \$\s?[1-9]/ }).first();
  const antes = (await editar.getAttribute("aria-label"))!.replace("Editar precio, actualmente ", "");
  const numeroAntes = antes.replace(/[^\d]/g, "");
  const nuevo = page.getByRole("button", { name: /^Editar precio, actualmente \$\s12\.345$/ });
  await expect(nuevo).toHaveCount(0);

  await editar.click();
  await page.getByLabel("Nuevo precio").fill("12345");
  await page.getByLabel("Nuevo precio").press("Enter");
  await expect(page.getByText("Precio actualizado.").first()).toBeVisible();

  await page.reload();
  await expect(nuevo).toHaveCount(1);

  // Volver al precio de antes.
  await nuevo.click();
  await page.getByLabel("Nuevo precio").fill(numeroAntes);
  await page.getByLabel("Nuevo precio").press("Enter");
  await expect(page.getByText("Precio actualizado.").first()).toBeVisible();
  await page.reload();
  await expect(nuevo).toHaveCount(0);
});
