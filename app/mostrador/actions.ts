"use server";

import { revalidatePath } from "next/cache";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { cashMovements, cashSessions } from "@/lib/db/schema";
import { requireStaff } from "@/lib/dal/session";
import { registrarEnBitacora } from "@/lib/dal/admin/auditoria";
import {
  registrarVentaDeMostrador,
  type MedioDeMostrador,
} from "@/lib/mostrador/venta";
import { anularVentaDeMostrador } from "@/lib/mostrador/anular";
import { emitirParaLaVenta, letraQueSaldria } from "@/lib/mostrador/comprobante";
import {
  buscarClienteEnMostrador,
  buscarParaMostrador,
  preciosPara,
} from "@/lib/mostrador/buscar";

export interface EstadoMostrador {
  error?: string;
  ok?: string;
  /** Número del pedido recién hecho, para poder ofrecer el comprobante. */
  numero?: string;
  orderId?: string;
  invoiceId?: string;
  /**
   * Qué salió mal con el comprobante, sobre una venta que igual quedó hecha.
   * Es distinto de `error`: la venta está, lo que falta es el papel.
   */
  avisoFiscal?: string;
}

const lineaSchema = z.object({
  variantId: z.string().uuid().nullable(),
  descripcion: z.string().min(1),
  unidad: z.string().min(1),
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
  /** Qué papel se lleva el cliente. La letra no se elige: se deriva. */
  comprobante: z.enum(["interno", "fiscal"]).default("interno"),
  /** CUIT tipeado en el momento, para facturar a alguien sin ficha. */
  cuit: z.string().nullable().optional(),
  descuento: z.number().min(0).optional(),
  descuentoMotivo: z.string().nullable().optional(),
  notas: z.string().nullable().optional(),
});

function refrescar() {
  revalidatePath("/mostrador");
  revalidatePath("/admin");
  revalidatePath("/admin/pedidos");
  revalidatePath("/admin/pagos");
  revalidatePath("/admin/stock");
}

/* -------------------------------------------------------------------------- */
/* Caja                                                                        */
/* -------------------------------------------------------------------------- */

export async function abrirCaja(
  branchId: string,
  fondoInicial: number,
): Promise<EstadoMostrador> {
  const usuario = await requireStaff();

  if (!Number.isFinite(fondoInicial) || fondoInicial < 0) {
    return { error: "El fondo inicial no puede ser negativo." };
  }

  try {
    await db.transaction(async (tx) => {
      const [sesion] = await tx
        .insert(cashSessions)
        .values({ branchId, abiertaPor: usuario.userId })
        .returning({ id: cashSessions.id });

      // El fondo va como movimiento y no como columna: así el efectivo esperado
      // es siempre la misma suma, sin excepciones que alguien tenga que
      // recordar.
      await tx.insert(cashMovements).values({
        sessionId: sesion.id,
        tipo: "apertura",
        monto: fondoInicial.toFixed(2),
        motivo: "Fondo inicial",
        creadoPor: usuario.userId,
      });
    });
  } catch (error) {
    // El índice único parcial es el que garantiza un turno por sucursal. Si dos
    // personas abren a la vez, una gana y a la otra se le explica por qué.
    if (String(error).includes("cash_sessions_una_abierta_por_sucursal")) {
      return { error: "Ya hay una caja abierta en esta sucursal." };
    }
    throw error;
  }

  await registrarEnBitacora({
    sesion: usuario,
    accion: "crear",
    entidad: "caja",
    descripcion: `Abrió la caja con un fondo de $${fondoInicial.toFixed(2)}`,
  });

  refrescar();
  return { ok: "Caja abierta." };
}

export async function registrarMovimientoDeCaja(
  sessionId: string,
  tipo: "ingreso" | "retiro",
  monto: number,
  motivo: string,
): Promise<EstadoMostrador> {
  const usuario = await requireStaff();

  if (!Number.isFinite(monto) || monto <= 0) {
    return { error: "El monto tiene que ser mayor a cero." };
  }
  if (!motivo.trim()) {
    return { error: "Poné el motivo: un movimiento sin explicación no se puede revisar después." };
  }

  await db.insert(cashMovements).values({
    sessionId,
    tipo,
    // El signo lo pone el tipo. Guardarlo en el monto es lo que hace que el
    // efectivo esperado sea una suma sola.
    monto: (tipo === "retiro" ? -monto : monto).toFixed(2),
    motivo: motivo.trim(),
    creadoPor: usuario.userId,
  });

  await registrarEnBitacora({
    sesion: usuario,
    accion: "crear",
    entidad: "caja",
    descripcion: `${tipo === "retiro" ? "Retiró" : "Ingresó"} $${monto.toFixed(2)}: ${motivo.trim()}`,
  });

  refrescar();
  return { ok: tipo === "retiro" ? "Retiro registrado." : "Ingreso registrado." };
}

export async function cerrarCaja(
  sessionId: string,
  contado: number,
  notas: string,
): Promise<EstadoMostrador> {
  const usuario = await requireStaff();

  if (!Number.isFinite(contado) || contado < 0) {
    return { error: "Lo contado no puede ser negativo." };
  }

  const [{ esperado }] = await db
    .select({
      esperado: sql<string>`coalesce(sum(${cashMovements.monto}), 0)`,
    })
    .from(cashMovements)
    .where(eq(cashMovements.sessionId, sessionId));

  const diferencia = contado - Number(esperado);

  const actualizadas = await db
    .update(cashSessions)
    .set({
      estado: "cerrada",
      cerradaPor: usuario.userId,
      cerradaAt: new Date(),
      // Se guarda lo contado tal cual, sin corregirlo: la diferencia es el dato
      // que interesa y pisarla sería tapar lo único que esto sirve para ver.
      contado: contado.toFixed(2),
      notas: notas.trim() || null,
    })
    .where(
      and(eq(cashSessions.id, sessionId), eq(cashSessions.estado, "abierta")),
    )
    .returning({ id: cashSessions.id });

  if (actualizadas.length === 0) {
    return { error: "Esa caja ya estaba cerrada." };
  }

  await registrarEnBitacora({
    sesion: usuario,
    accion: "cambiar_estado",
    entidad: "caja",
    descripcion:
      `Cerró la caja. Esperado $${Number(esperado).toFixed(2)}, contado $${contado.toFixed(2)}` +
      (Math.abs(diferencia) >= 0.01
        ? `, diferencia $${diferencia.toFixed(2)}`
        : ", sin diferencia"),
  });

  refrescar();
  return {
    ok:
      Math.abs(diferencia) < 0.01
        ? "Caja cerrada sin diferencia."
        : `Caja cerrada con una diferencia de $${diferencia.toFixed(2)}.`,
  };
}

/* -------------------------------------------------------------------------- */
/* Venta                                                                       */
/* -------------------------------------------------------------------------- */

export async function cobrarVenta(
  datos: z.input<typeof ventaSchema>,
): Promise<EstadoMostrador> {
  const usuario = await requireStaff();

  const parsed = ventaSchema.safeParse(datos);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos de la venta incompletos." };
  }

  const resultado = await registrarVentaDeMostrador({
    ...parsed.data,
    medioPago: parsed.data.medioPago as MedioDeMostrador,
    usuarioId: usuario.userId,
  });

  if (!resultado.ok) return { error: resultado.error };

  // Solo se registra la venta nueva. Si la clave ya existía es el segundo toque
  // del mismo botón, y anotarlo dos veces en la bitácora contaría dos ventas.
  if (resultado.nueva) {
    await registrarEnBitacora({
      sesion: usuario,
      accion: "crear",
      entidad: "pedido",
      descripcion: `Venta de mostrador ${resultado.numero} por $${resultado.total.toFixed(2)}`,
    });
  }

  /*
   * El comprobante va acá, fuera de la transacción de la venta y solo si la
   * venta es nueva. La plata ya está en la caja: si ARCA no contesta, queda una
   * venta sin comprobante —que se resuelve después desde Facturación— y no una
   * venta deshecha, que no se resuelve nunca.
   */
  let avisoFiscal: string | undefined;
  let invoiceId: string | undefined;

  if (parsed.data.comprobante === "fiscal" && resultado.nueva) {
    const fiscal = await emitirParaLaVenta({
      orderId: resultado.orderId,
      customerId: parsed.data.customerId,
      receptorNombre: parsed.data.contactoNombre,
      cuit: parsed.data.cuit ?? null,
      // Las de la venta, con el descuento ya repartido.
      lineas: resultado.lineas,
      usuarioId: usuario.userId,
    });
    avisoFiscal = fiscal.autorizado ? undefined : fiscal.aviso;
    invoiceId = fiscal.invoiceId;
  }

  refrescar();
  return {
    ok: resultado.nueva
      ? `Venta ${resultado.numero} registrada.`
      : `Esa venta ya estaba registrada como ${resultado.numero}.`,
    numero: resultado.numero,
    orderId: resultado.orderId,
    invoiceId,
    avisoFiscal,
  };
}

/* -------------------------------------------------------------------------- */
/* Búsqueda                                                                    */
/* -------------------------------------------------------------------------- */

export async function buscarEnMostrador(texto: string, branchId: string, customerId: string | null) {
  await requireStaff();
  return buscarParaMostrador(texto, branchId, customerId);
}

export async function buscarClientes(texto: string) {
  await requireStaff();
  return buscarClienteEnMostrador(texto);
}

/**
 * Los precios que le corresponden a un cliente para las variantes ya cargadas.
 *
 * La pantalla la usa cuando se identifica al cliente con la venta empezada.
 */
export async function preciosDelCliente(
  variantIds: string[],
  customerId: string | null,
) {
  await requireStaff();
  return preciosPara(variantIds, customerId);
}

/** Qué letra saldría con el cliente y el CUIT que hay en pantalla. */
export async function letraDelComprobante(
  customerId: string | null,
  cuit: string | null,
) {
  await requireStaff();
  return letraQueSaldria(customerId, cuit);
}

/**
 * Anula una venta del mostrador.
 *
 * Si la venta tenía factura, esto **no** emite la nota de crédito: avisa que
 * hace falta y deja el enlace. Emitir un comprobante es una decisión de alguien,
 * no un efecto secundario de tocar un botón acá.
 */
export async function anularVenta(
  orderId: string,
  motivo: string,
): Promise<EstadoMostrador> {
  const usuario = await requireStaff();

  const r = await anularVentaDeMostrador(orderId, motivo, usuario.userId);
  if (!r.ok) return { error: r.error };

  await registrarEnBitacora({
    sesion: usuario,
    accion: "anular",
    entidad: "pedido",
    entidadId: orderId,
    descripcion: `Anuló una venta de mostrador: ${motivo.trim()}`,
  });

  refrescar();
  return {
    ok: "Venta anulada.",
    avisoFiscal: r.facturaPendiente
      ? "La venta tenía factura. Emitile la nota de crédito desde Facturación."
      : undefined,
  };
}
