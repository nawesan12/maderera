import { expect, test } from "@playwright/test";

/*
 * Lo que queda del sitio público después de la tanda 2: contacto, eventos,
 * documentación y sitemap, todo servido por la API de Go
 * (backend/internal/contenido/sitio.go).
 */

test("la consulta de contacto dice la verdad sobre si salió", async ({ page }) => {
  await page.goto("/contacto");
  await page.locator("select[name=motivo]").selectOption("stock");
  await page.locator("input[name=nombre]").fill("Prueba de punta a punta");
  await page.locator("input[name=email]").fill(`e2e-${Date.now()}@prueba.test`);
  await page.locator("textarea[name=mensaje]").fill("¿Tienen fenólico de 18 mm en stock?");
  await page.getByRole("button", { name: "Enviar consulta" }).click();
  // En desarrollo el correo es de demostración: tiene que ofrecer WhatsApp,
  // nunca decir que llegó. Con un proveedor real, el «Recibimos».
  await expect(page.getByText(/Todavía no tenemos conectado el envío de correo|Recibimos tu consulta/)).toBeVisible();
});

test("un correo mal escrito se marca sin gastar intentos", async ({ page }) => {
  await page.goto("/contacto");
  await page.locator("input[name=nombre]").fill("Prueba");
  await page.locator("input[name=email]").fill("prueba@sin-dominio");
  await page.locator("textarea[name=mensaje]").fill("Un mensaje de prueba largo");
  // El navegador valida type=email; se saca para ver el mensaje de la API.
  await page.locator("input[name=email]").evaluate((el) => el.setAttribute("type", "text"));
  await page.getByRole("button", { name: "Enviar consulta" }).click();
  await expect(page.getByText("Revisá el correo: es por donde te contestamos.")).toBeVisible();
});

test("eventos y documentación cargan", async ({ page }) => {
  for (const ruta of ["/eventos", "/documentacion"]) {
    const r = await page.goto(ruta);
    expect(r?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByText("Esta pantalla no cargó")).toHaveCount(0);
  }
  expect((await page.goto("/eventos/no-existe-este-evento"))?.status()).toBe(404);
});

test("el sitemap lista fichas y categorías", async ({ request }) => {
  const r = await request.get("/sitemap.xml");
  expect(r.status()).toBe(200);
  const xml = await r.text();
  expect(xml).toMatch(/\/catalogo\/[a-z0-9-]+<\/loc>/);
  expect(xml).toContain("/catalogo?cat=");
});

test("la lista de precios en PDF exige sesión y sale con la sesión", async ({ page, request }) => {
  test.skip(test.info().project.name === "telefono", "no depende del dispositivo");
  expect((await request.get("/mi-lista-de-precios")).status()).toBe(401);
  await page.goto("/ingresar");
  await page.getByLabel("Correo electrónico").fill(process.env.E2E_CORREO ?? "admin@mjbj.com.ar");
  await page.getByLabel("Contraseña").fill(process.env.E2E_CLAVE ?? "Admin1234");
  await page.getByRole("button", { name: "Ingresar" }).click();
  await expect(page).toHaveURL(/\/admin/);
  const r = await page.request.get("/mi-lista-de-precios");
  expect(r.status()).toBe(200);
  expect(r.headers()["content-type"]).toBe("application/pdf");
  expect((await r.body()).subarray(0, 5).toString()).toBe("%PDF-");
});

test("las sucursales salen con su ficha", async ({ page }) => {
  await page.goto("/sucursales");
  await expect(page.getByText("Juan B. Justo 4153").first()).toBeVisible();
  await expect(page.getByText("Canosa 61").first()).toBeVisible();
});
