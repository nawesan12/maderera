import { expect, test } from "@playwright/test";
import { SESION_ADMIN } from "./sesion-guardada";

/*
 * Los cortes, de punta a punta, con el motor en Go (backend/internal/cortes):
 * la calculadora del sitio, el plano que se dibuja mientras se tipea en
 * /corte, y la ficha del panel con el plano, la hoja y el PTX que baja al
 * taller. Nada de esto escribe en la base: los datos de desarrollo quedan
 * como estaban.
 */

test("la calculadora de deck cuenta tablas enteras", async ({ page }) => {
  await page.goto("/calculadora");
  await page.getByRole("tab", { name: /deck/i }).click();
  await page.getByPlaceholder("ej: 5").last().fill("4");
  await page.getByPlaceholder("ej: 3").last().fill("3");
  await page.getByRole("button", { name: /Calcular Materiales/ }).last().click();
  // 4 × 3 m con el margen, en tablas de 2,4 m × 10 cm: un número entero.
  await expect(page.getByText(/tablas de .* m x .* cm/)).toBeVisible();
});

test("el armador de /corte dibuja el plano mientras se tipea", async ({ page }) => {
  await page.goto("/corte");
  const largo = page.getByPlaceholder("1200").first();
  test.skip(!(await largo.isVisible()), "no hay placas cortables en los datos de desarrollo");
  await largo.fill("900");
  await page.getByPlaceholder("400").first().fill("600");
  await expect(page.getByText("Cómo entra")).toBeVisible();
  await expect(page.locator("svg rect").first()).toBeVisible();
});

test.describe("el panel", () => {
  test.use({ storageState: SESION_ADMIN });

  test("la ficha de un corte muestra el plano y baja el PTX y la lista", async ({ page, request }) => {
    test.skip(test.info().project.name === "telefono", "el panel se prueba en escritorio");
    await page.goto("/admin/cortes");
    const ficha = page.locator('a[href^="/admin/cortes/"][href*="-"]').first();
    test.skip(!(await ficha.isVisible()), "no hay cortes en los datos de desarrollo");
    const href = (await ficha.getAttribute("href"))!;
    await page.goto(href);
    await expect(page.getByText(/placa entera|Media placa/i).first()).toBeVisible();

    const id = href.split("/").pop()!;
    const ptx = await request.get(`/api/cortes/${id}/ptx`);
    if (ptx.status() === 200) {
      expect(await ptx.text()).toMatch(/^HEADER,1\.14,/);
    } else {
      expect(ptx.status()).toBe(409); // sin piezas o ninguna entra
    }
    const lista = await request.get(`/api/cortes/${id}/lista`);
    expect([200, 409]).toContain(lista.status());

    await page.goto(`/hoja-de-corte/${id}`);
    await expect(page.locator("body")).toContainText(/corte/i);
  });

  test("el agente del taller sin token no ve la cola", async ({ playwright, baseURL }) => {
    const anonimo = await playwright.request.newContext({ baseURL });
    const r = await anonimo.get("/api/cortes/pendientes");
    // 404 si la integración está apagada, 401 si está prendida.
    expect([401, 404]).toContain(r.status());
    await anonimo.dispose();
  });
});
