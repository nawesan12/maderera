import { expect, request as nuevoRequest, test, type APIRequestContext } from "@playwright/test";
import { SESION_ADMIN } from "./sesion-guardada";

/*
 * El carrito, la compra y el cobro de punta a punta, como un visitante sin
 * cuenta: agregar al carrito (Go pone la cookie), confirmar, pagar con el
 * proveedor de demostración y volver al seguimiento con el pago acreditado
 * una sola vez. Y el webhook de Mercado Pago en su dirección de siempre,
 * repetido: contesta 200 rápido y no deja nada sin firma.
 *
 * Lo hace la API de Go (backend/internal/checkout y pagos). No deja datos
 * colgados: el pedido de prueba se cancela (libera la reserva) al final.
 * Supone el entorno de desarrollo sin MP_ACCESS_TOKEN (cobros de
 * demostración), que es como corre hoy.
 */

test.use({ storageState: { cookies: [], origins: [] } });

test.beforeEach(() => {
  test.skip(test.info().project.name === "telefono", "un flujo de compra alcanza en escritorio");
});

async function admin(baseURL: string | undefined): Promise<APIRequestContext> {
  return nuevoRequest.newContext({ baseURL, storageState: SESION_ADMIN });
}

/** Un producto con precio y su primera variante con precio. */
async function algoParaComprar(req: APIRequestContext) {
  const productos = (await (await req.get("/api/v1/catalogo/productos")).json()) as {
    slug: string;
    precioDesde: string | null;
    aPedido: boolean;
    unit: string;
  }[];
  for (const p of productos.filter((x) => x.precioDesde && !x.aPedido && x.unit !== "placa")) {
    const ficha = (await (await req.get(`/api/v1/catalogo/productos/${p.slug}`)).json()) as {
      name: string;
      variantes: { id: string; precio: string | null }[];
    };
    const v = ficha.variantes.find((x) => x.precio && Number(x.precio) > 0);
    if (v) return { variantId: v.id, descripcion: ficha.name };
  }
  throw new Error("no hay ningún producto con precio en el catálogo de desarrollo");
}

test("carrito → confirmar → pago de demostración, acreditado una sola vez", async ({ page, baseURL }) => {
  const panel = await admin(baseURL);
  const estado = (await (await page.request.get("/api/v1/pagos/estado")).json()) as { enVivo: boolean };
  test.skip(estado.enVivo, "con Mercado Pago de verdad no se simula");

  // Agregar: la primera vez Go crea el carrito y pone la cookie.
  const item = await algoParaComprar(page.request);
  const agregado = await page.request.post("/api/v1/carrito/items", { data: { ...item, cantidad: 2 } });
  expect(agregado.ok()).toBeTruthy();
  expect((await agregado.json()).ok).toContain("va al presupuesto");
  const cookies = await page.context().cookies();
  expect(cookies.some((c) => c.name === "mjbj_carrito" && c.httpOnly)).toBeTruthy();

  await page.goto("/carrito");
  await expect(page.getByText(item.descripcion).first()).toBeVisible();

  // Confirmar: retiro en la primera sucursal, por transferencia.
  const sucursales = (await (await page.request.get("/api/v1/contenido/sucursales")).json()) as { id: string }[];
  const confirmada = await page.request.post("/api/v1/carrito/confirmar", {
    data: {
      nombre: "Prueba de punta a punta",
      email: "e2e-checkout@prueba.test",
      telefono: "2235550000",
      entrega: "retiro",
      sucursalId: sucursales[0].id,
      medioPago: "mercado_pago",
    },
  });
  expect(confirmada.ok(), await confirmada.text()).toBeTruthy();
  const { pedidoId, numero, token } = (await confirmada.json()) as { pedidoId: string; numero: string; token: string };

  try {
    // El carrito quedó cerrado: confirmar otra vez no hace otro pedido.
    const otra = await page.request.post("/api/v1/carrito/confirmar", {
      data: { nombre: "Prueba", email: "e2e-checkout@prueba.test", telefono: "2235550000", entrega: "retiro", sucursalId: sucursales[0].id, medioPago: "mercado_pago" },
    });
    expect(otra.status()).toBe(422);

    // Pagar desde el seguimiento: el proveedor de demostración.
    await page.goto(`/pedido/${numero}?t=${token}`);
    await page.getByRole("button", { name: /^Pagar / }).click();
    await page.waitForURL(/\/pago-demo\/[0-9a-f-]{36}$/);
    const pagoId = page.url().split("/").pop()!;
    await page.getByRole("button", { name: "Simular pago aprobado" }).click();

    // Vuelve al seguimiento con el token sano (el TS lo rompía con dos «?»).
    await page.waitForURL(new RegExp(`/pedido/${numero}\\?t=${token}&pago=aprobado$`));
    await expect(page.getByText(/^Recibimos /).first()).toBeVisible();

    // Aprobar otra vez no acredita dos veces: el cobro sigue aprobado y la
    // pantalla de demostración dice que ya está cerrado.
    const repetido = await page.request.post(`/api/v1/pagos/demo/${pagoId}`, { data: { decision: "aprobar" } });
    expect(repetido.ok()).toBeTruthy();
    const cobro = (await (await page.request.get(`/api/v1/pagos/demo/${pagoId}`)).json()) as { estado: string };
    expect(cobro.estado).toBe("aprobado");
    await page.goto(`/pago-demo/${pagoId}`);
    await expect(page.getByText("Este cobro ya está aprobado")).toBeVisible();

    // En la conciliación aparece una sola vez, acreditado.
    const conciliacion = (await (await panel.get("/api/v1/admin/pagos?periodo=mes")).json()) as {
      pagos: { id: string; estado: string; numeroPedido: string | null }[];
    };
    const delPedido = conciliacion.pagos.filter((p) => p.numeroPedido === numero);
    expect(delPedido).toHaveLength(1);
    expect(delPedido[0].estado).toBe("aprobado");
  } finally {
    // Sin datos colgados: el pedido se cancela y la reserva se libera.
    await panel.post(`/api/v1/admin/pedidos/${pedidoId}/cancelar`, { data: { motivo: "Prueba de punta a punta" } });
    await panel.dispose();
  }
});

test("el webhook de Mercado Pago: 200 rápido, repetido y sin firma no deja nada", async ({ baseURL }) => {
  const panel = await admin(baseURL);
  const antes = (await (await panel.get("/api/v1/admin/pagos")).json()) as { avisos: { id: string }[] };
  const anon = await nuevoRequest.newContext({ baseURL });
  const cuerpo = {
    action: "payment.updated",
    api_version: "v1",
    data: { id: "1234567890" },
    date_created: new Date().toISOString(),
    id: 987654321,
    live_mode: false,
    type: "payment",
    user_id: "202809963",
  };
  for (let i = 0; i < 5; i++) {
    const r = await anon.post("/api/pagos/webhook?data.id=1234567890&type=payment", {
      data: cuerpo,
      headers: {
        "x-signature": `ts=${Math.floor(Date.now() / 1000)},v1=${"0".repeat(64)}`,
        "x-request-id": "e2e-checkout",
      },
    });
    expect(r.status()).toBe(200);
    expect(await r.json()).toEqual({ ok: true });
  }
  // Un cuerpo que no se entiende también es 200: un 500 lo haría reintentar.
  const roto = await anon.post("/api/pagos/webhook", { data: "esto no es json", headers: { "content-type": "application/json" } });
  expect(roto.status()).toBe(200);

  // La firma mala se descarta sin escribir en payment_events (lo procesa el
  // worker de Go: se le da un momento).
  await new Promise((r) => setTimeout(r, 1500));
  const despues = (await (await panel.get("/api/v1/admin/pagos")).json()) as { avisos: { id: string }[] };
  expect(despues.avisos.map((a) => a.id)).toEqual(antes.avisos.map((a) => a.id));
  await anon.dispose();
  await panel.dispose();
});
