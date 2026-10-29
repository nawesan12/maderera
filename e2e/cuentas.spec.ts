import { expect, test } from "@playwright/test";
import { SESION_ADMIN } from "./sesion-guardada";

/*
 * Clientes y cuenta corriente, de punta a punta: la cartera, la ficha con su
 * historial, el bloqueo de la cuenta corriente (y volver a habilitarla), el
 * alta que rechaza un CUIT mal escrito, y las pantallas de cheques, vendedores
 * y seguimiento. Lo hace la API de Go (backend/internal/clientes y cobros).
 * No deja datos nuevos: el bloqueo se deshace y el alta no pasa.
 */

test.use({ storageState: SESION_ADMIN });

test.beforeEach(() => {
  test.skip(test.info().project.name === "telefono", "el panel se prueba en escritorio");
});

test("la ficha de un cliente: historial, y bloquear y volver a habilitar la cuenta", async ({ page }) => {
  await page.goto("/admin/clientes");
  await expect(page.getByRole("heading", { name: "Clientes", level: 1 })).toBeVisible();

  const href = await page
    .locator("a")
    .evaluateAll((as) =>
      as.map((a) => a.getAttribute("href") ?? "").find((h) => /^\/admin\/clientes\/[0-9a-f-]{36}$/.test(h)),
    );
  expect(href, "hay al menos un cliente en la cartera").toBeTruthy();
  await page.goto(`${href}?ver=pagos`);
  await expect(page.getByRole("heading", { name: "Cuenta corriente" }).first()).toBeVisible();

  // Si quedó bloqueada de una corrida anterior, primero se habilita.
  const habilitar = page.getByRole("button", { name: "Volver a habilitarla" });
  if (await habilitar.isVisible()) {
    await habilitar.click();
    await expect(page.getByText("Cuenta corriente habilitada de nuevo.")).toBeVisible();
  }
  await page.getByPlaceholder("Por qué se bloquea").fill("Prueba de punta a punta");
  await page.getByRole("button", { name: "Bloquear la cuenta" }).click();
  await expect(page.getByText("Cuenta corriente bloqueada. El mostrador no va a poder venderle a cuenta.")).toBeVisible();
  await expect(page.getByText("La cuenta corriente está bloqueada")).toBeVisible();

  await page.getByRole("button", { name: "Volver a habilitarla" }).click();
  await expect(page.getByText("Cuenta corriente habilitada de nuevo.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Bloquear la cuenta" })).toBeVisible();

  // El resumen de cuenta en PDF lo arma Go.
  const pdf = await page.request.get(`/api/cuenta/${href!.split("/").pop()}/pdf`);
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()["content-type"]).toBe("application/pdf");
  expect((await pdf.body()).subarray(0, 4).toString()).toBe("%PDF");
});

test("el alta rechaza un CUIT mal escrito", async ({ page }) => {
  await page.goto("/admin/clientes");
  await page.getByRole("button", { name: "Nuevo cliente" }).first().click();
  await page.getByLabel("Nombre y apellido").fill("Prueba de punta a punta");
  await page.getByLabel("CUIT").fill("20-123");
  await page.getByRole("button", { name: "Guardar cliente" }).click();
  await expect(page.getByText("El CUIT tiene que tener 11 dígitos, con o sin guiones.")).toBeVisible();
});

test("cheques, vendedores y seguimiento cargan desde la API", async ({ page }) => {
  for (const [ruta, titulo] of [
    ["/admin/cheques", "Cheques"],
    ["/admin/clientes/vendedores", "Vendedores"],
    ["/admin/clientes/seguimiento", "Seguimiento"],
  ]) {
    await page.goto(ruta);
    await expect(page.getByRole("heading", { name: titulo, level: 1 })).toBeVisible();
  }
});
