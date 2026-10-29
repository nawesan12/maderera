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
