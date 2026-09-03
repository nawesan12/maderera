"use server";

import { revalidatePath } from "next/cache";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  goodsReceiptItems,
  goodsReceipts,
  purchaseOrderItems,
  purchaseOrders,
} from "@/lib/db/schema";
import { requireStaffRole } from "@/lib/dal/session";
import { registrarEnBitacora } from "@/lib/dal/admin/auditoria";
import { siguienteNumeroDeOrdenDeCompra } from "@/lib/dal/numeracion-ventas";
import { buscarParaRecibir } from "@/lib/dal/admin/recepciones";

export interface EstadoOrden {
  error?: string;
  ok?: string;
  id?: string;
}

const lineaSchema = z.object({
  variantId: z.string().uuid(),
  descripcion: z.string().min(1),
  cantidad: z.coerce.number().positive(),
  costoUnitario: z.coerce.number().min(0),
  alicuotaIva: z.coerce.number().min(0).max(30),
});

const ordenSchema = z.object({
  supplierId: z.string().uuid("Elegí el proveedor."),
  branchId: z.string().uuid("Elegí la sucursal."),
  fechaPrometida: z.string().optional(),
  notas: z
    .string()
    .trim()
    .max(1000)
    .optional()
    .transform((v) => (v ? v : null)),
  lineas: z.array(lineaSchema).min(1, "Cargá al menos un renglón."),
});

function refrescar(id?: string) {
  revalidatePath("/admin/compras/ordenes");
  revalidatePath("/admin/recepciones");
  if (id) revalidatePath(`/admin/compras/ordenes/${id}`);
}

export async function crearOrdenDeCompra(
  datos: z.input<typeof ordenSchema>,
): Promise<EstadoOrden> {
  const usuario = await requireStaffRole("admin");

  const leido = ordenSchema.safeParse(datos);
  if (!leido.success) {
    return { error: leido.error.issues[0]?.message ?? "Revisá los datos." };
  }

  const { lineas, fechaPrometida, ...cabecera } = leido.data;

  const id = await db.transaction(async (tx) => {
    // Con lock sobre la serie, como el resto de las numeraciones del proyecto:
    // dos personas creando una orden a la vez leían el mismo máximo.
    const numero = await siguienteNumeroDeOrdenDeCompra(tx);

    const [orden] = await tx
      .insert(purchaseOrders)
      .values({
        ...cabecera,
        numero,
        fechaPrometida: fechaPrometida ? new Date(fechaPrometida) : null,
        createdByUserId: usuario.userId,
      })
      .returning({ id: purchaseOrders.id });

    await tx.insert(purchaseOrderItems).values(
      lineas.map((l, i) => ({
        purchaseOrderId: orden.id,
        variantId: l.variantId,
        descripcion: l.descripcion,
        cantidad: l.cantidad.toFixed(4),
        costoUnitario: l.costoUnitario.toFixed(4),
        alicuotaIva: l.alicuotaIva.toFixed(2),
        orden: i,
      })),
    );

    return orden.id;
  });

  await registrarEnBitacora({
    sesion: usuario,
    accion: "crear",
    entidad: "orden_compra",
    entidadId: id,
    descripcion: `Creó una orden de compra con ${lineas.length} renglones`,
  });

  refrescar(id);
  return { ok: "Orden creada.", id };
}

/**
 * Marca la orden como enviada al proveedor.
 *
 * Es lo que la vuelve "algo que está por llegar": recién desde acá cuenta en lo
 * pendiente y se puede recibir contra ella. Un borrador es una lista de
 * intenciones y no debería inflar lo que se espera.
 */
export async function marcarOrdenEnviada(id: string): Promise<EstadoOrden> {
  const usuario = await requireStaffRole("admin");

  const [orden] = await db
    .update(purchaseOrders)
    .set({ estado: "enviada", enviadaAt: new Date() })
    .where(and(eq(purchaseOrders.id, id), eq(purchaseOrders.estado, "borrador")))
    .returning({ numero: purchaseOrders.numero });

  if (!orden) return { error: "Esa orden ya no está en borrador." };

  await registrarEnBitacora({
    sesion: usuario,
    accion: "cambiar_estado",
    entidad: "orden_compra",
    entidadId: id,
    descripcion: `Marcó ${orden.numero} como enviada al proveedor`,
  });

  refrescar(id);
  return { ok: `${orden.numero} quedó como enviada.` };
}

export async function anularOrdenDeCompra(
  id: string,
  motivo: string,
): Promise<EstadoOrden> {
  const usuario = await requireStaffRole("admin");

  if (!motivo.trim()) return { error: "Poné el motivo." };

  const [orden] = await db
    .update(purchaseOrders)
    .set({
      estado: "anulada",
      notas: sql`coalesce(${purchaseOrders.notas} || ' · ', '') || ${`Anulada: ${motivo.trim()}`}`,
    })
    .where(eq(purchaseOrders.id, id))
    .returning({ numero: purchaseOrders.numero });

  if (!orden) return { error: "Esa orden no existe." };

  await registrarEnBitacora({
    sesion: usuario,
    accion: "cambiar_estado",
    entidad: "orden_compra",
    entidadId: id,
    descripcion: `Anuló ${orden.numero}: ${motivo.trim()}`,
  });

  refrescar(id);
  return { ok: `${orden.numero} quedó anulada.` };
}

/**
 * Crea una recepción en borrador con lo que falta de la orden.
 *
 * Es el camino normal: el camión llega con el remito, y lo que hay que hacer es
 * confirmar cantidades, no volver a buscar cada producto. Trae lo pendiente ya
 * cargado y quien recibe corrige lo que vino de menos.
 */
export async function recibirDeLaOrden(
  purchaseOrderId: string,
  numeroRemito: string,
): Promise<EstadoOrden> {
  const usuario = await requireStaffRole("admin");

  const resultado = await db.transaction(async (tx) => {
    const [orden] = await tx
      .select()
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, purchaseOrderId))
      .limit(1);

    if (!orden) return { error: "Esa orden no existe." };
    if (orden.estado === "borrador") {
      return { error: "Marcá la orden como enviada antes de recibir contra ella." };
    }
    if (orden.estado === "anulada") return { error: "Esa orden está anulada." };

    const pendientes = await tx
      .select()
      .from(purchaseOrderItems)
      .where(
        and(
          eq(purchaseOrderItems.purchaseOrderId, purchaseOrderId),
          sql`${purchaseOrderItems.cantidadRecibida} < ${purchaseOrderItems.cantidad}`,
        ),
      )
      .orderBy(purchaseOrderItems.orden);

    if (pendientes.length === 0) {
      return { error: "Esta orden ya se recibió entera." };
    }

    const [recepcion] = await tx
      .insert(goodsReceipts)
      .values({
        supplierId: orden.supplierId,
        branchId: orden.branchId,
        purchaseOrderId,
        numeroRemito: numeroRemito.trim() || null,
        createdByUserId: usuario.userId,
      })
      .returning({ id: goodsReceipts.id });

    await tx.insert(goodsReceiptItems).values(
      pendientes.map((p, i) => ({
        receiptId: recepcion.id,
        variantId: p.variantId,
        purchaseOrderItemId: p.id,
        // Lo que falta, no lo pedido: si ya llegó la mitad, el remito de hoy
        // trae la otra mitad.
        cantidad: (Number(p.cantidad) - Number(p.cantidadRecibida)).toFixed(4),
        costoUnitario: p.costoUnitario,
        alicuotaIva: p.alicuotaIva,
        orden: i,
      })),
    );

    return { id: recepcion.id };
  });

  if ("error" in resultado) return { error: resultado.error };

  refrescar(purchaseOrderId);
  revalidatePath(`/admin/recepciones/${resultado.id}`);

  return {
    ok: "Recepción creada en borrador. Revisá las cantidades y confirmala.",
    id: resultado.id,
  };
}

/** El mismo buscador que usa la carga de recepciones. */
export async function buscarParaPedir(texto: string) {
  return buscarParaRecibir(texto);
}
