import { expect, test } from "@playwright/test";
import { ficha, interruptor } from "./molde";
import { SESION_ADMIN } from "./sesion-guardada";

/*
 * El contenido del sitio, de punta a punta: el admin carga un banner con
 * imagen en el panel, la API de Go lo guarda (backend/internal/contenido) y
 * la portada lo muestra; al borrarlo, desaparece.
 */

// Un PNG de 1×1.
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);


// El panel, con la sesión del admin que guardó autenticar.setup.ts.
test.use({ storageState: SESION_ADMIN });

test("un banner cargado en el panel sale en la portada, y al borrarlo se va", async ({ page }) => {
  test.skip(test.info().project.name === "telefono", "el panel se prueba en escritorio");
  const titulo = `Prueba de banner ${Date.now()}`;
  await page.goto("/admin/contenido/banners");

  const nuevo = page.locator("form").filter({ has: page.getByRole("button", { name: "Crear banner" }) }).first();
  await ficha(nuevo, "Portada, debajo del inicio");
  await nuevo.locator("input[name=titulo]").fill(titulo);
  await nuevo.locator("input[name=imagen]").setInputFiles({ name: "banner.png", mimeType: "image/png", buffer: png });
  await interruptor(nuevo, "Encendido", true);
  await nuevo.getByRole("button", { name: "Crear banner" }).click();
  await expect(nuevo.getByText("Banner guardado.")).toBeVisible();

  // La primera visita después de guardar todavía puede recibir la portada en
  // caché (y dispara la regeneración); puede quedar en una diapositiva que no
  // es la primera. Se espera a que esté en el HTML.
  await expect.poll(async () => (await page.request.get("/").then((r) => r.text())).includes(titulo), { timeout: 20_000 }).toBe(true);
  await page.goto("/");
  const imagen = page.locator("img[src*='/subidas/banner-'], img[srcset*='banner-']").first();
  await expect(imagen).toBeAttached();

  await page.goto("/admin/contenido/banners");
  const suyo = page.locator("form").filter({ has: page.locator(`input[name=titulo][value="${titulo}"]`) });
  await suyo.getByRole("button", { name: "Borrar" }).click();
  await expect(suyo.getByText("Banner borrado.")).toBeVisible();

  await expect.poll(async () => (await page.request.get("/").then((r) => r.text())).includes(titulo), { timeout: 20_000 }).toBe(false);
});

test("una reseña del negocio cargada a mano sale en la portada, y al borrarla se va", async ({ page }) => {
  test.skip(test.info().project.name === "telefono", "el panel se prueba en escritorio");
  const autor = `Prueba ${Date.now()}`;
  await page.goto("/admin/contenido/resenas-negocio");

  await page.locator("input[name=autor]").fill(autor);
  await page.locator("textarea[name=texto]").fill("Muy buena atención y la madera llegó a tiempo.");
  await interruptor(page, "Mostrarla en el sitio", true);
  await page.getByRole("button", { name: "Guardar", exact: true }).click();
  await expect(page.getByText("Publicada.").first()).toBeVisible();

  // Ver la nota del banner: la portada puede tardar una visita en rehacerse.
  await expect.poll(async () => (await page.request.get("/").then((r) => r.text())).includes(autor), { timeout: 20_000 }).toBe(true);

  await page.goto("/admin/contenido/resenas-negocio");
  await page.getByRole("button", { name: `Borrar la reseña de ${autor}` }).click();
  await expect(page.getByRole("button", { name: `Borrar la reseña de ${autor}` })).toHaveCount(0);
  await expect.poll(async () => (await page.request.get("/").then((r) => r.text())).includes(autor), { timeout: 20_000 }).toBe(false);
});

test("un documento publicado sale en /documentacion, y dado de baja se va", async ({ page }) => {
  test.skip(test.info().project.name === "telefono", "el panel se prueba en escritorio");
  const titulo = `Prueba de documento ${Date.now()}`;
  await page.goto("/admin/documentacion");
  const subir = page.locator("form").filter({ has: page.locator("input[name=archivo]") });
  await subir.locator("input[name=titulo]").fill(titulo);
  await subir.locator("input[name=archivo]").setInputFiles({
    name: "ficha.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\n%%EOF\n"),
  });
  await interruptor(subir, "Solo lo ven los profesionales aprobados", false);
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
