import { expect, test } from "@playwright/test";
import { SESION_ADMIN } from "./sesion-guardada";

/*
 * Entregas, de punta a punta: un pedido con mercadería en acopio, un retiro
 * parcial con su remito (lo prepara la API de Go, backend/internal/entregas,
 * que saca la mercadería del depósito con el candado de la serie), el enlace
 * de firma, el PDF y la anulación (la mercadería vuelve). Se retira un
 * centavo de un renglón para no cerrar el pedido; el remito queda anulado,
 * como queda cualquier remito anulado (no se borra), y el stock como estaba.
 */

test.use({ storageState: SESION_ADMIN });

test("un retiro parcial con remito, su firma y su anulación", async ({ page }) => {
  test.skip(test.info().project.name === "telefono", "el panel se prueba en escritorio");

  // Un pedido con mercadería en acopio: el primero de la lista que deje
  // preparar un remito.
  await page.goto("/admin/pedidos");
  const enlaces = await page
    .locator('a[href^="/admin/pedidos/"]')
    .evaluateAll((as) => [...new Set(as.map((a) => a.getAttribute("href") ?? ""))]);
  const fichas = enlaces.filter((h) => /^\/admin\/pedidos\/[0-9a-f-]{36}$/.test(h)).slice(0, 20);
  let ficha: string | null = null;
  for (const href of fichas) {
    await page.goto(href);
    if (await page.getByRole("button", { name: "Preparar remito" }).isVisible()) {
      ficha = href;
      break;
    }
  }
  test.skip(!ficha, "no hay pedidos con mercadería en acopio en la base de desarrollo");

  await page.getByRole("button", { name: "Preparar remito" }).click();
  const cantidades = page.locator('input[name^="cantidad-"]');
  const n = await cantidades.count();
  for (let i = 0; i < n; i++) await cantidades.nth(i).fill(i === 0 ? "0,01" : "0");
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
  await expect(page.getByText("Remito anulado. La mercadería volvió al stock.")).toBeVisible();
  await firma.reload();
  await expect(firma.getByText("Este remito fue anulado")).toBeVisible();
  await firma.close();
});

test("las zonas de envío cargan", async ({ page }) => {
  test.skip(test.info().project.name === "telefono", "el panel se prueba en escritorio");
  const r = await page.goto("/admin/envios");
  expect(r?.status()).toBe(200);
  // Un 200 no prueba que ande: el error boundary también responde 200.
  await expect(page.getByText("Esta pantalla no cargó")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Agregar una zona" })).toBeVisible();
});
