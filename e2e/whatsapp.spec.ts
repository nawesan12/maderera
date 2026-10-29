import { expect, test } from "@playwright/test";
import { SESION_ADMIN } from "./sesion-guardada";

/*
 * La bandeja de WhatsApp, de punta a punta en modo demostración (la sirve la
 * API de Go, backend/internal/whatsapp): se abre una conversación con un
 * número nuevo, el cliente «escribe» desde el simulador del panel —entra por
 * la misma ingesta que el webhook de Meta— y se le contesta dentro de la
 * ventana de 24 h. Al final se marca resuelta, para dejar la bandeja como
 * estaba.
 *
 * Necesita el modo demostración (sin WHATSAPP_PHONE_NUMBER_ID en la API): con
 * la Cloud API conectada, el simulador del panel no existe.
 */

test.use({ storageState: SESION_ADMIN });

test("una ida y vuelta con el simulador de la bandeja", async ({ page }) => {
  test.skip(test.info().project.name === "telefono", "el panel se prueba en escritorio");
  await page.goto("/admin/whatsapp");
  const simulador = page.getByLabel("Simular un mensaje del cliente");

  // Un número que cambia en cada corrida: la conversación nace nueva.
  const abonado = String(Date.now()).slice(-7);
  await page.getByRole("button", { name: "Escribirle a un número nuevo" }).click();
  await page.getByPlaceholder("223 590-3118").fill(`223 ${abonado}`);
  await page.getByRole("button", { name: "Abrir" }).click();
  await expect(page).toHaveURL(/chat=/);

  // Nunca escribió: no hay ventana.
  await expect(simulador).toBeVisible();
  const mensaje = `Hola, ¿tienen fenólico? (${abonado})`;
  await simulador.fill(mensaje);
  await page.getByRole("button", { name: "Simular" }).click();
  await expect(page.getByText(mensaje).first()).toBeVisible();

  // Con la ventana abierta, se contesta con texto libre.
  const respuesta = `Sí, hay de 18 mm (${abonado}).`;
  await page.getByLabel("Respuesta").fill(respuesta);
  await page.getByLabel("Respuesta").press("Enter");
  await expect(page.getByText(respuesta).first()).toBeVisible();

  // La deja resuelta: la bandeja queda como estaba.
  await page.getByRole("button", { name: "Resuelta", exact: true }).click();
  await expect(page.getByRole("button", { name: "Reabrir", exact: true })).toBeVisible();
});
