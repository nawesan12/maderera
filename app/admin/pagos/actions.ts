"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { datosBancarios, payments } from "@/lib/db/schema";
import { requireStaff } from "@/lib/dal/session";
import { registrarEnBitacora } from "@/lib/dal/admin/auditoria";
import { acreditarPago } from "@/lib/pagos/acreditar";
import { proveedorPorNombre } from "@/lib/pagos";
import { notificarResultadoDePago } from "@/lib/notificaciones/avisos";

export interface EstadoAccionPago {
  error?: string;
  ok?: string;
}

/**
 * Conciliación de una transferencia bancaria.
 *
 * Es el único cobro que aprueba una persona en vez de un webhook, así que es el
 * único que necesita quedar firmado: `conciliadoPor` guarda quién dio por buena
 * la plata. Después pasa por `acreditarPago` como cualquier otro, para que la
 * regla de "un solo lugar mueve plata" no tenga excepciones.
 */
export async function conciliarTransferencia(
  _previo: EstadoAccionPago,
  formData: FormData,
): Promise<EstadoAccionPago> {
  const usuario = await requireStaff();

  const parsed = z
    .object({
      pagoId: z.string().uuid(),
      decision: z.enum(["aprobar", "rechazar"]),
      motivo: z.string().trim().max(300).optional(),
    })
    .safeParse({
      pagoId: formData.get("pagoId"),
      decision: formData.get("decision"),
      motivo: (formData.get("motivo") as string) || undefined,
    });

  if (!parsed.success) return { error: "Datos inválidos." };

  const [pago] = await db
    .select({ id: payments.id, estado: payments.estado, proveedor: payments.proveedor })
    .from(payments)
    .where(eq(payments.id, parsed.data.pagoId))
    .limit(1);

  if (!pago) return { error: "El cobro no existe." };

  if (pago.estado === "aprobado") {
    return { error: "Este cobro ya estaba acreditado." };
  }

  const aprueba = parsed.data.decision === "aprobar";

  const resultado = await acreditarPago(pago.id, {
    id: `manual-${pago.id}`,
    estado: aprueba ? "aprobado" : "rechazado",
    // Null: el importe que vale es el que ya está guardado. Una transferencia
    // no la informa ningún proveedor, la mira una persona.
    monto: null,
    medio: "Transferencia bancaria",
    referencia: pago.id,
    motivoRechazo: aprueba ? null : (parsed.data.motivo ?? "Rechazada en la conciliación"),
    crudo: { conciliadoPor: usuario.userId, decision: parsed.data.decision },
  });

  await db
    .update(payments)
    .set({ conciliadoPor: usuario.userId, conciliadoAt: new Date() })
    .where(eq(payments.id, pago.id));

  if (aprueba && resultado.cambio) {
    await notificarResultadoDePago({ ...resultado, detalle: "aprobado" });
  }

  // Acreditar una transferencia es la decisión de una persona mirando un
  // comprobante: no hay proveedor externo que la confirme después. Sin
  // registro, no queda constancia de quién dio por buena la plata.
  await registrarEnBitacora({
    sesion: usuario,
    accion: aprueba ? "cobrar" : "anular",
    entidad: "pago",
    entidadId: pago.id,
    descripcion: aprueba
      ? "Acreditó una transferencia en la conciliación"
      : `Rechazó una transferencia: ${parsed.data.motivo ?? "sin motivo"}`,
  });

  revalidatePath("/admin/pagos");
  revalidatePath("/admin/pedidos");

  return {
    ok: aprueba
      ? "Cobro acreditado."
      : "Cobro rechazado. El cliente lo ve en su pedido.",
  };
}

/**
 * Vuelve a consultarle a Mercado Pago el estado de un cobro.
 *
 * Existe porque los webhooks se pierden: la red falla, el deploy estaba caído,
 * el aviso llegó antes de que el cobro estuviera guardado. Sin este botón, la
 * única salida es entrar al panel de Mercado Pago y corregir a mano.
 */
export async function reconsultarCobro(
  _previo: EstadoAccionPago,
  formData: FormData,
): Promise<EstadoAccionPago> {
  const usuario = await requireStaff();

  const pagoId = String(formData.get("pagoId") ?? "");

  const [pago] = await db
    .select()
    .from(payments)
    .where(eq(payments.id, pagoId))
    .limit(1);

  if (!pago) return { error: "El cobro no existe." };

  if (!pago.proveedorPaymentId) {
    return {
      error:
        "Todavía no hay un pago del lado de Mercado Pago: la persona no llegó a pagar.",
    };
  }

  const proveedor = proveedorPorNombre(
    pago.proveedor === "demo" ? "demo" : "mercado_pago",
  );

  if (!proveedor) {
    return { error: "Mercado Pago no está configurado en este entorno." };
  }

  try {
    const remoto = await proveedor.consultarPago(pago.proveedorPaymentId);
    if (!remoto) return { error: "Mercado Pago no reconoce ese pago." };

    const resultado = await acreditarPago(pago.id, remoto);

    if (resultado.cambio) {
      await registrarEnBitacora({
        sesion: usuario,
        accion: "cambiar_estado",
        entidad: "pago",
        entidadId: pago.id,
        descripcion: `Reconsultó un cobro a Mercado Pago y quedó ${resultado.estado}`,
      });
    }

    if (resultado.cambio && resultado.estado === "aprobado") {
      await notificarResultadoDePago({ ...resultado, detalle: "aprobado" });
    }

    revalidatePath("/admin/pagos");
    revalidatePath("/admin/pedidos");

    return {
      ok: resultado.cambio
        ? `Actualizado: el cobro quedó ${resultado.estado}.`
        : `Sin cambios: sigue ${resultado.estado}.`,
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "No se pudo consultar.",
    };
  }
}

/** Datos bancarios que ve quien va a transferir. Una sola fila, editable. */
export async function guardarDatosBancarios(
  _previo: EstadoAccionPago,
  formData: FormData,
): Promise<EstadoAccionPago> {
  const usuario = await requireStaff();

  const parsed = z
    .object({
      banco: z.string().trim().max(120),
      titular: z.string().trim().max(160),
      cuit: z.string().trim().max(20),
      // El CBU son 22 dígitos. Se valida el largo porque un CBU mal tipeado
      // manda la plata de un cliente a otra cuenta, y eso no vuelve.
      cbu: z
        .string()
        .trim()
        .regex(/^\d{22}$|^$/, "El CBU tiene que tener 22 dígitos."),
      alias: z.string().trim().max(60),
      instrucciones: z.string().trim().max(400).optional(),
    })
    .safeParse({
      banco: formData.get("banco") ?? "",
      titular: formData.get("titular") ?? "",
      cuit: formData.get("cuit") ?? "",
      cbu: String(formData.get("cbu") ?? "").replace(/\s/g, ""),
      alias: formData.get("alias") ?? "",
      instrucciones: (formData.get("instrucciones") as string) || undefined,
    });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Revisá los datos." };
  }

  const [existente] = await db.select({ id: datosBancarios.id }).from(datosBancarios).limit(1);

  const valores = {
    ...parsed.data,
    instrucciones: parsed.data.instrucciones ?? null,
    updatedAt: new Date(),
  };

  if (existente) {
    await db
      .update(datosBancarios)
      .set(valores)
      .where(eq(datosBancarios.id, existente.id));
  } else {
    await db.insert(datosBancarios).values(valores);
  }

  revalidatePath("/admin/pagos");
  revalidatePath("/checkout");

  await registrarEnBitacora({
    sesion: usuario,
    accion: "editar",
    entidad: "configuracion",
    descripcion: "Cambió los datos bancarios para transferencias",
  });

  return { ok: "Datos bancarios guardados." };
}
