import { expect, test } from "@playwright/test";
import { SESION_ADMIN } from "./sesion-guardada";

/*
 * La caja del panel, el cierre del mes y los reportes (tanda 5, parte D): las
 * pantallas se arman con lo que devuelve la API de Go y las exportaciones
 * salen de Go. Solo lee: no deja datos colgados (una caja física no se borra
 * nunca, por eso acá no se da de alta ninguna).
 */

test.use({ storageState: SESION_ADMIN });

test.beforeEach(() => {
  test.skip(test.info().project.name === "telefono", "el panel se prueba en escritorio");
});

test("la caja muestra las sucursales, los turnos y lo emitido", async ({ page }) => {
  await page.goto("/admin/caja");
  await expect(page.getByRole("heading", { name: "Caja", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Turnos cerrados" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Emitido en el mostrador" })).toBeVisible();
  await expect(page.getByText(/Casa Central|Aserradero/).first()).toBeVisible();
});

test("el cierre del mes y sus asientos en CSV", async ({ page, request }) => {
  await page.goto("/admin/cierre");
  await expect(page.getByRole("heading", { name: "Cierre del mes" })).toBeVisible();
  await expect(page.getByText(/\d+ asientos/)).toBeVisible();
  const r = await request.get("/admin/cierre/exportar?periodo=2026-10");
  expect(r.status()).toBe(200);
  expect(r.headers()["content-disposition"]).toContain("asientos-2026-10.csv");
  expect(await r.text()).toContain('"Asiento";"Fecha";"Concepto"');
});

test("el reporte de ventas y la reposición, con sus archivos", async ({ page, request }) => {
  await page.goto("/admin/reportes?periodo=anio&corte=rubro");
  await expect(page.getByRole("heading", { name: "Reportes" })).toBeVisible();
  const csv = await request.get("/admin/reportes/exportar?corte=rubro&periodo=anio");
  expect(csv.status()).toBe(200);
  expect(await csv.text()).toContain('"Rubro";"Detalle";"Operaciones"');
  const pdf = await request.get("/admin/reportes/exportar?corte=producto&periodo=mes&formato=pdf");
  expect(pdf.headers()["content-type"]).toBe("application/pdf");

  await page.goto("/admin/reportes/reposicion?dias=60");
  await expect(page.getByRole("heading", { name: "Reposición" })).toBeVisible();
  const rep = await request.get("/admin/reportes/reposicion/exportar?dias=60");
  expect(rep.headers()["content-disposition"]).toContain("reposicion-60dias.csv");
  expect(await rep.text()).toContain("Producto;Medida;Código");
});

test("el inicio del panel muestra los números y lo pendiente", async ({ page }) => {
  await page.goto("/admin");
  await expect(page.getByText(/Ventas · este mes/i)).toBeVisible();
});
