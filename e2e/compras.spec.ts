import { expect, test } from "@playwright/test";
import { SESION_ADMIN } from "./sesion-guardada";

/*
 * Compras, de punta a punta: una recepción de mercadería se carga en
 * borrador, se confirma (entra el stock, se mezcla el costo y sube la deuda:
 * lo hace la API de Go, backend/internal/compras, con el candado del stock) y
 * se anula (el stock y la deuda vuelven). Los datos quedan como estaban,
 * salvo el costo promedio, que no se revierte a propósito: la línea entra al
 * costo que ya tenía, así que tampoco se mueve.
 */

// El panel, con la sesión del admin que guardó autenticar.setup.ts.
test.use({ storageState: SESION_ADMIN });

test("una recepción se carga, se confirma y se anula", async ({ page }) => {
  test.skip(test.info().project.name === "telefono", "el panel se prueba en escritorio");
  await page.goto("/admin/recepciones/nueva");
  // El proveedor ya no viene elegido: se elige el primero.
  const proveedor = page.locator("select").first();
  await proveedor.selectOption({ index: 1 });
  // La sucursal tampoco, si hay más de una y nadie tiene la caja abierta.
  await page.getByText("Casa Central", { exact: true }).click();
  await expect(page.getByRole("radio", { name: "Casa Central" })).toBeChecked();

  await page.getByPlaceholder("0002-00034512").fill(`E2E-${Date.now()}`);
  await page.getByPlaceholder("Buscar mercadería por nombre, medida o código…").fill("mm");
  const primera = page.locator("ul button").first();
  await expect(primera).toBeVisible();
  await primera.click();
  await expect(page.locator("tbody tr")).toHaveCount(1);
  // Entra al costo que ya tenía, así el promedio no se mueve. Una recepción
  // de neto cero no se guarda: si no tenía costo, a uno.
  const costo = page.locator("tbody tr").first().getByRole("spinbutton").nth(1);
  if (!Number(await costo.inputValue())) await costo.fill("1");

  await page.getByRole("button", { name: "Guardar en borrador" }).click();
  await expect(page).toHaveURL(/\/admin\/recepciones\/[0-9a-f-]{36}$/);

  await page.getByRole("button", { name: "Confirmar la recepción" }).click();
  await page.getByRole("button", { name: "Sí, confirmar" }).click();
  await expect(page.getByText(/Recepción confirmada: 1 renglones, \$[\d.]+ netos\./)).toBeVisible();

  await page.getByText("Anular esta recepción").click();
  await page.getByPlaceholder("Motivo").fill("Prueba de punta a punta");
  await page.getByRole("button", { name: "Anular", exact: true }).click();
  await expect(page.getByText("Recepción anulada. El stock volvió atrás; el costo promedio no se toca.")).toBeVisible();
});

test("las pantallas de compras cargan", async ({ page }) => {
  test.skip(test.info().project.name === "telefono", "el panel se prueba en escritorio");
  for (const ruta of ["/admin/proveedores", "/admin/compras/ordenes", "/admin/compras/facturas", "/admin/compras/pagos", "/admin/compras/gastos", "/admin/recepciones", "/admin/arca/retenciones", "/admin/arca/libro-iva-compras"]) {
    const r = await page.goto(ruta);
    expect(r?.status(), ruta).toBe(200);
    // Un 200 no prueba que ande: el error boundary también responde 200.
    await expect(page.getByText("Esta pantalla no cargó"), ruta).toHaveCount(0);
  }
});

/*
 * Un pago a proveedor se registra y se anula desde su ficha. La anulación
 * devuelve la deuda (lo prueba Go, backend/internal/compras); acá, que pida
 * el motivo y el pago quede anulado con él.
 */
test("un pago a proveedor se registra y se anula", async ({ page }) => {
  test.skip(test.info().project.name === "telefono", "el panel se prueba en escritorio");
  await page.goto("/admin/compras/pagos");
  // Sin proveedor elegido de entrada: el formulario arranca de a quién se le paga.
  await page.getByLabel("A quién se le paga").selectOption({ index: 1 });
  // Las facturas del proveedor llegan y reinician el total: se espera.
  await expect(page.getByRole("heading", { name: "Qué facturas se pagan" })).toBeVisible();
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Total del pago").fill("1");
  await page.getByPlaceholder("N.º de operación").first().fill(`E2E-${Date.now()}`);
  await page.getByRole("button", { name: /^Pagar/ }).click();
  await expect(page.getByText(/Pago registrado|Se registró el pago/)).toBeVisible();

  // El más nuevo de la lista es este: a su ficha, y se anula con motivo.
  await page.reload();
  await page.locator("tbody tr").first().getByRole("link").first().click();
  await page.waitForURL(/\/admin\/compras\/pagos\/[0-9a-f-]{36}/);
  await page.getByRole("button", { name: /^Anular/ }).first().click();
  await page.getByRole("dialog").getByLabel("Motivo").fill("Prueba de punta a punta");
  await page.getByRole("dialog").getByRole("button", { name: "Anular el pago" }).click();
  await page.reload();
  await expect(page.getByText("Prueba de punta a punta")).toBeVisible();
});

// Los mínimos de un régimen se editan desde la pantalla (antes solo por SQL).
test("los mínimos de un régimen de retención se editan", async ({ page }) => {
  test.skip(test.info().project.name === "telefono", "el panel se prueba en escritorio");
  await page.goto("/admin/arca/retenciones");
  // La fila del primer régimen: el «Guardar» aparece solo cuando algo cambió.
  const fila = page.locator("li", { has: page.locator('input[name="minimoRetencion"]') }).first();
  const minimo = fila.locator('input[name="minimoRetencion"]');
  const antes = await minimo.inputValue();
  const otro = String(Number(antes) + 1);

  await minimo.fill(otro);
  await fila.getByRole("button", { name: "Guardar", exact: true }).click();
  await expect(fila.getByText(/^Listo/)).toBeVisible();
  await page.reload();
  await expect(fila.locator('input[name="minimoRetencion"]')).toHaveValue(otro);

  // Vuelve a como estaba.
  await fila.locator('input[name="minimoRetencion"]').fill(antes);
  await fila.getByRole("button", { name: "Guardar", exact: true }).click();
  await expect(fila.getByText(/^Listo/)).toBeVisible();
});
