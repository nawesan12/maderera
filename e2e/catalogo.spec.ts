import { expect, test } from "@playwright/test";

/*
 * El catálogo público, de punta a punta: lo arma la API de Go
 * (backend/internal/catalogo) y Next lo muestra y lo guarda en su caché.
 */

test("la portada muestra productos y categorías", async ({ page }) => {
  const r = await page.goto("/");
  expect(r?.status()).toBe(200);
  await expect(page.locator("a[href^='/catalogo/']").first()).toBeVisible();
});

test("buscar con y sin tilde encuentra lo mismo", async ({ page }) => {
  await page.goto("/catalogo?buscar=fenólico");
  const conTilde = await page.locator("a[href='/catalogo/fenolico']").count();
  await page.goto("/catalogo?buscar=FENOLICO");
  const sinTilde = await page.locator("a[href='/catalogo/fenolico']").count();
  expect(conTilde).toBeGreaterThan(0);
  expect(sinTilde).toBe(conTilde);
});

test("una búsqueda sin resultados lo dice", async ({ page }) => {
  await page.goto("/catalogo?buscar=noexistexyz");
  await expect(page.locator("a[href^='/catalogo/'][href*='-']")).toHaveCount(0);
});

test("la ficha abre con su precio, y un slug que no existe da 404", async ({ page }) => {
  const r = await page.goto("/catalogo/fenolico");
  expect(r?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Fenólico");
  await expect(page.getByText(/\$\s?\d/).first()).toBeVisible();
  const nada = await page.goto("/catalogo/no-existe-este-producto");
  expect(nada?.status()).toBe(404);
});

test("la API no deja ver el precio de otra lista sin sesión", async ({ request }) => {
  // Sin cookie, con o sin publico=true, la lista es la general.
  const sin = await (await request.get("/api/v1/catalogo/lista")).json();
  expect(sin.lista.esDiferenciada).toBe(false);
  expect(sin.vista).toBe("final");
  const precios = await (await request.get("/api/v1/catalogo/precios-por-variante")).json();
  expect(precios).toEqual({});
});

test("desde afuera no se pueden pedir los precios de una lista", async ({ request }) => {
  const r = await request.get("/api/v1/catalogo/productos?lista=00000000-0000-0000-0000-000000000001");
  expect(r.status()).toBe(403);
});
