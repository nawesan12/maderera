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

test("una reseña del negocio cargada a mano sale en la portada, y al borrarla se va", async ({ page }) => {
  test.skip(test.info().project.name === "telefono", "el panel se prueba en escritorio");
  const autor = `Prueba ${Date.now()}`;
  await entrarComoAdmin(page);
  await page.goto("/admin/contenido/resenas-negocio");

  await page.locator("input[name=autor]").fill(autor);
  await page.locator("textarea[name=texto]").fill("Muy buena atención y la madera llegó a tiempo.");
  await page.locator("input[name=publicada]").check();
  await page.getByRole("button", { name: "Guardar", exact: true }).click();
  await expect(page.getByText("Publicada.").first()).toBeVisible();

  await page.goto("/");
  await expect(page.getByText(autor)).toBeVisible();

  await page.goto("/admin/contenido/resenas-negocio");
  await page.getByRole("button", { name: `Borrar la reseña de ${autor}` }).click();
  await expect(page.getByRole("button", { name: `Borrar la reseña de ${autor}` })).toHaveCount(0);
  await page.goto("/");
  await expect(page.getByText(autor)).toHaveCount(0);
});

test("un documento publicado sale en /documentacion, y dado de baja se va", async ({ page }) => {
  test.skip(test.info().project.name === "telefono", "el panel se prueba en escritorio");
  const titulo = `Prueba de documento ${Date.now()}`;
  await entrarComoAdmin(page);
  await page.goto("/admin/documentacion");
  const subir = page.locator("form").filter({ has: page.locator("input[name=archivo]") });
  await subir.locator("input[name=titulo]").fill(titulo);
  await subir.locator("input[name=archivo]").setInputFiles({
    name: "ficha.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\n%%EOF\n"),
  });
  const reservado = subir.locator("input[name=soloProfesionales]");
  if (await reservado.isChecked()) await reservado.uncheck();
  await subir.getByRole("button", { name: "Publicar", exact: true }).click();
  await expect(page.getByText("Documento publicado.")).toBeVisible();

  await page.goto("/documentacion");
  await expect(page.getByText(titulo)).toBeVisible();

  await page.goto("/admin/documentacion");
  const fila = page
    .locator("li, tr, article, div")
    .filter({ hasText: titulo })
    .filter({ has: page.getByRole("button", { name: "Dar de baja" }) })
    .last();
  await fila.getByRole("button", { name: "Dar de baja" }).click();
  await page.getByRole("button", { name: "Sí, darlo de baja" }).click();

  // La pantalla no confirma la baja con un texto; se ve en el sitio.
  await expect
    .poll(async () => (await page.request.get("/documentacion").then((r) => r.text())).includes(titulo), {
      timeout: 15_000,
    })
    .toBe(false);
});
