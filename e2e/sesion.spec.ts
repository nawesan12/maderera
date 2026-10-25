import { expect, test } from "@playwright/test";

/*
 * La sesión, de punta a punta: la valida Go (backend/internal/auth) y Next la
 * usa para armar el panel.
 */
const correo = process.env.E2E_CORREO ?? "admin@mjbj.com.ar";
const clave = process.env.E2E_CLAVE ?? "Admin1234";

async function entrar(page: import("@playwright/test").Page, conClave = clave) {
  await page.getByLabel("Correo electrónico").fill(correo);
  await page.getByLabel("Contraseña").fill(conClave);
  await page.getByRole("button", { name: "Ingresar" }).click();
}

test("con la clave equivocada no entra y lo dice", async ({ page }) => {
  await page.goto("/ingresar");
  await entrar(page, "no-es-esta");
  await expect(page.getByText("El correo o la contraseña no coinciden.")).toBeVisible();
  await expect(page).toHaveURL(/\/ingresar/);
});

test("entra al panel, la sesión sobrevive a recargar, y sale", async ({ page, context }) => {
  await page.goto("/ingresar");
  await entrar(page);
  await expect(page).toHaveURL(/\/admin/);
  await expect(page.getByText("Para hoy")).toBeVisible();

  // La cookie es la de Go, firmada como la firmaba better-auth.
  const cookie = (await context.cookies()).find((c) => c.name.endsWith("better-auth.session_token"));
  expect(cookie?.httpOnly).toBe(true);
  expect(decodeURIComponent(cookie!.value)).toMatch(/^[A-Za-z0-9]{32}\.[A-Za-z0-9+/]{43}=$/);

  await page.reload();
  await expect(page.getByText("Para hoy")).toBeVisible();

  // Salir por la API (el menú cambia entre escritorio y teléfono): después
  // el panel manda a entrar.
  const salida = await page.request.delete("/api/v1/sesion");
  expect(salida.status()).toBe(204);
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/ingresar/);
});

test("sin sesión, el panel manda a entrar y vuelve después", async ({ page }) => {
  await page.goto("/admin/pedidos");
  await expect(page).toHaveURL(/\/ingresar\?volver=%2Fadmin%2Fpedidos/);
  await entrar(page);
  await expect(page).toHaveURL(/\/admin\/pedidos/);
});
