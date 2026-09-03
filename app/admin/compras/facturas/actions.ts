"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { purchaseInvoices, suppliers, supplierMovements } from "@/lib/db/schema";
import { requireStaffRole } from "@/lib/dal/session";
import { registrarEnBitacora } from "@/lib/dal/admin/auditoria";

export interface EstadoFacturaCompra {
  error?: string;
  ok?: string;
  id?: string;
}

const esquema = z.object({
  supplierId: z.string().uuid("Elegí el proveedor."),
  tipo: z.enum([
    "factura_a",
    "factura_b",
    "factura_c",
    "factura_m",
    "nota_credito_a",
    "nota_credito_b",
    "nota_credito_c",
    "nota_debito_a",
    "nota_debito_b",
    "nota_debito_c",
    "ticket",
    "otro",
  ]),
  puntoVenta: z.coerce.number().int().min(0).max(99999),
  numero: z.coerce.number().int().min(0),
  fechaEmision: z.string(),
  cae: z
    .string()
    .trim()
    .max(20)
    .optional()
    .transform((v) => (v ? v : null)),
  neto: z.coerce.number().min(0),
  iva21: z.coerce.number().min(0),
  iva105: z.coerce.number().min(0),
  iva27: z.coerce.number().min(0),
  exento: z.coerce.number().min(0),
  percepciones: z.coerce.number().min(0),
  observaciones: z
    .string()
    .trim()
    .max(500)
    .optional()
    .transform((v) => (v ? v : null)),
});

/**
 * Carga una factura de proveedor y **anota la deuda en el mismo acto**.
 *
 * Las dos cosas van juntas en una transacción porque una factura cargada que no
 * llegó a la cuenta corriente es una deuda invisible: el proveedor la reclama y
 * el sistema dice que no debe nada.
 *
 * El total no se pide: se suma. Un total tipeado a mano que no coincide con sus
 * partes es la clase de dato que nadie revisa hasta que el libro IVA no cierra
 * contra el mayor.
 */
export async function cargarFacturaDeCompra(
  datos: z.input<typeof esquema>,
): Promise<EstadoFacturaCompra> {
  const usuario = await requireStaffRole("admin");

  const leido = esquema.safeParse(datos);
  if (!leido.success) {
    return { error: leido.error.issues[0]?.message ?? "Revisá los datos." };
  }

  const d = leido.data;
  const total =
    d.neto + d.iva21 + d.iva105 + d.iva27 + d.exento + d.percepciones;

  if (total <= 0) {
    return { error: "La factura no puede sumar cero." };
  }

  const esCredito = d.tipo.startsWith("nota_credito");

  try {
    const id = await db.transaction(async (tx) => {
      const [proveedor] = await tx
        .select({ diasPago: suppliers.diasPago, nombre: suppliers.nombre })
        .from(suppliers)
        .where(eq(suppliers.id, d.supplierId))
        .limit(1);

      const emision = new Date(d.fechaEmision);
      const vencimiento = new Date(emision);
      vencimiento.setDate(vencimiento.getDate() + (proveedor?.diasPago ?? 0));

      const [factura] = await tx
        .insert(purchaseInvoices)
        .values({
          supplierId: d.supplierId,
          tipo: d.tipo,
          puntoVenta: d.puntoVenta,
          numero: d.numero,
          fechaEmision: emision,
          fechaVencimiento: vencimiento,
          cae: d.cae,
          neto: d.neto.toFixed(2),
          iva21: d.iva21.toFixed(2),
          iva105: d.iva105.toFixed(2),
          iva27: d.iva27.toFixed(2),
          exento: d.exento.toFixed(2),
          percepciones: d.percepciones.toFixed(2),
          total: total.toFixed(2),
          observaciones: d.observaciones,
          createdByUserId: usuario.userId,
        })
        .returning({ id: purchaseInvoices.id });

      const referencia = `${String(d.puntoVenta).padStart(4, "0")}-${String(d.numero).padStart(8, "0")}`;

      /*
       * En proveedores **positivo es lo que le debemos**, al revés que en
       * clientes. Una nota de crédito del proveedor baja esa deuda, así que
       * entra en negativo.
       */
      await tx.insert(supplierMovements).values({
        supplierId: d.supplierId,
        tipo: esCredito ? "nota_credito" : d.tipo.startsWith("nota_debito") ? "nota_debito" : "factura",
        monto: (esCredito ? -total : total).toFixed(2),
        referencia,
        detalle: "Factura de compra",
        createdByUserId: usuario.userId,
      });

      return factura.id;
    });

    await registrarEnBitacora({
      sesion: usuario,
      accion: "crear",
      entidad: "factura_compra",
      entidadId: id,
      descripcion: `Cargó una factura de compra por $${total.toFixed(2)}`,
    });

    revalidatePath("/admin/compras/facturas");
    revalidatePath("/admin/arca/libro-iva-compras");
    revalidatePath(`/admin/proveedores/${d.supplierId}`);

    return { ok: "Factura cargada.", id };
  } catch (error) {
    /*
     * Es el índice que impide computar dos veces el mismo crédito fiscal. Que
     * frene acá, con un mensaje claro, es exactamente el punto: la factura
     * llega por mail y en papel, y las dos veces alguien la carga.
     */
    if (String(error).includes("purchase_invoices_numeracion_idx")) {
      return {
        error:
          "Ese comprobante ya está cargado para este proveedor. Computarlo dos veces rompería el IVA del mes.",
      };
    }
    throw error;
  }
}
