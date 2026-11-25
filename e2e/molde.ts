import { expect, type APIRequestContext, type Locator, type Page } from "@playwright/test";

/**
 * Los controles del molde de formularios del panel
 * (components/admin/formulario.tsx): el interruptor es un Switch de base-ui y
 * las fichas son radios ocultos dentro de una etiqueta. Se tocan como los toca
 * una persona —la tarjeta, la ficha—, no el input escondido.
 */
export async function interruptor(lugar: Page | Locator, etiqueta: string, prendido: boolean) {
  const sw = lugar.locator("label.ficha-interruptor", { hasText: etiqueta }).getByRole("switch");
  if ((await sw.getAttribute("aria-checked")) !== String(prendido)) await sw.click();
  await expect(sw).toHaveAttribute("aria-checked", String(prendido));
}

export async function ficha(lugar: Page | Locator, texto: string) {
  await lugar.locator("label.ficha-opcion", { hasText: texto }).click();
}

/**
 * Si la tienda está encendida (migración 00093). Apagada, el sitio no
 * muestra precios ni vende: las pruebas que compran o miran precios prueban
 * eso en vez de fallar.
 */
export async function tiendaEncendida(request: APIRequestContext): Promise<boolean> {
  const ajustes = await (await request.get("/api/v1/contenido/ajustes")).json();
  return ajustes.tienda_activa !== "no";
}
