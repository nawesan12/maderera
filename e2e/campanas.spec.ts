import { expect, test } from "@playwright/test";
import { SESION_ADMIN } from "./sesion-guardada";

/*
 * Campañas, bajas, avisos, profesionales y eventos (tanda 10), de punta a
 * punta: las pantallas del panel cargan de la API de Go
 * (backend/internal/campanas, avisos y profesionales), las validaciones
 * dicen lo mismo que decía zod, y la baja de los correos sigue en su
 * dirección de siempre (/api/baja, ahora de Go). No deja datos nuevos: los
 * formularios se mandan con un error a propósito.
 */

test.use({ storageState: SESION_ADMIN });

test.describe("panel", () => {
  test.beforeEach(() => {
    test.skip(test.info().project.name === "telefono", "el panel se prueba en escritorio");
  });

  test("campañas: la lista, y el editor rechaza un asunto corto", async ({ page }) => {
    await page.goto("/admin/campanas");
    await expect(page.getByRole("heading", { name: "Campañas", level: 1 })).toBeVisible();

    await page.goto("/admin/campanas/nueva");
    await expect(page.getByRole("heading", { name: "Nueva campaña", level: 1 })).toBeVisible();
    await page.locator('input[name="asunto"]').fill("ab");
    await page.locator('textarea[name="cuerpo"]').fill("Hola a todos los clientes de la maderera");
    await page.getByRole("button", { name: "Guardar" }).click();
    await expect(page.getByText("Falta el asunto.")).toBeVisible();
  });

  test("avisos: la configuración sembrada y la bitácora", async ({ page }) => {
    await page.goto("/admin/avisos");
    await expect(page.getByRole("heading", { name: "Avisos automáticos", level: 1 })).toBeVisible();
    // Los avisos de profesionales y eventos están sembrados (los siembra Go al listar).
    await expect(page.getByText("Cuando alguien pide acceso profesional")).toBeVisible();
    await expect(page.getByText("Cuando alguien se anota a un evento")).toBeVisible();
  });

  test("profesionales: el panel carga con su resumen", async ({ page }) => {
    await page.goto("/admin/profesionales");
    await expect(page.getByRole("heading", { name: "Profesionales", level: 1 })).toBeVisible();
    await expect(page.getByText("Esperando respuesta")).toBeVisible();
    await expect(page.getByText("Clientes profesionales")).toBeVisible();
  });

  test("eventos: el alta rechaza un título corto", async ({ page }) => {
    await page.goto("/admin/eventos");
    await expect(page.getByRole("heading", { name: "Eventos y capacitaciones", level: 1 })).toBeVisible();
    await page.getByRole("button", { name: "Nuevo evento" }).click();
    await page.locator("#titulo").fill("abc");
    await page.locator("#inicia").fill("2030-11-05T18:00");
    await page.getByRole("button", { name: "Crear" }).click();
    await expect(page.getByText("Poné un título.")).toBeVisible();
  });
});

test("la baja: un enlace trucho no da de baja a nadie", async ({ page, request }) => {
  await page.goto("/baja?e=YW5hQHg&t=firma-falsa");
  await expect(page.getByRole("heading", { name: "Este enlace no es válido" })).toBeVisible();

  // El botón «Anular suscripción» de Gmail (RFC 8058) es un POST a /api/baja.
  const post = await request.post("/api/baja?e=YW5hQHg&t=firma-falsa");
  expect(post.status()).toBe(400);
  expect(await post.text()).toBe("Enlace inválido.");

  // El GET (los antivirus que abren los enlaces) no da de baja: lleva a la página.
  const get = await request.get("/api/baja?e=YW5hQHg&t=x", { maxRedirects: 0 });
  expect(get.status()).toBe(303);
  expect(get.headers()["location"]).toBe("/baja?e=YW5hQHg&t=x");
});
