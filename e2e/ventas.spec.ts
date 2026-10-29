import { expect, test } from "@playwright/test";
import { SESION_ADMIN } from "./sesion-guardada";

/*
 * Ventas del panel, de punta a punta: un presupuesto se carga a mano, se
 * acepta, pasa a pedido (reserva la mercadería), avanza un paso y se
 * cancela (la reserva vuelve). Otro se carga y se rechaza. Lo hace la API de
 * Go (backend/internal/pedidos), con la ficha, el PDF y los candados.
 *
 * La cancelación no tiene botón en el panel (cancelarPedido no lo usa
 * ninguna pantalla): se pide a la API con la misma sesión, por la dirección
 * que Next reenvía a Go. Quedan un presupuesto rechazado y un pedido
 * cancelado, sin nada reservado: el stock queda como estaba.
 */

test.use({ storageState: SESION_ADMIN });

test.beforeEach(() => {
  test.skip(test.info().project.name === "telefono", "el panel se prueba en escritorio");
});

async function cargarPresupuesto(page: import("@playwright/test").Page, nombre: string): Promise<string> {
  await page.goto("/admin/presupuestos/nuevo");
  await page.locator("#contactoNombre").fill(nombre);
  await page.getByPlaceholder("Buscar por nombre, medida o código").fill("mm");
  const primera = page.locator("ul button").first();
  await expect(primera).toBeVisible();
  await primera.click();
  await page.getByRole("button", { name: "Guardar presupuesto" }).click();
  const aviso = page.getByText(/Se creó el presupuesto P-\d{4}-\d{4}\./);
  await expect(aviso).toBeVisible();
  return (await aviso.textContent())!.match(/P-\d{4}-\d{4}/)![0];
}

test("un presupuesto pasa a pedido, avanza y se cancela", async ({ page }) => {
  const nombre = `E2E ventas ${Date.now()}`;
  const numero = await cargarPresupuesto(page, nombre);

  // El listado lo encuentra, y la ficha baja el PDF que arma Go.
  await page.goto(`/admin/presupuestos?buscar=${encodeURIComponent(nombre)}`);
  await page.getByRole("link", { name: numero }).click();
  await expect(page.getByRole("heading", { name: numero })).toBeVisible();
  const id = page.url().split("/").pop()!;
  const pdf = await page.request.get(`/api/presupuestos/${id}/pdf`);
  expect(pdf.status()).toBe(200);
  expect((await pdf.body()).subarray(0, 4).toString()).toBe("%PDF");

  await page.getByRole("button", { name: "Aceptar" }).click();
  await expect(page.getByText("Presupuesto actualizado.")).toBeVisible();
  await page.getByRole("button", { name: "Pasar a pedido" }).click();
  const creado = page.getByText(/Se creó el pedido PED-\d+\./);
  await expect(creado).toBeVisible();
  const pedido = (await creado.textContent())!.match(/PED-\d+/)![0];

  // El pedido en el tablero; se abre y se prepara.
  await page.goto(`/admin/pedidos?buscar=${encodeURIComponent(pedido)}`);
  await page.getByRole("link", { name: nombre }).first().click();
  await expect(page.getByText(`Generado desde el presupuesto ${numero}`)).toBeVisible();
  await page.getByRole("button", { name: "Preparar", exact: true }).click();
  await expect(page.getByText(`${pedido} quedó en preparación.`)).toBeVisible();

  // Se cancela por la API (no hay botón), y avanzarlo ya no se puede.
  const pedidoId = page.url().split("/").pop()!;
  const cancelar = await page.request.post(`/api/v1/admin/pedidos/${pedidoId}/cancelar`, {
    data: { motivo: "Prueba de punta a punta" },
  });
  expect(cancelar.status()).toBe(200);
  expect((await cancelar.json()).ok).toBe("Pedido cancelado. La mercadería reservada quedó disponible.");
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
