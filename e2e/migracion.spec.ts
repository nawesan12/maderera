import { expect, test } from "@playwright/test";
import { SESION_ADMIN } from "./sesion-guardada";

/*
 * La migración del sistema anterior, hasta la vista previa: elegir qué se
 * migra, subir una exportación de ISIS (CSV en Windows-1252, con punto y
 * coma), ver el mapeo propuesto y lo que entra y lo que no. Lo hace la API de
 * Go (backend/internal/migracion).
 *
 * No deja datos nuevos: se detiene antes de «Migrar», que es lo único que
 * escribe (abre una corrida y escribe en la cartera). La corrida entera, y
 * que repetirla no duplique nada, la prueban los tests de Go contra la base
 * (TestMigracionCompletaYRepetible).
 */

test.use({ storageState: SESION_ADMIN });

test.beforeEach(() => {
  test.skip(test.info().project.name === "telefono", "el panel se prueba en escritorio");
});

test("la pantalla muestra lo cargado, las siete entidades y el historial", async ({ page }) => {
  await page.goto("/admin/migracion");
  await expect(page.getByRole("heading", { name: "Migración de datos", level: 1 })).toBeVisible();
  await expect(page.getByText("Saldos iniciales")).toBeVisible();
  await expect(page.getByText("Corridas anteriores")).toBeVisible();
  for (const titulo of [
    "Clientes",
    "Productos y medidas",
    "Stock",
    "Saldos de cuenta corriente",
    "Proveedores",
    "Histórico de ventas",
    "Comprobantes emitidos",
  ]) {
    await expect(page.getByRole("button", { name: new RegExp(`^${titulo}`) })).toBeVisible();
  }
});

test("una exportación de clientes: el mapeo propuesto y la vista previa, sin escribir", async ({ page }) => {
  await page.goto("/admin/migracion");
  await page.getByRole("button", { name: /^Clientes/ }).click();

  // Como la guarda un Excel en castellano: Windows-1252 y punto y coma.
  const csv = [
    "Código;Razón Social;C.U.I.T.;Condición IVA;E-mail;Límite Crédito",
    "E2E-001;Pérez Juan Carlos;20-12345678-6;Consumidor Final;JUAN@MAIL.COM;1.500.000,00",
    "E2E-002;Muñoz Hnos.;20-11111111-1;Resp. Inscripto;;",
    "E2E-003;;;;;",
  ].join("\r\n");
  await page.locator('input[type="file"]').setInputFiles({
    name: "clientes-isis.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(csv + "\r\n", "latin1"),
  });

  await expect(page.getByText("clientes-isis.csv")).toBeVisible();
  await expect(page.getByText("3 filas · 6 columnas")).toBeVisible();
  await expect(page.getByText("Guardado en Windows-1252, se convirtió al leerlo.")).toBeVisible();

  await page.getByRole("button", { name: "Revisar antes de migrar" }).click();

  // Entran dos (una con el CUIT que no verifica) y la que no tiene nombre
  // queda afuera.
  await expect(page.getByRole("button", { name: "Migrar 2 filas" })).toBeVisible();
  await expect(page.getByText("Falta nombre.")).toBeVisible();
  await expect(page.getByText(/El CUIT 20-11111111-1 no verifica/)).toBeVisible();
  await expect(page.getByText("Pérez Juan Carlos · consumidor final")).toBeVisible();

  // Se vuelve sin migrar: no se escribió nada.
  await page.getByRole("button", { name: "Empezar de nuevo" }).click();
  await expect(page.getByRole("button", { name: /^Productos y medidas/ })).toBeVisible();
});

test("un Excel viejo (.xls) se rechaza con el motivo", async ({ page }) => {
  await page.goto("/admin/migracion");
  await page.getByRole("button", { name: /^Productos y medidas/ }).click();
  await page.locator('input[type="file"]').setInputFiles({
    name: "articulos.xls",
    mimeType: "application/vnd.ms-excel",
    buffer: Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0]),
  });
  await expect(page.getByText(/Esto es un Excel viejo \(\.xls\)/)).toBeVisible();
});
