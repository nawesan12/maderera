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

  refrescar();
  return {
    ok: resultado.nueva
      ? `Venta ${resultado.numero} registrada.`
      : `Esa venta ya estaba registrada como ${resultado.numero}.`,
    numero: resultado.numero,
    orderId: resultado.orderId,
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
