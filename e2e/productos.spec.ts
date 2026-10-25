import { expect, test } from "@playwright/test";
import { SESION_ADMIN } from "./sesion-guardada";

/*
 * La ficha de producto, de punta a punta: se carga desde el panel con una
 * medida, precio y stock, la API de Go la valida y la guarda
 * (backend/internal/productos), sale en el listado del panel y en el
 * catálogo, y al editarla el stock cambia. Al final se da de baja.
 */


// El panel, con la sesión del admin que guardó autenticar.setup.ts.
test.use({ storageState: SESION_ADMIN });

test("un producto cargado en el panel sale en el catálogo, y su stock se edita", async ({ page }) => {
  test.skip(test.info().project.name === "telefono", "el panel se prueba en escritorio");
  const nombre = `Prueba de producto ${Date.now()}`;
  await page.goto("/admin/productos/nuevo");

  await page.locator("#name").fill(nombre);
  await page.locator("#categoria").click();
  await page.getByRole("listbox").getByRole("option").filter({ visible: true }).first().click();
  await page.locator("#sku-0").fill(`E2E-${Date.now()}`);
  await page.locator("#label-0").fill("18 mm");

  // Un código de una letra: el error es el de la validación de Go, en su campo.
  await page.locator("#sku-0").fill("X");
  await page.getByRole("button", { name: "Guardar producto" }).click();
  await expect(page.getByText("El código tiene que tener al menos 2 letras o números.")).toBeVisible();

  await page.locator("#sku-0").fill(`E2E-${Date.now()}`);
  await page.locator("#precio-lista-0").fill("12345");
  await page.locator("#stockCentral-0").fill("7");
  await page.getByRole("button", { name: "Guardar producto" }).click();
  await expect(page).toHaveURL(/\/admin\/productos\?guardado=1/);

  await page.goto(`/admin/productos?buscar=${encodeURIComponent(nombre)}`);
  const fila = page.getByRole("link", { name: nombre }).first();
  await expect(fila).toBeVisible();
  await fila.click();
  await expect(page.locator("#name")).toHaveValue(nombre);
  const id = page.url().split("/admin/productos/")[1]?.split(/[?#]/)[0] ?? "";
  await expect(page.locator("#stockCentral-0")).toHaveValue("7");

  // Editar el stock.
  await page.locator("#stockCentral-0").fill("4");
  await page.getByRole("button", { name: "Guardar producto" }).click();
  await expect(page).toHaveURL(/\/admin\/productos\?guardado=1/);
  await page.goBack();
  await page.reload();
  await expect(page.locator("#stockCentral-0")).toHaveValue("4");

  // En el catálogo, con su precio.
  await page.goto(`/catalogo?q=${encodeURIComponent(nombre)}`);
  await expect(page.getByText(nombre).first()).toBeVisible();
  await expect(page.getByText(/12\.345/).first()).toBeVisible();

  // Que no quede en el catálogo de desarrollo.
  const baja = await page.request.post(`/api/v1/admin/productos/${id}/activo`, { data: { activo: false } });
  expect(baja.status()).toBe(204);
});
