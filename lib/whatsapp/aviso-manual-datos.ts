import "server-only";

import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  avisosWhatsapp,
  branches,
  cheques,
  customers,
  cuttingOrders,
  deliveries,
  invoices,
  notificationsLog,
  orders,
  quotes,
  receipts,
  user,
} from "@/lib/db/schema";
import { nombreDelCheque } from "@/lib/cheques/numero";
import { numeroFormateado } from "@/lib/fiscal/comprobantes";
import { fechaCorta, fechaHora, moneda } from "@/lib/formato";
import { urlBase } from "@/lib/pagos/config";
import { enlaceDeSeguimiento } from "@/lib/seguimiento";
import { proveedorWhatsapp } from "./index";
import { datosDeSucursal } from "./avisos";
import { armarAvisoManual, AVISOS_MANUALES, type EventoManual } from "./aviso-manual";
import { MOTIVO_TOPE, tarifaLegible } from "./costos";
import { configDeGasto } from "./gasto";

/**
 * Los datos del botón «Avisar por WhatsApp», del lado del servidor.
 *
 * Busca lo que el texto necesita —el número de pedido, la sucursal, el saldo—
 * y el teléfono del cliente, arma el enlace de wa.me con `armarAvisoManual` y
 * le suma la historia: si ya se avisó a mano, si salió el automático, si el
 * automático no salió por el tope. Lo llaman las páginas del panel, que ya
 * validaron el rol: no exige sesión acá para no repetir la consulta en cada
 * botón de un tablero.
 *
 * **Los papeles no viajan por wa.me**: el enlace lleva solo texto. El único con
 * una dirección pública es el pedido (`/pedido/<número>?t=<token>`, la misma
 * del correo), y ese va en el texto. Para los demás —presupuesto, factura,
 * remito, recibo— no se inventa un enlace sin autorización: el botón avisa que
 * hay que adjuntar el PDF en el chat y ofrece descargarlo.
 */

export type TipoEntidad = "order" | "cutting_order" | "quote" | "receipt" | "cheque" | "customer" | "invoice" | "delivery";

export const TIPOS_ENTIDAD: TipoEntidad[] = ["order", "cutting_order", "quote", "receipt", "cheque", "customer", "invoice", "delivery"];

export interface HistoriaDelAviso {
  canal: "whatsapp" | "whatsapp_manual" | "email";
  estado: string;
  /** Una línea para leer: «Avisado a mano el 14/10 15:32 por Nahuel.» */
  texto: string;
  /** Algo salió mal o no salió: se muestra con color de atención. */
  atencion: boolean;
}

export interface AvisoManualListo {
  evento: EventoManual;
  entidadTipo: TipoEntidad;
  entidadId: string;
  titulo: string;
  texto: string;
  href: string | null;
  motivo: string | null;
  telefono: string | null;
  /** A quién: «Marta Gómez». */
  para: string | null;
  /** El número de lo que se avisa: «PED-1207», «REC-0042». */
  referencia: string | null;
  /** El PDF para adjuntar a mano, si el aviso es por un papel. */
  pdf: string | null;
  /** Lo último de cada canal para este aviso. */
  historia: HistoriaDelAviso[];
  /** Si ya se avisó a mano alguna vez: el botón pasa a «volver a avisar». */
  yaAvisado: boolean;
  /** El automático por la API está prendido para este evento (y cuesta). */
  automaticoPrendido: boolean;
  /** Lo que cuesta el automático, dicho: «USD 0,026». */
  costoAutomatico: string;
}

interface Base {
  nombre: string | null;
  telefono: string | null;
  valores: Record<string, string>;
  enlace?: { texto: string; url: string } | null;
  pdf?: string | null;
}

const UUID = /^[0-9a-f-]{36}$/i;

/** Los datos del cliente, el texto y el teléfono de cada cosa que se avisa. */
async function cargar(evento: EventoManual, tipo: TipoEntidad, id: string): Promise<Base | null> {
  switch (tipo) {
    case "order": {
      const [p] = await db
        .select({
          numero: orders.numero,
          token: orders.publicToken,
          contactoNombre: orders.contactoNombre,
          contactoTelefono: orders.contactoTelefono,
          clienteNombre: customers.nombre,
          clienteTelefono: customers.telefono,
          sucursal: branches.name,
          sucursalSlug: branches.slug,
        })
        .from(orders)
        .leftJoin(customers, eq(customers.id, orders.customerId))
        .leftJoin(branches, eq(branches.id, orders.branchId))
        .where(eq(orders.id, id))
        .limit(1);
      if (!p) return null;
      return {
        // Como el automático: el teléfono de la ficha manda sobre el del pedido.
        nombre: p.clienteNombre ?? p.contactoNombre,
        telefono: p.clienteTelefono ?? p.contactoTelefono,
        valores: { pedido: p.numero, ...datosDeSucursal(p.sucursal, p.sucursalSlug) },
        enlace: { texto: "Lo seguís acá", url: `${urlBase()}${enlaceDeSeguimiento(p.numero, p.token)}` },
      };
    }

    case "cutting_order": {
      const [c] = await db
        .select({
          numero: cuttingOrders.numero,
          contactoNombre: cuttingOrders.contactoNombre,
          clienteNombre: customers.nombre,
          clienteTelefono: customers.telefono,
          pedidoTelefono: orders.contactoTelefono,
          sucursal: branches.name,
          sucursalSlug: branches.slug,
        })
        .from(cuttingOrders)
        .leftJoin(customers, eq(customers.id, cuttingOrders.customerId))
        .leftJoin(orders, eq(orders.id, cuttingOrders.orderId))
        .leftJoin(branches, eq(branches.id, cuttingOrders.branchId))
        .where(eq(cuttingOrders.id, id))
        .limit(1);
      if (!c) return null;
      return {
        nombre: c.clienteNombre ?? c.contactoNombre,
        telefono: c.clienteTelefono ?? c.pedidoTelefono,
        valores: { corte: c.numero, sucursal: datosDeSucursal(c.sucursal, c.sucursalSlug).sucursal },
        pdf: evento === "documento" ? `/api/cortes/${id}/pdf` : null,
      };
    }

    case "quote": {
      const [q] = await db
        .select({
          numero: quotes.numero,
          total: quotes.total,
          validoHasta: quotes.validoHasta,
          contactoNombre: quotes.contactoNombre,
          contactoTelefono: quotes.contactoTelefono,
          clienteTelefono: customers.telefono,
        })
        .from(quotes)
        .leftJoin(customers, eq(customers.id, quotes.customerId))
        .where(eq(quotes.id, id))
        .limit(1);
      if (!q) return null;
      return {
        nombre: q.contactoNombre,
        // El presupuesto lo pidió quien figura en él: su teléfono primero.
        telefono: q.contactoTelefono ?? q.clienteTelefono,
        valores: {
          presupuesto: q.numero,
          total: moneda.format(Number(q.total)),
          vence: q.validoHasta ? fechaCorta.format(q.validoHasta) : "",
          documento: `el presupuesto ${q.numero}`,
        },
        pdf: `/api/presupuestos/${id}/pdf`,
      };
    }

    case "receipt": {
      const { reciboCompleto } = await import("@/lib/dal/recibos");
      const r = await reciboCompleto(id);
      if (!r?.cliente) return null;
      const [cliente] = await db
        .select({ nombre: customers.nombre, telefono: customers.telefono })
        .from(customers)
        .where(eq(customers.id, r.cliente.id))
        .limit(1);
      return {
        nombre: cliente?.nombre ?? null,
        telefono: cliente?.telefono ?? null,
        valores: {
          importe: moneda.format(Number(r.total)),
          recibo: r.numero,
          saldo: moneda.format(Number(r.saldoDespues ?? 0)),
          documento: `el recibo ${r.numero}`,
        },
        pdf: `/api/recibos/${id}/pdf`,
      };
    }

    case "cheque": {
      const [c] = await db
        .select({
          tipo: cheques.tipo,
          numero: cheques.numero,
          banco: cheques.banco,
          importe: cheques.importe,
          motivo: cheques.motivoRechazo,
          nombre: customers.nombre,
          telefono: customers.telefono,
        })
        .from(cheques)
        .leftJoin(customers, eq(customers.id, cheques.customerId))
        .where(eq(cheques.id, id))
        .limit(1);
      if (!c) return null;
      return {
        nombre: c.nombre,
        telefono: c.telefono,
        valores: {
          cheque: nombreDelCheque(c),
          importe: moneda.format(Number(c.importe)),
          motivo: c.motivo?.trim() || "lo rechazó el banco",
        },
      };
    }

    case "customer": {
      const [c] = await db
        .select({ nombre: customers.nombre, telefono: customers.telefono })
        .from(customers)
        .where(eq(customers.id, id))
        .limit(1);
      if (!c) return null;
      return {
        nombre: c.nombre,
        telefono: c.telefono,
        valores: { fecha: fechaCorta.format(new Date()), documento: "el resumen de tu cuenta corriente" },
        pdf: evento === "documento" ? `/api/cuenta/${id}/pdf` : null,
      };
    }

    case "invoice": {
      const [f] = await db
        .select({
          puntoVenta: invoices.puntoVenta,
          numero: invoices.numero,
          nombre: customers.nombre,
          telefono: customers.telefono,
        })
        .from(invoices)
        .leftJoin(customers, eq(customers.id, invoices.customerId))
        .where(eq(invoices.id, id))
        .limit(1);
      if (!f) return null;
      return {
        nombre: f.nombre,
        telefono: f.telefono,
        valores: { documento: `la factura ${numeroFormateado(f.puntoVenta, f.numero)}` },
        pdf: `/api/comprobantes/${id}/pdf`,
      };
    }

    case "delivery": {
      const [r] = await db
        .select({
          numero: deliveries.numero,
          firmaToken: deliveries.firmaToken,
          firmadoAt: deliveries.firmadoAt,
          contactoNombre: orders.contactoNombre,
          contactoTelefono: orders.contactoTelefono,
          clienteNombre: customers.nombre,
          clienteTelefono: customers.telefono,
        })
        .from(deliveries)
        .innerJoin(orders, eq(orders.id, deliveries.orderId))
        .leftJoin(customers, eq(customers.id, orders.customerId))
        .where(eq(deliveries.id, id))
        .limit(1);
      if (!r) return null;
      return {
        nombre: r.clienteNombre ?? r.contactoNombre,
        telefono: r.clienteTelefono ?? r.contactoTelefono,
        valores: { documento: `el remito ${r.numero}` },
        // El enlace para firmarlo es público a propósito y lo autoriza su token
        // (`/firmar/<token>`): es el que ya se manda por WhatsApp a mano.
        enlace:
          r.firmaToken && !r.firmadoAt
            ? { texto: "Para firmarlo con el dedo", url: `${urlBase()}/firmar/${r.firmaToken}` }
            : null,
        pdf: `/api/remitos/${id}/pdf`,
      };
    }
  }
}

/** Lo último que pasó con este aviso, por canal. */
async function historia(evento: string, entidadId: string): Promise<{ lineas: HistoriaDelAviso[]; manual: boolean }> {
  const filas = await db
    .select({
      canal: notificationsLog.canal,
      estado: notificationsLog.estado,
      error: notificationsLog.error,
      createdAt: notificationsLog.createdAt,
      quien: user.name,
    })
    .from(notificationsLog)
    .leftJoin(user, eq(user.id, notificationsLog.usuarioId))
    .where(
      and(
        eq(notificationsLog.evento, evento),
        eq(notificationsLog.entidadId, entidadId),
        inArray(notificationsLog.canal, ["whatsapp", "whatsapp_manual", "email"]),
      ),
    )
    .orderBy(desc(notificationsLog.createdAt))
    .limit(20);

  const lineas: HistoriaDelAviso[] = [];
  for (const canal of ["whatsapp_manual", "whatsapp", "email"] as const) {
    const f = filas.find((x) => x.canal === canal);
    if (!f) continue;
    const cuando = fechaHora.format(f.createdAt);
    if (canal === "whatsapp_manual") {
      lineas.push({
        canal,
        estado: f.estado,
        texto: `Avisado a mano el ${cuando}${f.quien ? ` por ${f.quien.split(" ")[0]}` : ""}.`,
        atencion: false,
      });
    } else if (canal === "whatsapp") {
      const salio = f.estado === "enviada" || f.estado === "simulada";
      lineas.push({
        canal,
        estado: f.estado,
        texto: salio
          ? `El aviso automático salió el ${cuando}${f.estado === "simulada" ? " (en demostración: no llegó)" : ""}.`
          : f.error === MOTIVO_TOPE
            ? `El aviso automático no salió (${cuando}): se llegó al tope del mes.`
            : `El aviso automático no salió (${cuando}): ${f.error ?? "sin detalle"}`,
        atencion: !salio,
      });
    } else {
      const salio = f.estado === "enviada" || f.estado === "simulada";
      lineas.push({
        canal,
        estado: f.estado,
        texto: salio ? `El correo salió el ${cuando}.` : `El correo no salió (${cuando}).`,
        atencion: !salio,
      });
    }
  }
  return { lineas, manual: filas.some((f) => f.canal === "whatsapp_manual") };
}

/**
 * Todo lo que necesita el botón para un aviso.
 *
 * @param extra valores que la página ya tiene (el saldo de la cuenta) y no hace
 *   falta volver a calcular.
 * @returns null si la entidad no existe.
 */
export async function avisoManual(
  evento: EventoManual,
  entidad: { tipo: TipoEntidad; id: string },
  extra?: Record<string, string>,
): Promise<AvisoManualListo | null> {
  if (!UUID.test(entidad.id)) return null;
  const [datos, pasado, automatico, gasto] = await Promise.all([
    cargar(evento, entidad.tipo, entidad.id),
    historia(evento, entidad.id),
    db
      .select({ activo: avisosWhatsapp.activo })
      .from(avisosWhatsapp)
      .where(eq(avisosWhatsapp.evento, evento))
      .limit(1),
    configDeGasto(),
  ]);
  if (!datos) return null;

  const armado = armarAvisoManual({
    evento,
    nombre: datos.nombre,
    telefono: datos.telefono,
    valores: { ...datos.valores, ...(extra ?? {}) },
    enlace: datos.enlace,
  });

  return {
    evento,
    entidadTipo: entidad.tipo,
    entidadId: entidad.id,
    titulo: AVISOS_MANUALES[evento].titulo,
    ...armado,
    para: datos.nombre,
    referencia:
      datos.valores.pedido ?? datos.valores.corte ?? datos.valores.presupuesto ?? datos.valores.recibo ?? datos.valores.cheque ?? null,
    pdf: datos.pdf ?? null,
    historia: pasado.lineas,
    yaAvisado: pasado.manual,
    // En demostración el automático no cuesta nada: no hay a quién avisarle.
    automaticoPrendido: Boolean(automatico[0]?.activo) && proveedorWhatsapp().id !== "demo",
    costoAutomatico: tarifaLegible(gasto.tarifas.utility),
  };
}

/** Varios a la vez, para un tablero: los que no existen se descartan. */
export async function avisosManuales(
  evento: EventoManual,
  tipo: TipoEntidad,
  ids: string[],
): Promise<Record<string, AvisoManualListo>> {
  const listos = await Promise.all(ids.map((id) => avisoManual(evento, { tipo, id })));
  return Object.fromEntries(listos.filter((a): a is AvisoManualListo => Boolean(a)).map((a) => [a.entidadId, a]));
}

/**
 * El recibo que se acaba de hacer, para avisarle desde la ficha del cliente:
 * el cobro se registra ahí mismo, y al cerrar el diálogo el botón ya está.
 * Solo los de los últimos tres días: uno viejo ya no es noticia.
 */
export async function avisoDelUltimoRecibo(customerId: string): Promise<AvisoManualListo | null> {
  if (!UUID.test(customerId)) return null;
  const [recibo] = await db
    .select({ id: receipts.id })
    .from(receipts)
    .where(
      and(
        eq(receipts.customerId, customerId),
        eq(receipts.estado, "emitido"),
        gte(receipts.createdAt, new Date(Date.now() - 3 * 86_400_000)),
      ),
    )
    .orderBy(desc(receipts.createdAt))
    .limit(1);
  return recibo ? avisoManual("recibo_emitido", { tipo: "receipt", id: recibo.id }) : null;
}
