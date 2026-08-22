"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  accountMovements,
  addresses,
  customers,
  orders,
  quotes,
} from "@/lib/db/schema";
import { requireStaff, requireStaffRole } from "@/lib/dal/session";

export interface EstadoCliente {
  error?: string;
  ok?: string;
}

const clienteSchema = z.object({
  id: z.string().uuid().optional(),
  nombre: z.string().trim().min(2, "El nombre es obligatorio.").max(160),
  razonSocial: z.string().trim().max(160).optional(),
  cuit: z
    .string()
    .trim()
    .max(20)
    .optional()
    .refine(
      (v) => !v || /^\d{2}-?\d{8}-?\d$/.test(v),
      "El CUIT tiene que tener 11 dígitos, con o sin guiones.",
    ),
  condicionIva: z.enum([
    "responsable_inscripto",
    "monotributista",
    "exento",
    "consumidor_final",
    "no_categorizado",
  ]),
  tipo: z.enum(["particular", "profesional"]),
  email: z.string().trim().email("Revisá el correo.").optional().or(z.literal("")),
  telefono: z.string().trim().max(40).optional(),
  direccion: z.string().trim().max(200).optional(),
  rubro: z.string().trim().max(80).optional(),
  asesor: z.string().trim().max(60).optional(),
  limiteCredito: z.string().default("0"),
  notas: z.string().trim().max(1000).optional(),
});

export async function guardarCliente(
  _previo: EstadoCliente,
  formData: FormData,
): Promise<EstadoCliente> {
  await requireStaff();

  const parsed = clienteSchema.safeParse({
    id: (formData.get("id") as string) || undefined,
    nombre: formData.get("nombre"),
    razonSocial: (formData.get("razonSocial") as string) || undefined,
    cuit: (formData.get("cuit") as string) || undefined,
    condicionIva: formData.get("condicionIva") ?? "consumidor_final",
    tipo: formData.get("tipo") ?? "particular",
    email: (formData.get("email") as string) || "",
    telefono: (formData.get("telefono") as string) || undefined,
    direccion: (formData.get("direccion") as string) || undefined,
    rubro: (formData.get("rubro") as string) || undefined,
    asesor: (formData.get("asesor") as string) || undefined,
    limiteCredito: (formData.get("limiteCredito") as string) || "0",
    notas: (formData.get("notas") as string) || undefined,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Revisá los datos." };
  }

  const d = parsed.data;
  const campos = {
    nombre: d.nombre,
    razonSocial: d.razonSocial || null,
    // El CUIT se guarda sin guiones para poder buscarlo escrito de cualquier forma.
    cuit: d.cuit ? d.cuit.replace(/-/g, "") : null,
    condicionIva: d.condicionIva,
    tipo: d.tipo,
    email: d.email || null,
    telefono: d.telefono || null,
    direccion: d.direccion || null,
    rubro: d.rubro || null,
    asesor: d.asesor || null,
    limiteCredito: (Number(d.limiteCredito.replace(/[^\d.-]/g, "")) || 0).toFixed(2),
    notas: d.notas || null,
    updatedAt: new Date(),
  };

  if (d.id) {
    await db.update(customers).set(campos).where(eq(customers.id, d.id));
  } else {
    await db.insert(customers).values(campos);
  }

  revalidatePath("/admin/clientes");
  return { ok: d.id ? "Cliente actualizado." : "Cliente creado." };
}

const movimientoSchema = z.object({
  customerId: z.string().uuid(),
  tipo: z.enum(["compra", "pago", "nota_credito", "nota_debito", "ajuste"]),
  monto: z.string(),
  detalle: z.string().trim().max(200).optional(),
});

/**
 * Registra un movimiento de cuenta corriente.
 *
 * El signo lo pone el tipo de movimiento y no quien carga: una compra suma
 * deuda, un pago la resta. Dejar que se escriba el signo a mano es la forma más
 * fácil de que una cuenta termine al revés.
 */
export async function registrarMovimiento(
  _previo: EstadoCliente,
  formData: FormData,
): Promise<EstadoCliente> {
  const usuario = await requireStaff();

  const parsed = movimientoSchema.safeParse({
    customerId: formData.get("customerId"),
    tipo: formData.get("tipo"),
    monto: formData.get("monto"),
    detalle: (formData.get("detalle") as string) || undefined,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Revisá los datos." };
  }

  const magnitud = Math.abs(
    Number(parsed.data.monto.replace(/\./g, "").replace(",", ".")),
  );

  if (!Number.isFinite(magnitud) || magnitud <= 0) {
    return { error: "Poné un importe mayor a cero." };
  }

  const suma = parsed.data.tipo === "compra" || parsed.data.tipo === "nota_debito";
  const monto = (suma ? magnitud : -magnitud).toFixed(2);

  await db.insert(accountMovements).values({
    customerId: parsed.data.customerId,
    tipo: parsed.data.tipo,
    monto,
    detalle: parsed.data.detalle,
    createdByUserId: usuario.userId,
  });

  revalidatePath("/admin/clientes");
  return { ok: "Movimiento registrado." };
}

const vinculacionSchema = z.object({
  customerId: z.string().uuid(),
  cuentaWebId: z.string().uuid(),
});

/**
 * Une la ficha del mostrador con la cuenta que la persona se creó en el sitio.
 *
 * Existen dos fichas porque el registro público no vincula solo: como el alta no
 * verifica el correo, hacerlo automáticamente permitiría registrarse con el mail
 * de un tercero y quedarse con su cuenta corriente. La decisión la toma alguien
 * del mostrador, que sabe con quién está hablando.
 *
 * Todo pasa en una transacción y en este orden: primero se libera el `userId` de
 * la ficha web —hay un índice único sobre esa columna, así que no pueden
 * convivir las dos con el mismo—, después se lo queda la ficha real y recién ahí
 * se mudan pedidos, presupuestos, movimientos y direcciones. La ficha web se
 * desactiva en vez de borrarse: si la unión resultó equivocada, los datos siguen
 * estando.
 */
export async function vincularCuentaWeb(
  _previo: EstadoCliente,
  formData: FormData,
): Promise<EstadoCliente> {
  await requireStaffRole("admin", "vendedor");

  const parsed = vinculacionSchema.safeParse({
    customerId: formData.get("customerId"),
    cuentaWebId: formData.get("cuentaWebId"),
  });

  if (!parsed.success) return { error: "No pudimos identificar las fichas." };

  const { customerId, cuentaWebId } = parsed.data;

  if (customerId === cuentaWebId) {
    return { error: "Son la misma ficha." };
  }

  const [destino, web] = await Promise.all([
    db
      .select({ id: customers.id, userId: customers.userId })
      .from(customers)
      .where(eq(customers.id, customerId))
      .limit(1),
    db
      .select({ id: customers.id, userId: customers.userId })
      .from(customers)
      .where(eq(customers.id, cuentaWebId))
      .limit(1),
  ]);

  const userId = web[0]?.userId;

  if (!destino[0] || !web[0] || !userId) {
    return { error: "Esa cuenta web ya no está disponible." };
  }

  if (destino[0].userId) {
    return { error: "Este cliente ya tiene una cuenta web vinculada." };
  }

  await db.transaction(async (tx) => {
    await tx
      .update(customers)
      .set({ userId: null, active: false, updatedAt: new Date() })
      .where(eq(customers.id, cuentaWebId));

    await tx
      .update(customers)
      .set({ userId, updatedAt: new Date() })
      .where(eq(customers.id, customerId));

    await tx
      .update(orders)
      .set({ customerId })
      .where(eq(orders.customerId, cuentaWebId));

    await tx
      .update(quotes)
      .set({ customerId })
      .where(eq(quotes.customerId, cuentaWebId));

    await tx
      .update(accountMovements)
      .set({ customerId })
      .where(eq(accountMovements.customerId, cuentaWebId));

    await tx
      .update(addresses)
      .set({ customerId })
      .where(eq(addresses.customerId, cuentaWebId));
  });

  revalidatePath("/admin/clientes");
  revalidatePath("/mi-cuenta", "layout");

  return {
    ok: "Listo: ahora ve sus pedidos y su cuenta corriente desde el sitio.",
  };
}
