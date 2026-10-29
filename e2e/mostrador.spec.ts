import { randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { SESION_ADMIN } from "./sesion-guardada";

/*
 * El mostrador, de punta a punta, sobre la API de Go (backend/internal/
 * mostrador):
 *
 * - una venta en línea desde la pantalla (una línea cargada a mano, por
 *   transferencia: no necesita caja ni toca stock) y su anulación;
 * - una venta hecha sin conexión que la cola sube dos veces por la ruta de
 *   siempre (POST /api/mostrador/ventas): queda una sola, con el mismo
 *   número, y se anula al final.
 *
 * No deja datos colgados: las dos ventas terminan anuladas.
 */

test.use({ storageState: SESION_ADMIN });

test.beforeEach(() => {
  test.skip(test.info().project.name === "telefono", "el mostrador se prueba en escritorio");
});

async function primeraSucursal(request: APIRequestContext): Promise<string> {
  const r = await request.get("/api/v1/contenido/sucursales");
  expect(r.ok()).toBeTruthy();
  const sucursales = (await r.json()) as { id: string }[];
  expect(sucursales.length, "hay al menos una sucursal").toBeGreaterThan(0);
  return sucursales[0]!.id;
}

async function anular(request: APIRequestContext, orderId: string) {
  const r = await request.post(`/api/v1/mostrador/ventas/${orderId}/anular`, {
    data: { motivo: "Prueba de punta a punta" },
  });
  expect(r.status()).toBe(200);
}

test("una venta en línea desde la pantalla, y su anulación", async ({ page }) => {
  await page.goto("/mostrador");
  const buscador = page.getByPlaceholder("Buscá por nombre, medida o código…");
  await expect(buscador).toBeVisible();

  // Algo que no está en el catálogo: Enter abre la carga a mano.
  const descripcion = `Prueba e2e ${Date.now()}`;
  await buscador.fill(descripcion);
  await expect(page.getByText(`No hay nada en el catálogo con «${descripcion}».`)).toBeVisible();
  await buscador.press("Enter");
  await expect(page.getByRole("heading", { name: "Cargar a mano" })).toBeVisible();
  await page.getByLabel("Precio por unidad").fill("1234.5");
  await page.getByRole("button", { name: /Agregar a la venta/ }).click();

  await page.getByRole("button", { name: "Transferencia", exact: true }).click();
  await page.getByRole("button", { name: /^Cobrar\s*Ctrl/ }).click();

  const aviso = page.getByText(/^Venta PED-\d+ registrada\.$/);
  await expect(aviso).toBeVisible();
  const numero = (await aviso.textContent())!.match(/PED-\d+/)![0];

  // Anularla desde la lista de ventas de hoy.
  await page.getByRole("button", { name: `Anular ${numero}` }).click();
  await page.getByPlaceholder("Se cargó la medida equivocada").fill("Prueba de punta a punta");
  await page.getByRole("button", { name: "Anular la venta" }).click();
  await expect(page.getByText(/^Venta anulada\./)).toBeVisible();
});

test("una venta sin conexión subida dos veces queda una sola", async ({ page }) => {
  const request = page.request;
  const branchId = await primeraSucursal(request);
  const venta = {
    clave: randomUUID(),
    branchId,
    lineas: [{ variantId: null, descripcion: "Prueba e2e sin conexión", unidad: "unidad", cantidad: 1, precioUnitario: 500 }],
    customerId: null,
    contactoNombre: "Consumidor final",
    medioPago: "transferencia",
    numeroProvisorio: `E2E-${Date.now()}`,
    cobradaAt: new Date(Date.now() - 10 * 60_000).toISOString(),
  };

  const subir = async () => {
    const r = await request.post("/api/mostrador/ventas", { data: { ventas: [venta] } });
    expect(r.status()).toBe(200);
    expect(r.headers()["cache-control"]).toBe("private, no-store");
    const cuerpo = (await r.json()) as {
      resultados: { clave: string; estado: string; numero?: string; orderId?: string; nueva?: boolean }[];
      servidorAt: string;
    };
    expect(cuerpo.resultados).toHaveLength(1);
    expect(Number.isNaN(new Date(cuerpo.servidorAt).getTime())).toBe(false);
    return cuerpo.resultados[0]!;
  };

  const primera = await subir();
  expect(primera.estado).toBe("sincronizada");
  expect(primera.clave).toBe(venta.clave);
  expect(primera.nueva).toBe(true);
  expect(primera.numero).toMatch(/^PED-\d+$/);

  // La cola reintenta (se cortó la respuesta, por ejemplo): la misma venta.
  const segunda = await subir();
  expect(segunda.estado).toBe("sincronizada");
  expect(segunda.nueva).toBe(false);
  expect(segunda.orderId).toBe(primera.orderId);
  expect(segunda.numero).toBe(primera.numero);

  // Un cuerpo roto es definitivo (400), con el mensaje de zod.
  const roto = await request.post("/api/mostrador/ventas", { data: { ventas: [] } });
  expect(roto.status()).toBe(400);
  expect(await roto.json()).toEqual({ error: "cuerpo", detalle: "Too small: expected array to have >=1 items" });

  // Las rutas de la copia local, de Go con su forma de siempre.
  const latido = await request.post("/api/mostrador/latido", { data: { branchId } });
  expect(latido.status()).toBe(200);
  expect(Object.keys(await latido.json()).sort()).toEqual(["servidorAt", "sesion", "turno"]);
  const copia = await request.get("/api/mostrador/catalogo");
  expect(Object.keys(await copia.json()).sort()).toEqual(["bajas", "generadoAt", "listas", "precios", "stock", "variantes"]);

  await anular(request, primera.orderId!);
});
