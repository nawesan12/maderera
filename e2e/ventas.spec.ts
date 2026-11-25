import { expect, test } from "@playwright/test";
import { SESION_ADMIN } from "./sesion-guardada";

/*
 * Ventas del panel, de punta a punta: un presupuesto se carga a mano, se
 * acepta, pasa a pedido (reserva la mercadería), avanza un paso y se
 * cancela (la reserva vuelve). Otro se carga y se rechaza. Lo hace la API de
 * Go (backend/internal/pedidos), con la ficha, el PDF y los candados.
 *
 * Pasar a pedido pregunta la entrega y el pago, y la cancelación se hace con
 * su botón y su motivo. Quedan un presupuesto rechazado y un pedido
 * cancelado, sin nada reservado: el stock queda como estaba.
 */

test.use({ storageState: SESION_ADMIN });

test.beforeEach(() => {
  test.skip(test.info().project.name === "telefono", "el panel se prueba en escritorio");
});

/** Carga uno y termina en su ficha (al guardar, el alta lleva ahí). */
async function cargarPresupuesto(page: import("@playwright/test").Page, nombre: string): Promise<string> {
  await page.goto("/admin/presupuestos/nuevo");
  await page.locator("#contactoNombre").fill(nombre);
  await page.getByPlaceholder("Buscar por nombre, medida o código").fill("mm");
  const primera = page.locator("ul button").first();
  await expect(primera).toBeVisible();
  await primera.click();
  await page.getByRole("button", { name: "Guardar presupuesto" }).click();
  await page.waitForURL(/\/admin\/presupuestos\/[0-9a-f-]{36}/);
  const titulo = page.getByRole("heading", { level: 1 });
  await expect(titulo).toHaveText(/P-\d{4}-\d{4}/);
  return (await titulo.textContent())!.match(/P-\d{4}-\d{4}/)![0];
}

test("un presupuesto pasa a pedido, avanza y se cancela", async ({ page }) => {
  const nombre = `E2E ventas ${Date.now()}`;
  const numero = await cargarPresupuesto(page, nombre);

  // La ficha baja el PDF que arma Go, y el listado lo encuentra.
  const id = page.url().split("/").pop()!.split("?")[0];
  await page.goto(`/admin/presupuestos?buscar=${encodeURIComponent(nombre)}`);
  await page.getByRole("link", { name: numero }).click();
  await expect(page.getByRole("heading", { name: numero })).toBeVisible();
  const pdf = await page.request.get(`/api/presupuestos/${id}/pdf`);
  expect(pdf.status()).toBe(200);
  expect((await pdf.body()).subarray(0, 4).toString()).toBe("%PDF");

  await page.getByRole("button", { name: "Aceptar" }).click();
  await expect(page.getByText("Presupuesto actualizado.")).toBeVisible();
  // Pasar a pedido pregunta la entrega y el pago, y lleva a su ficha.
  await page.getByRole("button", { name: "Pasar a pedido" }).click();
  const dialogo = page.getByRole("dialog");
  await dialogo.getByRole("radio", { name: "Efectivo" }).click();
  await dialogo.getByRole("button", { name: "Crear el pedido" }).click();
  await page.waitForURL(/\/admin\/pedidos\/[0-9a-f-]{36}/);
  await expect(page.getByText(`Generado desde el presupuesto ${numero}`)).toBeVisible();
  await expect(page.getByRole("link", { name: numero })).toBeVisible();
  const pedido = (await page.locator("main").innerText()).match(/PED-\d+/)![0];
  await page.getByRole("button", { name: "Preparar", exact: true }).click();
  await expect(page.getByText(`${pedido} quedó en preparación.`)).toBeVisible();

  // Se cancela con su botón y su motivo; dos veces no se puede.
  const pedidoId = page.url().split("/").pop()!;
  await page.getByRole("button", { name: "Cancelar pedido" }).click();
  await page.getByRole("dialog").getByLabel("Por qué").fill("Prueba de punta a punta");
  await page.getByRole("dialog").getByRole("button", { name: "Cancelar el pedido" }).click();
  await expect(page.getByText("Pedido cancelado. La mercadería reservada quedó disponible.")).toBeVisible();
  const otra = await page.request.post(`/api/v1/admin/pedidos/${pedidoId}/cancelar`, { data: {} });
  expect(otra.status()).toBe(422);
  await page.reload();
  await expect(page.getByText("Prueba de punta a punta")).toBeVisible();
  await expect(page.getByRole("button", { name: "Marcar listo" })).toHaveCount(0);
});

test("un presupuesto se rechaza", async ({ page }) => {
  const nombre = `E2E rechazo ${Date.now()}`;
  const numero = await cargarPresupuesto(page, nombre);
  await page.goto(`/admin/presupuestos?buscar=${encodeURIComponent(nombre)}`);
  await page.getByRole("link", { name: numero }).click();
  await expect(page.getByRole("heading", { name: numero })).toBeVisible();
  await page.getByRole("button", { name: "Rechazar" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Rechazar" }).click();
  await expect(page.getByText("Presupuesto actualizado.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Pasar a pedido" })).toHaveCount(0);
});

test("el alta rechaza un nombre corto con el mensaje de siempre", async ({ page }) => {
  await page.goto("/admin/presupuestos/nuevo");
  await page.locator("#contactoNombre").fill("J");
  await page.getByPlaceholder("Buscar por nombre, medida o código").fill("mm");
  const primera = page.locator("ul button").first();
  await expect(primera).toBeVisible();
  await primera.click();
  await page.getByRole("button", { name: "Guardar presupuesto" }).click();
  await expect(page.getByText("Poné a nombre de quién va.")).toBeVisible();
});
