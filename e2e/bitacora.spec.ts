import { expect, test } from "@playwright/test";
import { SESION_ADMIN } from "./sesion-guardada";

/*
 * La bitácora la lee Go (backend/internal/bitacora): la pantalla con sus
 * filtros, y la campanita de actividad del panel.
 */

test.use({ storageState: SESION_ADMIN });

test("la bitácora lista y filtra lo que se hizo en el panel", async ({ page }) => {
  test.skip(test.info().project.name === "telefono", "el panel se prueba en escritorio");
  await page.goto("/admin/bitacora?dias=3650");
  await expect(page.getByRole("heading", { name: "Bitácora", level: 1 })).toBeVisible();
  // Las otras pruebas dejan rastro (bloquear y habilitar una cuenta): con
  // buscarlo alcanza para ver que filtra.
  await page.goto("/admin/bitacora?dias=3650&buscar=cuenta%20corriente");
  await expect(page.getByText(/cuenta corriente/i).first()).toBeVisible();
});

test("las sucursales muestran sus números", async ({ page }) => {
  test.skip(test.info().project.name === "telefono", "el panel se prueba en escritorio");
  await page.goto("/admin/sucursales");
  await expect(page.getByRole("heading", { name: "Sucursales", level: 1 })).toBeVisible();
  await expect(page.getByText("Casa Central").first()).toBeVisible();
});

test("el buscador del panel encuentra un proveedor", async ({ page }) => {
  test.skip(test.info().project.name === "telefono", "el panel se prueba en escritorio");
  await page.goto("/admin");
  await page.getByLabel("Buscar en el panel").fill("Tableros");
  await expect(page.getByRole("button", { name: /Tableros del Sur/ }).first()).toBeVisible();
});
