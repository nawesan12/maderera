import { NextResponse } from "next/server";
import { z } from "zod";
import { registrarVentaDeMostrador } from "@/lib/mostrador/venta";
import { emitirParaLaVenta } from "@/lib/mostrador/comprobante";
import { registrarEnBitacora } from "@/lib/dal/admin/auditoria";
import { staffOrNull } from "@/lib/dal/session";
import type { MedioDeMostrador } from "@/lib/mostrador/importes";
import { SIN_CACHE } from "../guardia";

/**
 * El drenaje de la cola: las ventas que se hicieron sin conexión.
 *
 * **La distinción entre `rechazada` y `reintentar` es el corazón de esto.** Un
 * fallo de validación o una regla de negocio no se arreglan insistiendo:
 * reintentarlos sería un bucle infinito contra el servidor. Un timeout de la
 * base sí se arregla solo, y descartarlo perdería una venta cobrada. Por eso el
 * endpoint clasifica en vez de devolver un error a secas.
 *
 * **No hay que preocuparse por los reintentos**: `registrarVentaDeMostrador` ya
 * es idempotente por `claveMostrador`, con índice único y lock. Mandar la misma
 * venta diez veces devuelve diez veces el mismo pedido, con `nueva: false`.
 */

const lineaSchema = z.object({
  variantId: z.string().uuid().nullable(),
  descripcion: z.string().min(1),
  unidad: z.string().default("unidad"),
  cantidad: z.number().positive(),
  precioUnitario: z.number().min(0),
});

const ventaSchema = z.object({
  clave: z.string().uuid(),
  branchId: z.string().uuid(),
  lineas: z.array(lineaSchema).min(1),
  customerId: z.string().uuid().nullable(),
  contactoNombre: z.string().min(1),
  contactoTelefono: z.string().nullable().optional(),
  medioPago: z.enum([
    "efectivo",
    "debito",
    "credito",
    "transferencia",
    "cuenta_corriente",
  ]),
  comprobante: z.enum(["interno", "fiscal"]).default("interno"),
  cuit: z.string().nullable().optional(),
  descuento: z.number().min(0).optional(),
  descuentoMotivo: z.string().nullable().optional(),
  notas: z.string().nullable().optional(),

  /* Lo propio de una venta diferida */
  numeroProvisorio: z.string().min(1).max(40),
  cobradaAt: z.string().datetime(),
  /** Quién vendió, del momento de la venta y no de quien está drenando. */
  usuarioId: z.string().optional(),
});

/** Tope por lote: más que esto hace la respuesta lenta sin ganar nada. */
const POR_LOTE = 25;

const cuerpoSchema = z.object({
  ventas: z.array(ventaSchema).min(1).max(POR_LOTE),
});

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
    return NextResponse.json(
      { error: "sesion" },
      { status: 401, headers: SIN_CACHE },
    );
  }

  const crudo = await request.json().catch(() => null);
  const cuerpo = cuerpoSchema.safeParse(crudo);

  if (!cuerpo.success) {
    return NextResponse.json(
      { error: "cuerpo", detalle: cuerpo.error.issues[0]?.message },
      { status: 400, headers: SIN_CACHE },
    );
  }

  const resultados: ResultadoPorVenta[] = [];

  /*
   * Una por una y en orden, no en paralelo.
   *
   * El orden importa: la serie `PED-n` sigue el orden real de venta, y con
   * `Promise.all` las ventas se numerarían según quién gane el lock. Además,
   * cada una toma el lock de la serie, así que en paralelo se esperarían entre
   * sí igual.
   */
  for (const venta of cuerpo.data.ventas) {
    try {
      const resultado = await registrarVentaDeMostrador({
        ...venta,
        medioPago: venta.medioPago as MedioDeMostrador,
        // Quien vendió, no quien drena: si vendió Ana y sincroniza Beto, la
        // venta es de Ana. El servidor igual valida que sea alguien real.
        usuarioId: venta.usuarioId ?? usuario.userId,
        cobradaAt: new Date(venta.cobradaAt),
      });

      if (!resultado.ok) {
        /*
         * `registrarVentaDeMostrador` solo devuelve `ok: false` por reglas de
         * negocio —no hay caja abierta, falta el cliente en una venta a
         * cuenta—. Eso no se arregla reintentando: lo tiene que resolver una
         * persona.
         */
        resultados.push({
          clave: venta.clave,
          estado: "rechazada",
          motivo: resultado.error,
        });
        continue;
      }

      if (resultado.nueva) {
        await registrarEnBitacora({
          sesion: usuario,
          accion: "crear",
          entidad: "pedido",
          entidadId: resultado.orderId,
          descripcion: `Venta sin conexión ${venta.numeroProvisorio} → ${resultado.numero}, subida por ${usuario.name}`,
        });
      }

      let invoiceId: string | undefined;
      let avisoFiscal: string | undefined;

      if (venta.comprobante === "fiscal" && resultado.nueva) {
        const fiscal = await emitirParaLaVenta({
          orderId: resultado.orderId,
          customerId: venta.customerId,
          receptorNombre: venta.contactoNombre,
          cuit: venta.cuit ?? null,
          lineas: venta.lineas,
          usuarioId: usuario.userId,
        });

        invoiceId = fiscal.invoiceId;
        avisoFiscal = fiscal.aviso;
      }

      resultados.push({
        clave: venta.clave,
        estado: "sincronizada",
        numero: resultado.numero,
        orderId: resultado.orderId,
        nueva: resultado.nueva,
        invoiceId,
        avisoFiscal,
      });
    } catch (error) {
      /*
       * Cualquier cosa que explote acá —la base que no responde, un timeout— es
       * transitoria por definición: si fuera un problema de los datos, Zod o
       * las reglas ya lo habrían atajado arriba. Se reintenta.
       */
      console.error(
        JSON.stringify({
          scope: "mostrador.drenaje",
          clave: venta.clave,
          error: error instanceof Error ? error.message : String(error),
        }),
      );

      resultados.push({
        clave: venta.clave,
        estado: "reintentar",
        motivo: "No se pudo guardar en este momento.",
      });
    }
  }

  return NextResponse.json(
    { resultados, servidorAt: new Date().toISOString() },
    { headers: SIN_CACHE },
  );
}
