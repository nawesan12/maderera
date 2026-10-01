import { after, NextResponse, type NextRequest } from "next/server";
import { configMercadoPago } from "@/lib/pagos/config";
import { firmaValida, leerCabeceraFirma } from "@/lib/pagos/firma";
import { encolar, procesarCola } from "@/lib/cola";

/**
 * Webhook de cobros.
 *
 * Mercado Pago avisa acá cuando un pago cambia de estado. Dos reglas que vienen
 * de cómo reintenta:
 *
 * 1. **Contestar 200 rápido.** Si tarda, reintenta; y el reintento llega como
 *    un aviso más. El aviso se guarda en la cola (`lib/cola`) y el trabajo
 *    real corre en `after()`, con la respuesta ya mandada; la idempotencia
 *    vive en `procesarAviso`.
 * 2. **Contestar 200 también ante un cuerpo que no entendemos.** Un 500 lo hace
 *    reintentar durante horas algo que nunca va a funcionar.
 *
 * Alta en el panel de Mercado Pago: URL `https://<dominio>/api/pagos/webhook`,
 * evento "Pagos", y la clave secreta que genera ahí va a `MP_WEBHOOK_SECRET`.
 */
export async function POST(request: NextRequest) {
  const url = new URL(request.url);
  const crudo = await request.text();

  let cuerpo: unknown = {};
  try {
    cuerpo = crudo ? JSON.parse(crudo) : {};
  } catch {
    return NextResponse.json({ ok: true });
  }

  const config = configMercadoPago();
  const cabecera = leerCabeceraFirma(request.headers.get("x-signature"));

  // `data.id` de la query es lo que Mercado Pago firma, no el del cuerpo.
  const dataId =
    url.searchParams.get("data.id") ??
    (typeof (cuerpo as { data?: { id?: unknown } })?.data?.id !== "undefined"
      ? String((cuerpo as { data: { id: unknown } }).data.id)
      : null);

  const verificada = cabecera
    ? firmaValida(
        {
          dataId: dataId ? dataId.toLowerCase() : null,
          requestId: request.headers.get("x-request-id"),
          ts: cabecera.ts,
          v1: cabecera.v1,
        },
        config?.webhookSecret,
      )
    : false;

  /*
   * Se guarda en la cola antes de contestar, y recién ahí se procesa. Si el
   * proceso se reinicia en ese segundo —un despliegue—, el aviso no se pierde:
   * la tarea de cada minuto lo retoma. Con la base caída tampoco: el `encolar`
   * tira, se contesta 500 y Mercado Pago reintenta, que es lo que corresponde.
   */
  const id = await encolar("pago.aviso", {
    proveedor: "mercado_pago",
    cuerpo,
    url: url.toString(),
    firmaVerificada: verificada,
  });

  after(() => procesarCola({ soloId: id }));

  return NextResponse.json({ ok: true });
}
