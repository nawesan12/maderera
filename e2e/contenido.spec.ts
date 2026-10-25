import { expect, test, type Page } from "@playwright/test";

/*
 * El contenido del sitio, de punta a punta: el admin carga un banner con
 * imagen en el panel, la API de Go lo guarda (backend/internal/contenido) y
 * la portada lo muestra; al borrarlo, desaparece.
 */
const correo = process.env.E2E_CORREO ?? "admin@mjbj.com.ar";
const clave = process.env.E2E_CLAVE ?? "Admin1234";

// Un PNG de 1×1.
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

async function entrarComoAdmin(page: Page) {
  await page.goto("/ingresar");
  await page.getByLabel("Correo electrónico").fill(correo);
  await page.getByLabel("Contraseña").fill(clave);
  await page.getByRole("button", { name: "Ingresar" }).click();
  await expect(page).toHaveURL(/\/admin/);
}

test("un banner cargado en el panel sale en la portada, y al borrarlo se va", async ({ page }) => {
  test.skip(test.info().project.name === "telefono", "el panel se prueba en escritorio");
  const titulo = `Prueba de banner ${Date.now()}`;
  await entrarComoAdmin(page);
  await page.goto("/admin/contenido/banners");

  const nuevo = page.locator("form").filter({ has: page.getByRole("button", { name: "Crear banner" }) }).first();
  await nuevo.locator("select[name=ubicacion]").selectOption("portada");
  await nuevo.locator("input[name=titulo]").fill(titulo);
  await nuevo.locator("input[name=imagen]").setInputFiles({ name: "banner.png", mimeType: "image/png", buffer: png });
  const activo = nuevo.locator("input[name=activo]");
  if (!(await activo.isChecked())) await activo.check();
  await nuevo.getByRole("button", { name: "Crear banner" }).click();
  await expect(nuevo.getByText("Banner guardado.")).toBeVisible();

  await page.goto("/");
  await expect(page.getByText(titulo)).toBeVisible();
  const imagen = page.locator("img[src*='/subidas/banner-'], img[srcset*='banner-']").first();
  await expect(imagen).toBeAttached();

  await page.goto("/admin/contenido/banners");
  const suyo = page.locator("form").filter({ has: page.locator(`input[name=titulo][value="${titulo}"]`) });
  await suyo.getByRole("button", { name: "Borrar" }).click();
  await expect(suyo.getByText("Banner borrado.")).toBeVisible();

  await page.goto("/");
  await expect(page.getByText(titulo)).toHaveCount(0);
});
