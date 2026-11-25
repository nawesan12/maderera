import { NextResponse } from "next/server";
import { api } from "@/lib/api/servidor";
import { avisarPedidoNuevo } from "@/lib/dal/existencia";
import { staffOrNull } from "@/lib/dal/session";
import { emitirParaLaVenta } from "@/lib/mostrador/comprobante";
import type { LineaDeVenta } from "@/lib/mostrador/importes";
import { SIN_CACHE } from "../guardia";

/**
 * El drenaje de la cola: las ventas que se hicieron sin conexión.
 *
 * **La dirección, el pedido, la respuesta y la autenticación no cambian**: hay
 * PC con un `sw.js` y colas cargadas que hablan así. La descarga la hace Go
 * (backend/internal/mostrador, `POST /api/v1/mostrador/descarga`): valida el
 * cuerpo con el esquema de siempre (400 `{error: "cuerpo", detalle}`),
 * registra cada venta en orden —idempotente por su clave, con el candado de
 * siempre— y clasifica cada una en `sincronizada`, `rechazada` (una regla de
 * negocio: no se arregla insistiendo) o `reintentar` (algo transitorio).
 *
 * Queda acá el comprobante fiscal de las que lo piden, porque facturación
 * sigue en TypeScript (tanda 7): Go devuelve, para cada venta nueva con
 * comprobante, lo que hace falta para emitirlo —con las líneas ya rebajadas,
 * que el TS de antes no mandaba—.
 */

export type ResultadoPorVenta =
  | {
      clave: string;
      estado: "sincronizada";
      numero: string;
      orderId: string;
      nueva: boolean;
      invoiceId?: string;
      avisoFiscal?: string;
    }
  | { clave: string; estado: "rechazada"; motivo: string }
  | { clave: string; estado: "reintentar"; motivo: string };

export async function POST(request: Request) {
  const usuario = await staffOrNull();

  if (!usuario) {
    return NextResponse.json({ error: "sesion" }, { status: 401, headers: SIN_CACHE });
  }

  const cuerpo = (await request.json().catch(() => null)) as unknown;
  const r = await (await api()).POST("/api/v1/mostrador/descarga", { body: { cuerpo } as never });

  if (r.response.status === 400 && r.error && "error" in (r.error as object)) {
    return NextResponse.json(r.error, { status: 400, headers: SIN_CACHE });
  }
  if (!r.data) {
    // La API no contestó lo esperado: que la cola reintente todo el lote.
    return NextResponse.json({ error: "servidor" }, { status: 503, headers: SIN_CACHE });
  }

  const resultados: ResultadoPorVenta[] = [];
  for (const res of r.data.resultados) {
    if (res.estado !== "sincronizada") {
      resultados.push({ clave: res.clave, estado: res.estado, motivo: res.motivo ?? "" });
      continue;
    }
    if (res.nueva) avisarPedidoNuevo(res.numero!);

    let invoiceId: string | undefined;
    let avisoFiscal: string | undefined;
    if (res.fiscal) {
      try {
        const fiscal = await emitirParaLaVenta({
          orderId: res.orderId!,
          customerId: res.fiscal.customerId,
          receptorNombre: res.fiscal.receptorNombre,
          cuit: res.fiscal.cuit,
          lineas: res.fiscal.lineas as LineaDeVenta[],
          usuarioId: usuario.userId,
        });
        invoiceId = fiscal.invoiceId;
        avisoFiscal = fiscal.aviso;
      } catch (error) {
        // Como antes: algo que explota es transitorio y la venta se reintenta
        // (ya está guardada; el reintento la devuelve como `nueva: false`).
        console.error(
          JSON.stringify({
            scope: "mostrador.drenaje",
            clave: res.clave,
            error: error instanceof Error ? error.message : String(error),
          }),
        );
        resultados.push({ clave: res.clave, estado: "reintentar", motivo: "No se pudo guardar en este momento." });
        continue;
      }
    }

    resultados.push({
      clave: res.clave,
      estado: "sincronizada",
      numero: res.numero!,
      orderId: res.orderId!,
      nueva: res.nueva ?? false,
      invoiceId,
      avisoFiscal,
    });
  }

  return NextResponse.json({ resultados, servidorAt: r.data.servidorAt }, { headers: SIN_CACHE });
}
