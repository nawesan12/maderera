import { expect, test } from "@playwright/test";
import { SESION_ADMIN } from "./sesion-guardada";

/*
 * El stock, de punta a punta: el ajuste rápido de la grilla suma y resta en
 * una sucursal (lo hace la API de Go, backend/internal/stock, con el candado
 * de las reservas) y la grilla lo refleja.
 */

// El panel, con la sesión del admin que guardó autenticar.setup.ts.
test.use({ storageState: SESION_ADMIN });

test("el ajuste rápido suma y resta en una sucursal", async ({ page }) => {
  test.skip(test.info().project.name === "telefono", "el panel se prueba en escritorio");
  await page.goto("/admin/stock");

  const sumar = page.getByRole("button", { name: /^Sumar (uno|media) en Casa Central$/ }).first();
  await expect(sumar).toBeVisible();
  await sumar.click();
  await expect(page.getByText(/Casa Central: [\d.,]+ → [\d.,]+/).first()).toBeVisible();
  const restar = page.getByRole("button", { name: /^Restar (uno|media) en Casa Central$/ }).first();
  await restar.click();
  await expect(page.getByText(/Casa Central: [\d.,]+ → [\d.,]+/).first()).toBeVisible();
});
