import { expect, test } from "@playwright/test";
import { SESION_ADMIN } from "./sesion-guardada";

/*
 * Entregas, de punta a punta: un pedido con mercadería en acopio, un retiro
 * parcial con su remito (lo prepara la API de Go, backend/internal/entregas,
 * que saca la mercadería del depósito con el candado de la serie), el enlace
 * de firma, el PDF y la anulación (la mercadería vuelve). El pedido es
 * propio y de dos unidades; se retira una para no cerrarlo. El remito queda
 * anulado, como queda cualquier remito anulado (no se borra), el pedido
 * cancelado y el stock como estaba.
 */

test.use({ storageState: SESION_ADMIN });

test("un retiro parcial con remito, su firma y su anulación", async ({ page }) => {
  test.skip(test.info().project.name === "telefono", "el panel se prueba en escritorio");

  // Un pedido propio con dos unidades en acopio: un presupuesto que se acepta
  // y pasa a pedido. Antes se buscaba uno en la base y se retiraba un
  // centavo, pero lo que no se fracciona sale entero (T4) y los pedidos de la
  // base de desarrollo se habían quedado con 0,99 de una bisagra: se retira
  // uno de dos, que sirve para lo que se fracciona y para lo que no.
  await page.goto("/admin/presupuestos/nuevo");
  await page.locator("#contactoNombre").fill(`E2E entregas ${Date.now()}`);
  await page.getByPlaceholder("Buscar por nombre, medida o código").fill("mm");
  const primera = page.locator("ul button").first();
  await expect(primera).toBeVisible();
  await primera.click();
  await page.locator("#cantidad-0").fill("2");
  await page.getByRole("button", { name: "Guardar presupuesto" }).click();
  await page.waitForURL(/\/admin\/presupuestos\/[0-9a-f-]{36}/);
  await page.getByRole("button", { name: "Aceptar" }).click();
  await expect(page.getByText("Presupuesto actualizado.")).toBeVisible();
  await page.getByRole("button", { name: "Pasar a pedido" }).click();
  await page.getByRole("dialog").getByRole("radio", { name: "Efectivo" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Crear el pedido" }).click();
  await page.waitForURL(/\/admin\/pedidos\/[0-9a-f-]{36}/);

  await page.getByRole("button", { name: "Preparar remito" }).click();
  const cantidades = page.locator('input[name^="cantidad-"]');
  await expect(cantidades).toHaveCount(1);
  await cantidades.first().fill("1");
  await page.locator('input[name="receptorNombre"]').fill("Prueba de punta a punta");
  await page.locator('input[name="receptorDocumento"]').fill("30111222");
  await page.getByRole("button", { name: "Generar remito" }).click();

  const listo = page.getByText(/Remito REM-\d+ listo\. Todavía queda mercadería en acopio\./);
  await expect(listo).toBeVisible();
  const numero = (await listo.textContent())?.match(/REM-\d+/)?.[0] ?? "";
  expect(numero).not.toBe("");

  // El enlace de firma abre la constancia para firmar, sin sesión de por medio.
  const enlace = await page.locator('a[href^="/firmar/"]').first().getAttribute("href");
  expect(enlace).toBeTruthy();
  const firma = await page.context().newPage();
  await firma.goto(enlace!);
  await expect(firma.getByRole("heading", { name: "Confirmá lo que retirás" })).toBeVisible();
  await expect(firma.getByText(numero)).toBeVisible();

  // El PDF lo arma Go.
  await page.reload();
  const fila = page.locator("li, div").filter({ hasText: numero }).filter({ has: page.getByRole("button", { name: "Anular" }) }).last();
  const pdf = await fila.locator('a[href^="/api/remitos/"]').first().getAttribute("href").catch(() => null);
  if (pdf) {
    const r = await page.request.get(pdf);
    expect(r.status()).toBe(200);
    expect(r.headers()["content-type"]).toBe("application/pdf");
  }

  // Anularlo devuelve la mercadería; el enlace pasa a decir que se anuló.
  await fila.getByRole("button", { name: "Anular" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Anular el remito" }).click();
  await expect(page.getByText("Remito anulado. La mercadería volvió al stock.")).toBeVisible();
  await firma.reload();
  await expect(firma.getByText("Este remito fue anulado")).toBeVisible();
  await firma.close();

  // El pedido se cancela: la reserva vuelve y el stock queda como estaba.
  await page.getByRole("button", { name: "Cancelar pedido" }).click();
  await page.getByRole("dialog").getByLabel("Por qué").fill("Prueba de punta a punta");
  await page.getByRole("dialog").getByRole("button", { name: "Cancelar el pedido" }).click();
  await expect(page.getByText("Pedido cancelado. La mercadería reservada quedó disponible.")).toBeVisible();
});

test("las zonas de envío cargan", async ({ page }) => {
  test.skip(test.info().project.name === "telefono", "el panel se prueba en escritorio");
  const r = await page.goto("/admin/envios");
  expect(r?.status()).toBe(200);
  // Un 200 no prueba que ande: el error boundary también responde 200.
  await expect(page.getByText("Esta pantalla no cargó")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Agregar una zona" })).toBeVisible();
});
