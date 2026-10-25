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

test("una planilla importada muestra qué cambia y aplica lo confirmado", async ({ page }) => {
  test.skip(test.info().project.name === "telefono", "el panel se prueba en escritorio");
  // El SKU y su precio de lista, de la base de desarrollo; se deja como estaba.
  const sku = process.env.E2E_SKU ?? "CSE-LAN-050";
  const subir = async (precio: string) => {
    await page.goto("/admin/precios");
    await page.getByRole("button", { name: "Importar planilla" }).click();
    const csv = `SKU;Producto;Medida;Categoria;Precio lista;Precio profesional\r\n${sku};x;x;x;${precio};\r\nNO-EXISTE-E2E;x;x;x;1;\r\n`;
    await page.locator('input[type="file"]').setInputFiles({ name: "precios.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  };

  await subir("123.456,00");
  // Uno cambia y el código inexistente es un problema.
  await expect(page.getByRole("button", { name: "Aplicar 1 cambio" })).toBeVisible();
  await expect(page.getByText("No hay ningún producto con ese código.")).toBeVisible();
  await page.getByRole("button", { name: "Aplicar 1 cambio" }).click();
  await expect(page.getByText("Se aplicaron 1 cambio de precio.").first()).toBeVisible();

  // Volver al precio de antes con otra planilla.
  await subir("92.700,00");
  await page.getByRole("button", { name: "Aplicar 1 cambio" }).click();
  await expect(page.getByText("Se aplicaron 1 cambio de precio.").first()).toBeVisible();
});
