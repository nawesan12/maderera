"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { cheques } from "@/lib/db/schema";
import { requireStaffRole } from "@/lib/dal/session";
import { registrarEnBitacora } from "@/lib/dal/admin/auditoria";
import { parsearImporte } from "@/lib/formato";

export interface EstadoCheque {
  error?: string;
  ok?: string;
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
    notas: (formData.get("notas") as string) || undefined,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Revisá los datos." };
  }

  const d = parsed.data;
  const importe = parsearImporte(d.importe);
  if (!Number.isFinite(importe) || importe <= 0) {
    return { error: "El importe tiene que ser mayor a cero." };
  }

  await db.insert(cheques).values({
    sentido: d.sentido,
    tipo: d.tipo,
    numero: d.numero,
    banco: d.banco ?? null,
    librador: d.librador ?? null,
    fechaPago: d.fechaPago,
    importe: importe.toFixed(2),
    // Un recibido arranca en el cajón; un entregado ya salió.
    estado: d.sentido === "recibido" ? "cartera" : "entregado",
    customerId: d.customerId ?? null,
    notas: d.notas ?? null,
    createdByUserId: usuario.userId,
  });

  await registrarEnBitacora({
    sesion: usuario,
    accion: "crear",
    entidad: "cheque",
    descripcion: `Cheque ${d.sentido} ${d.numero} por $${importe.toFixed(2)}, al ${d.fechaPago.toLocaleDateString("es-AR")}`,
  });

  revalidatePath("/admin/cheques");
  return { ok: "Cheque cargado." };
}

/**
 * Qué transiciones tienen sentido. Un acreditado no vuelve a la cartera y un
 * rechazado no se acredita: los estados finales son finales.
 */
const TRANSICIONES: Record<string, string[]> = {
  cartera: ["depositado", "entregado", "rechazado", "anulado"],
  depositado: ["acreditado", "rechazado"],
  entregado: ["acreditado", "rechazado"],
};

export async function cambiarEstadoDeCheque(
  id: string,
  nuevoEstado: string,
): Promise<EstadoCheque> {
  const usuario = await requireStaffRole("admin");

  const [cheque] = await db
    .select({ estado: cheques.estado, numero: cheques.numero, sentido: cheques.sentido })
    .from(cheques)
    .where(eq(cheques.id, id))
    .limit(1);

  if (!cheque) return { error: "Ese cheque no está." };

  if (!TRANSICIONES[cheque.estado]?.includes(nuevoEstado)) {
    return {
      error: `Un cheque ${cheque.estado} no puede pasar a ${nuevoEstado}.`,
    };
  }

  await db
    .update(cheques)
    .set({ estado: nuevoEstado as never, updatedAt: new Date() })
    .where(eq(cheques.id, id));

  await registrarEnBitacora({
    sesion: usuario,
    accion: "cambiar_estado",
    entidad: "cheque",
    entidadId: id,
    descripcion: `Cheque ${cheque.numero}: ${cheque.estado} → ${nuevoEstado}`,
  });

  revalidatePath("/admin/cheques");
  return {
    ok:
      nuevoEstado === "rechazado" && cheque.sentido === "recibido"
        ? "Marcado como rechazado. Ojo: la deuda del cliente que lo entregó hay que reclamarla aparte."
        : "Estado actualizado.",
  };
}
