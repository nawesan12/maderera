"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { suppliers, supplierMovements } from "@/lib/db/schema";
import { requireStaffRole } from "@/lib/dal/session";
import { registrarEnBitacora } from "@/lib/dal/admin/auditoria";

export interface EstadoProveedor {
  error?: string;
  ok?: string;
  /** El id recién creado, para poder ir a la ficha sin buscarlo. */
  id?: string;
}

const textoOpcional = z
  .string()
  .trim()
  .max(200)
  .optional()
  .transform((v) => (v ? v : null));

const fichaSchema = z.object({
  id: z.string().uuid().optional(),
  nombre: z.string().trim().min(2, "Poné el nombre del proveedor.").max(160),
  razonSocial: textoOpcional,
  cuit: textoOpcional,
  condicionIva: z.enum([
    "responsable_inscripto",
    "monotributista",
    "exento",
    "consumidor_final",
    "no_categorizado",
  ]),
  contacto: textoOpcional,
  telefono: textoOpcional,
  email: textoOpcional,
  direccion: textoOpcional,
  rubro: textoOpcional,
  cbu: textoOpcional,
  aliasCbu: textoOpcional,
  diasPago: z.coerce.number().int().min(0).max(365),
  notas: z
    .string()
    .trim()
    .max(2000)
    .optional()
    .transform((v) => (v ? v : null)),
});

function refrescar(id?: string) {
  revalidatePath("/admin/proveedores");
  if (id) revalidatePath(`/admin/proveedores/${id}`);
}

/**
 * Alta y edición de la ficha, en una sola acción.
 *
 * Es el mismo formulario en los dos casos y separarlo en dos acciones sería
 * mantener dos veces la misma validación para que en algún momento diverjan.
 */
export async function guardarProveedor(
  datos: z.input<typeof fichaSchema>,
): Promise<EstadoProveedor> {
  const usuario = await requireStaffRole("admin");

  const leido = fichaSchema.safeParse(datos);
  if (!leido.success) {
    return { error: leido.error.issues[0]?.message ?? "Revisá los datos." };
  }

  const { id, ...campos } = leido.data;

  if (id) {
    await db.update(suppliers).set(campos).where(eq(suppliers.id, id));

    await registrarEnBitacora({
      sesion: usuario,
      accion: "editar",
      entidad: "proveedor",
      entidadId: id,
      descripcion: `Editó la ficha de ${campos.nombre}`,
    });

    refrescar(id);
    return { ok: "Ficha guardada.", id };
  }

  const [creado] = await db
    .insert(suppliers)
    .values(campos)
    .returning({ id: suppliers.id });

  await registrarEnBitacora({
    sesion: usuario,
    accion: "crear",
    entidad: "proveedor",
    entidadId: creado.id,
    descripcion: `Dio de alta a ${campos.nombre}`,
  });

  refrescar(creado.id);
  return { ok: "Proveedor creado.", id: creado.id };
}

const movimientoSchema = z.object({
  supplierId: z.string().uuid(),
  tipo: z.enum(["factura", "pago", "nota_credito", "nota_debito", "ajuste"]),
  monto: z.coerce.number().positive("El monto tiene que ser mayor a cero."),
  detalle: z
    .string()
    .trim()
    .max(300)
    .optional()
    .transform((v) => (v ? v : null)),
  referencia: textoOpcional,
});

/**
 * Los tipos que suben la deuda.
 *
 * **Positivo es lo que le debemos**, al revés que en la cuenta de clientes. El
 * signo lo pone el tipo y no quien carga: pedirle a alguien que escriba un
 * monto negativo para un pago es pedirle que se equivoque una vez cada veinte.
 */
const SUBE_LA_DEUDA = new Set(["factura", "nota_debito", "ajuste"]);

export async function registrarMovimientoDeProveedor(
  datos: z.input<typeof movimientoSchema>,
): Promise<EstadoProveedor> {
  const usuario = await requireStaffRole("admin");

  const leido = movimientoSchema.safeParse(datos);
  if (!leido.success) {
    return { error: leido.error.issues[0]?.message ?? "Revisá los datos." };
  }

  const { supplierId, tipo, monto, detalle, referencia } = leido.data;
  const conSigno = SUBE_LA_DEUDA.has(tipo) ? monto : -monto;

  await db.insert(supplierMovements).values({
    supplierId,
    tipo,
    monto: conSigno.toFixed(2),
    detalle,
    referencia,
    createdByUserId: usuario.userId,
  });

  await registrarEnBitacora({
    sesion: usuario,
    accion: "crear",
    entidad: "proveedor",
    entidadId: supplierId,
    descripcion: `Anotó ${tipo.replace("_", " ")} por $${monto.toFixed(2)}${referencia ? ` (${referencia})` : ""}`,
  });

  refrescar(supplierId);
  return { ok: "Movimiento anotado." };
}

/**
 * Da de baja al proveedor.
 *
 * No se borra: sus facturas, sus recepciones y el costo con el que entró cada
 * tabla siguen apuntando acá. Un proveedor borrado convierte todo ese historial
 * en filas huérfanas.
 */
export async function darDeBajaProveedor(
  id: string,
): Promise<EstadoProveedor> {
  const usuario = await requireStaffRole("admin");

  const [proveedor] = await db
    .update(suppliers)
    .set({ estado: "inactivo" })
    .where(eq(suppliers.id, id))
    .returning({ nombre: suppliers.nombre });

  if (!proveedor) return { error: "Ese proveedor no existe." };

  await registrarEnBitacora({
    sesion: usuario,
    accion: "cambiar_estado",
    entidad: "proveedor",
    entidadId: id,
    descripcion: `Dio de baja a ${proveedor.nombre}`,
  });

  refrescar(id);
  return { ok: `${proveedor.nombre} quedó inactivo.` };
}
