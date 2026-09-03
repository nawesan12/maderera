"use server";

import { revalidatePath } from "next/cache";
import { updateTag } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { ETIQUETAS } from "@/lib/cache-publico";
import { goodsReceiptItems, goodsReceipts } from "@/lib/db/schema";
import { requireStaffRole } from "@/lib/dal/session";
import { registrarEnBitacora } from "@/lib/dal/admin/auditoria";
import { buscarParaRecibir } from "@/lib/dal/admin/recepciones";
import {
  anularRecepcion as anular,
  confirmarRecepcion as confirmar,
} from "@/lib/compras/recepcion";

export interface EstadoRecepcion {
  error?: string;
  ok?: string;
  id?: string;
}

const lineaSchema = z.object({
  variantId: z.string().uuid(),
  cantidad: z.coerce.number().positive(),
  costoUnitario: z.coerce.number().min(0),
  alicuotaIva: z.coerce.number().min(0).max(30),
});

const recepcionSchema = z.object({
  supplierId: z.string().uuid("Elegí el proveedor."),
  branchId: z.string().uuid("Elegí la sucursal."),
  numeroRemito: z
    .string()
    .trim()
    .max(40)
    .optional()
    .transform((v) => (v ? v : null)),
  fecha: z.string().optional(),
  gastos: z.coerce.number().min(0).default(0),
  notas: z
    .string()
    .trim()
    .max(1000)
    .optional()
    .transform((v) => (v ? v : null)),
  lineas: z.array(lineaSchema).min(1, "Cargá al menos un renglón."),
});

function refrescar(id?: string) {
  revalidatePath("/admin/recepciones");
  revalidatePath("/admin/stock");
  if (id) revalidatePath(`/admin/recepciones/${id}`);
}

/**
 * Crea la recepción **en borrador**.
 *
 * No toca stock ni costo: eso pasa al confirmar, y es a propósito. El costo
 * promedio no se puede revertir, así que la escritura que lo mueve tiene que
 * ser un acto explícito y no el efecto secundario de guardar un formulario a
 * medio cargar.
 */
export async function crearRecepcion(
  datos: z.input<typeof recepcionSchema>,
): Promise<EstadoRecepcion> {
  const usuario = await requireStaffRole("admin");

  const leido = recepcionSchema.safeParse(datos);
  if (!leido.success) {
    return { error: leido.error.issues[0]?.message ?? "Revisá los datos." };
  }

  const { lineas, fecha, ...cabecera } = leido.data;

  try {
    const id = await db.transaction(async (tx) => {
      const [recepcion] = await tx
        .insert(goodsReceipts)
        .values({
          ...cabecera,
          gastos: cabecera.gastos.toFixed(2),
          fecha: fecha ? new Date(fecha) : undefined,
          createdByUserId: usuario.userId,
        })
        .returning({ id: goodsReceipts.id });

      await tx.insert(goodsReceiptItems).values(
        lineas.map((l, i) => ({
          receiptId: recepcion.id,
          variantId: l.variantId,
          cantidad: l.cantidad.toFixed(4),
          costoUnitario: l.costoUnitario.toFixed(4),
          alicuotaIva: l.alicuotaIva.toFixed(2),
          orden: i,
        })),
      );

      return recepcion.id;
    });

    await registrarEnBitacora({
      sesion: usuario,
      accion: "crear",
      entidad: "recepcion",
      entidadId: id,
      descripcion: `Cargó una recepción con ${lineas.length} renglones`,
    });

    refrescar(id);
    return { ok: "Recepción cargada en borrador.", id };
  } catch (error) {
    // El índice único de remito por proveedor es lo que impide cargar dos veces
    // la misma entrega, que además de duplicar stock corrompe el promedio.
    if (String(error).includes("goods_receipts_remito_idx")) {
      return { error: "Ya hay una recepción con ese remito para este proveedor." };
    }
    throw error;
  }
}

/** Confirmar: entra el stock, se mezcla el costo y sube la deuda. */
export async function confirmarRecepcion(
  id: string,
): Promise<EstadoRecepcion> {
  const usuario = await requireStaffRole("admin");

  const resultado = await confirmar(id, usuario.userId);
  if (!resultado.ok) return { error: resultado.error };

  await registrarEnBitacora({
    sesion: usuario,
    accion: "cambiar_estado",
    entidad: "recepcion",
    entidadId: id,
    descripcion: `Confirmó la recepción: ${resultado.lineas} renglones por $${resultado.neto.toFixed(2)} netos`,
  });

  // El stock cambió y el catálogo público muestra disponibilidad.
  updateTag(ETIQUETAS.catalogo);
  refrescar(id);

  return {
    ok: `Recepción confirmada: ${resultado.lineas} renglones, $${resultado.neto.toFixed(2)} netos.`,
  };
}

export async function anularRecepcion(
  id: string,
  motivo: string,
): Promise<EstadoRecepcion> {
  const usuario = await requireStaffRole("admin");

  if (!motivo.trim()) {
    return { error: "Poné el motivo: una anulación sin explicación no se puede revisar después." };
  }

  const resultado = await anular(id, usuario.userId, motivo.trim());
  if (!resultado.ok) return { error: resultado.error };

  await registrarEnBitacora({
    sesion: usuario,
    accion: "cambiar_estado",
    entidad: "recepcion",
    entidadId: id,
    descripcion: `Anuló la recepción: ${motivo.trim()}`,
  });

  updateTag(ETIQUETAS.catalogo);
  refrescar(id);

  return {
    ok: "Recepción anulada. El stock volvió atrás; el costo promedio no se toca.",
  };
}

/** Buscador del formulario de carga. */
export async function buscarMercaderia(texto: string) {
  return buscarParaRecibir(texto);
}
