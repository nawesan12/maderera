import { expect, test } from "@playwright/test";
import { SESION_ADMIN } from "./sesion-guardada";

/*
 * Facturación electrónica, de punta a punta: el listado, la pantalla de ARCA,
 * el libro IVA ventas y su CSV, la nueva factura que rechaza un CUIT mal
 * escrito (sin emitir nada) y, si hay un comprobante, su ficha y su PDF. Todo
 * lo hace la API de Go (backend/internal/facturacion).
 *
 * No deja datos: un comprobante emitido no se borra (la numeración fiscal no
 * tiene huecos), así que la prueba no emite ninguno. La factura de la prueba
 * se frena en la validación del CUIT, antes de numerar.
 */

test.use({ storageState: SESION_ADMIN });

test.beforeEach(() => {
  test.skip(test.info().project.name === "telefono", "el panel se prueba en escritorio");
});

test("el listado de facturación y la pantalla de ARCA cargan desde la API", async ({ page }) => {
  await page.goto("/admin/facturacion");
  await expect(page.getByRole("heading", { name: "Facturación", level: 1 })).toBeVisible();
  await page.goto("/admin/arca");
  await expect(page.getByRole("heading", { name: "ARCA", level: 1 })).toBeVisible();
  // Sin certificado, el proveedor interno; con él, ARCA (homologación o producción).
  await expect(page.getByText(/Sin conexión con ARCA|Conectado a ARCA/)).toBeVisible();
});

test("el libro IVA ventas y su CSV", async ({ page }) => {
  await page.goto("/admin/arca/libro-iva");
  await expect(page.getByRole("heading", { name: "Libro IVA ventas", level: 1 })).toBeVisible();
  const csv = await page.request.get("/admin/arca/libro-iva/exportar?periodo=2026-10");
  expect(csv.status()).toBe(200);
  expect(csv.headers()["content-disposition"]).toContain("libro-iva-ventas-2026-10.csv");
  const texto = (await csv.body()).toString("utf8");
  expect(texto.startsWith("\ufeff")).toBe(true);
  expect(texto).toContain('"Fecha";"Tipo";"Numero";"Cliente";"CUIT"');
  expect(texto).toContain('"TOTALES"');
});

test("la nueva factura rechaza un CUIT mal escrito sin emitir nada", async ({ page }) => {
  await page.goto("/admin/facturacion/nueva");
  await expect(page.getByRole("heading", { name: "Nueva factura", level: 1 })).toBeVisible();
  await page.getByLabel("Nombre o razón social").fill("Prueba de punta a punta");
  await page.getByLabel("CUIT").fill("20-123");
  await page.getByLabel("Descripción del renglón 1").fill("Renglón de prueba");
  await page.getByLabel("Cantidad del renglón 1").fill("1");
  await page.getByLabel("Precio del renglón 1").fill("1210");
  await page.getByRole("button", { name: /^Emitir factura/ }).click();
  await expect(page.getByText("El CUIT tiene que tener 11 dígitos.")).toBeVisible();
  await expect(page).toHaveURL(/\/admin\/facturacion\/nueva/);
});

test("la ficha de un comprobante y su PDF", async ({ page }) => {
  await page.goto("/admin/facturacion?periodo=todo");
  const href = await page
    .locator("a")
    .evaluateAll((as) =>
      as.map((a) => a.getAttribute("href") ?? "").find((h) => /^\/admin\/facturacion\/[0-9a-f-]{36}$/.test(h)),
    );
  test.skip(!href, "no hay comprobantes en la base de desarrollo");
  await page.goto(href!);
  await expect(page.getByText(/Emitida el/)).toBeVisible();
  const id = href!.split("/").pop();
  const pdf = await page.request.get(`/api/comprobantes/${id}/pdf`);
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()["content-type"]).toBe("application/pdf");
  expect((await pdf.body()).subarray(0, 4).toString()).toBe("%PDF");
  // La hoja impresa, con el mismo comprobante.
  await page.goto(`/comprobante/${id}`);
  await expect(page.getByText(/Fecha de emisión/)).toBeVisible();
});
