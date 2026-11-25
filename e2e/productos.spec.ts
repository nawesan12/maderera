import { expect, test } from "@playwright/test";
import { tiendaEncendida } from "./molde";
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
  // Las medidas y los precios van en su pestaña (tanda 7).
  await page.getByRole("tab", { name: "Medidas y precios" }).click();
  await page.locator("#v-0-sku").fill(`E2E-${Date.now()}`);
  await page.locator("#v-0-label").fill("18 mm");

  // Un código de una letra: el error es el de la validación de Go, y el
  // foco queda en su celda.
  await page.locator("#v-0-sku").fill("X");
  await page.getByRole("button", { name: "Guardar producto" }).click();
  await expect(page.getByText("El código tiene que tener al menos 2 letras o números.")).toBeVisible();
  await expect(page.locator("#v-0-sku")).toBeFocused();

  await page.locator("#v-0-sku").fill(`E2E-${Date.now()}`);
  await page.locator("#v-0-precioGeneral").fill("12345");
  // Una celda de stock por sucursal de la base, con su slug en el id.
  await page.locator("#v-0-stock-casa-central").fill("7");
  await page.getByRole("button", { name: "Guardar producto" }).click();
  // Guardado, se queda en la ficha y la abre en Fotos.
  await expect(page).toHaveURL(/\/admin\/productos\/[0-9a-f-]{36}\?guardado=\d+&pestana=fotos/);
  await expect(page.getByText("Producto creado. Ahora sus fotos.")).toBeVisible();
  const id = page.url().split("/admin/productos/")[1]?.split(/[?#]/)[0] ?? "";

  await page.goto(`/admin/productos?buscar=${encodeURIComponent(nombre)}`);
  await expect(page.getByRole("link", { name: nombre }).first()).toBeVisible();
  await page.goto(`/admin/productos/${id}`);
  await page.getByRole("tab", { name: "Medidas y precios" }).click();
  await expect(page.locator("#v-0-stock-casa-central")).toHaveValue("7");

  // Editar el stock.
  await page.locator("#v-0-stock-casa-central").fill("4");
  await page.getByRole("button", { name: "Guardar producto" }).click();
  await expect(page).toHaveURL(/\/admin\/productos\/[0-9a-f-]{36}\?guardado=\d+$/);
  await page.getByRole("tab", { name: "Medidas y precios" }).click();
  await expect(page.locator("#v-0-stock-casa-central")).toHaveValue("4");

  // En el catálogo, con su precio.
  // La caché del catálogo se renueva al guardar, pero puede tardar un
  // pedido en verse: se recarga hasta que aparece.
  await expect(async () => {
    await page.goto(`/catalogo?buscar=${encodeURIComponent(nombre)}`);
    await expect(page.getByText(nombre).first()).toBeVisible({ timeout: 3000 });
  }).toPass({ timeout: 30000 });
  if (await tiendaEncendida(page.request)) await expect(page.getByText(/12\.345/).first()).toBeVisible();

  // Que no quede en el catálogo de desarrollo.
  const baja = await page.request.post(`/api/v1/admin/productos/${id}/activo`, { data: { activo: false } });
  expect(baja.status()).toBe(204);
});
