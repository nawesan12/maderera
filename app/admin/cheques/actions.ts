"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { and, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { accountMovements, cheques } from "@/lib/db/schema";
import { ErrorDeCobro, emitirRecibo } from "@/lib/cobros/recibo";
import {
  ESTADO_PARA_EL_CLIENTE,
  efectoEnLaCuenta,
  puedePasar,
  type EstadoDeCheque,
} from "@/lib/cheques/estados";
import {
  nombreDelCheque,
  normalizarNumeroDeCheque,
  revisarNumeroDeCheque,
} from "@/lib/cheques/numero";
import { notificarChequeRechazado, notificarRecibo } from "@/lib/notificaciones/cobros";
import { requireStaffRole } from "@/lib/dal/session";
import { registrarEnBitacora } from "@/lib/dal/admin/auditoria";
import { parsearImporte } from "@/lib/formato";

export interface EstadoCheque {
  error?: string;
  ok?: string;
  /** El recibo que se emitió al aceptar un cheque informado. */
  receiptId?: string;
}

const esquema = z.object({
  sentido: z.enum(["recibido", "entregado"]),
  tipo: z.enum(["fisico", "echeq"]),
  numero: z.string().trim().min(1, "Poné el número del cheque.").max(40),
  banco: z.string().trim().max(60).optional(),
  librador: z.string().trim().max(120).optional(),
  fechaPago: z
    .string()
    .min(1, "Poné la fecha de pago: es lo que ordena la cartera.")
    .transform((v) => new Date(`${v}T12:00:00`)),
  importe: z.string().min(1, "Poné el importe."),
  customerId: z.string().uuid().optional(),
  /**
   * Por qué circuito va.
   *
   * Antes no se preguntaba y todos los cheques cargados a mano quedaban en
   * «Facturas», aunque fueran del otro circuito: la cartera mostraba entonces
   * dos totales que no eran los de nadie.
   */
  circuito: z.enum(["blanco", "negro"]).default("blanco"),
  notas: z.string().trim().max(500).optional(),
});

/**
 * Alta manual de un cheque.
 *
 * Los que salen en un pago a proveedor entran solos desde ese formulario;
 * este alta es para los **recibidos** —el cliente grande que paga la cuenta
 * corriente con un cheque a 60— y para regularizar lo que ya está en el cajón
 * de antes de que existiera la cartera.
 */
export async function cargarCheque(
  _previo: EstadoCheque,
  formData: FormData,
): Promise<EstadoCheque> {
  const usuario = await requireStaffRole("admin");

  const parsed = esquema.safeParse({
    sentido: formData.get("sentido") ?? "recibido",
    tipo: formData.get("tipo") ?? "fisico",
    numero: formData.get("numero"),
    banco: (formData.get("banco") as string) || undefined,
    librador: (formData.get("librador") as string) || undefined,
    fechaPago: formData.get("fechaPago"),
    importe: (formData.get("importe") as string) || "",
    customerId: (formData.get("customerId") as string) || undefined,
    circuito: (formData.get("circuito") as string) || "blanco",
    notas: (formData.get("notas") as string) || undefined,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Revisá los datos." };
  }

  const d = parsed.data;
  const problemaDeNumero = revisarNumeroDeCheque(d.numero);
  if (problemaDeNumero) return { error: problemaDeNumero };
  const numero = normalizarNumeroDeCheque(d.numero);
  const importe = parsearImporte(d.importe);
  if (!Number.isFinite(importe) || importe <= 0) {
    return { error: "El importe tiene que ser mayor a cero." };
  }

  /*
   * Un e-Cheq no va por el circuito B.
   *
   * Es electrónico: queda registrado en el banco a nombre de la empresa, así
   * que anotarlo del otro lado cruza las dos cajas en el único lugar donde no
   * tiene arreglo. La misma regla que aplica el pago a proveedores
   * (`lib/retenciones/pago.ts`), acá para el alta a mano.
   */
  if (d.tipo === "echeq" && d.circuito === "negro") {
    return {
      error:
        "Un e-Cheq no puede ir por el circuito B: queda registrado en el banco a nombre de la empresa.",
    };
  }

  if (d.sentido === "recibido") {
    const [repetido] = await db
      .select({ id: cheques.id })
      .from(cheques)
      .where(
        and(
          eq(cheques.sentido, "recibido"),
          eq(cheques.numero, numero),
          sql`lower(coalesce(${cheques.banco}, '')) = lower(${d.banco ?? ""})`,
          ne(cheques.estado, "anulado"),
          ne(cheques.estado, "rechazado"),
        ),
      )
      .limit(1);
    if (repetido) {
      return { error: `${nombreDelCheque({ tipo: d.tipo, banco: d.banco ?? null, numero })} ya está en la cartera.` };
    }
  }

  await db.insert(cheques).values({
    sentido: d.sentido,
    tipo: d.tipo,
    numero,
    banco: d.banco ?? null,
    librador: d.librador ?? null,
    fechaPago: d.fechaPago,
    importe: importe.toFixed(2),
    // Un recibido arranca en el cajón; un entregado ya salió.
    estado: d.sentido === "recibido" ? "cartera" : "entregado",
    customerId: d.customerId ?? null,
    circuito: d.circuito,
    notas: d.notas ?? null,
    createdByUserId: usuario.userId,
  });

  await registrarEnBitacora({
    sesion: usuario,
    accion: "crear",
    entidad: "cheque",
    descripcion: `Cheque ${d.sentido} ${numero} por $${importe.toFixed(2)}, al ${d.fechaPago.toLocaleDateString("es-AR")}`,
  });

  revalidatePath("/admin/cheques");
  return { ok: "Cheque cargado." };
}

/**
 * Cambia el estado de un cheque, con lo que eso le hace a la cuenta del
 * cliente.
 *
 * Las transiciones y su efecto viven en `lib/cheques/estados.ts`, probadas.
 * Acá se ejecutan, en una sola transacción y con el cheque bloqueado: dos
 * clics en «Aceptar» emitirían dos recibos por el mismo cheque.
 *
 * - **Aceptar** un cheque informado por el cliente emite el recibo y baja la
 *   deuda (`emitirRecibo`).
 * - **Rechazar** uno que ya había bajado la deuda —el banco lo rebotó— deja
 *   una nota de débito atada al cheque: la deuda vuelve y el cliente la ve en
 *   Mi cuenta con el cheque nombrado. Antes esto era un cartel que decía «la
 *   deuda hay que reclamarla aparte».
 * - Rechazar uno informado que nunca se aceptó no toca la cuenta: nunca bajó.
 */
export async function cambiarEstadoDeCheque(
  id: string,
  nuevoEstado: string,
  motivo?: string,
): Promise<EstadoCheque> {
  const usuario = await requireStaffRole("admin");

  const hacia = nuevoEstado as EstadoDeCheque;
  const motivoLimpio = motivo?.trim().slice(0, 300) || null;

  if (hacia === "rechazado" && !motivoLimpio) {
    return { error: "Poné el motivo del rechazo: lo lee el cliente." };
  }

  let resultado: {
    desde: EstadoDeCheque;
    numero: string;
    sentido: "recibido" | "entregado";
    receiptId: string | null;
    numeroRecibo: string | null;
    debitado: boolean;
    estabaEndosado: boolean;
  };

  try {
    resultado = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${id}))`);

      const [cheque] = await tx.select().from(cheques).where(eq(cheques.id, id)).limit(1);
      if (!cheque) throw new ErrorDeCobro("Ese cheque no está.");

      const desde = cheque.estado as EstadoDeCheque;
      if (!puedePasar(desde, hacia)) {
        throw new ErrorDeCobro(
          `Un cheque ${ESTADO_PARA_EL_CLIENTE[desde].toLowerCase()} no puede pasar a ${ESTADO_PARA_EL_CLIENTE[hacia]?.toLowerCase() ?? hacia}.`,
        );
      }

      const efecto =
        cheque.sentido === "recibido" ? efectoEnLaCuenta(desde, hacia) : "nada";

      let receiptId: string | null = null;
      let numeroRecibo: string | null = null;
      let debitado = false;

      if (efecto === "acreditar") {
        const recibo = await emitirRecibo(tx, {
          customerId: cheque.customerId,
          origen: "portal",
          concepto: "Pago de cuenta corriente",
          circuito: cheque.circuito,
          partes: [
            {
              medio: cheque.tipo === "echeq" ? "echeq" : "cheque",
              importe: Number(cheque.importe),
              chequeId: cheque.id,
            },
          ],
          usuarioId: usuario.userId,
        });
        receiptId = recibo.receiptId;
        numeroRecibo = recibo.numero;
      } else {
        await tx
          .update(cheques)
          .set({
            estado: hacia,
            motivoRechazo: hacia === "rechazado" ? motivoLimpio : cheque.motivoRechazo,
            updatedAt: new Date(),
          })
          .where(eq(cheques.id, id));
      }

      if (efecto === "debitar" && cheque.customerId) {
        await tx.insert(accountMovements).values({
          customerId: cheque.customerId,
          tipo: "nota_debito",
          monto: Number(cheque.importe).toFixed(2),
          detalle: `${nombreDelCheque(cheque)} rechazado por el banco${motivoLimpio ? `: ${motivoLimpio}` : ""}`,
          referencia: cheque.numero,
          chequeId: cheque.id,
          receiptId: cheque.receiptId,
          createdByUserId: usuario.userId,
        });
        debitado = true;
      }

      return {
        desde,
        numero: cheque.numero,
        sentido: cheque.sentido,
        receiptId,
        numeroRecibo,
        debitado,
        estabaEndosado: desde === "entregado",
      };
    });
  } catch (error) {
    if (error instanceof ErrorDeCobro) return { error: error.message };
    throw error;
  }

  await registrarEnBitacora({
    sesion: usuario,
    accion: "cambiar_estado",
    entidad: "cheque",
    entidadId: id,
    descripcion: `Cheque ${resultado.numero}: ${resultado.desde} → ${hacia}${motivoLimpio ? ` (${motivoLimpio})` : ""}`,
  });

  // Los avisos, después del commit: un correo que no sale no deshace nada.
  if (resultado.receiptId) after(() => notificarRecibo(resultado.receiptId!));
  if (hacia === "rechazado" && resultado.sentido === "recibido") {
    after(() => notificarChequeRechazado(id, resultado.desde !== "informado"));
  }

  revalidatePath("/admin/cheques");
  revalidatePath("/admin/clientes");

  if (resultado.numeroRecibo) {
    return { ok: `Cheque aceptado. Se emitió el recibo ${resultado.numeroRecibo}.`, receiptId: resultado.receiptId! };
  }
  if (resultado.debitado) {
    return {
      ok: resultado.estabaEndosado
        ? "Rechazado: la deuda volvió a la cuenta del cliente. El cheque estaba endosado: hay que reponérselo al proveedor."
        : "Rechazado: la deuda volvió a la cuenta del cliente y se le avisó.",
    };
  }
  if (hacia === "rechazado" && resultado.sentido === "recibido") {
    return { ok: "Rechazado. La cuenta del cliente no cambió y se le avisó." };
  }
  return { ok: "Estado actualizado." };
}
