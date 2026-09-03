"use server";

import { revalidatePath } from "next/cache";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { cashMovements, cashSessions, orders, posDevices } from "@/lib/db/schema";
import { requireStaff } from "@/lib/dal/session";
import { registrarEnBitacora } from "@/lib/dal/admin/auditoria";
import { crearCajaFisica } from "@/lib/dal/admin/cajas-fisicas";

export interface EstadoCajas {
  error?: string;
  ok?: string;
}

function refrescar() {
  revalidatePath("/admin/caja");
  revalidatePath("/mostrador");
}

const altaSchema = z.object({
  codigo: z
    .string()
    .trim()
    .min(2, "El código es muy corto.")
    .max(20)
    // Es lo que se imprime en el ticket del cliente: sin espacios ni acentos,
    // porque después alguien lo va a tener que dictar por teléfono.
    .regex(/^[A-Za-z0-9-]+$/, "Usá solo letras, números y guiones."),
  nombre: z
    .string()
    .trim()
    .max(80)
    .optional()
    .transform((v) => (v ? v : null)),
  branchId: z.string().uuid("Elegí la sucursal."),
});

/**
 * Da de alta una máquina del mostrador.
 *
 * El código es el que va a salir impreso en las ventas hechas sin conexión
 * (`CAJA1-017`), así que se guarda en mayúsculas y sin adornos: es un dato que
 * alguien va a leer de un papel arrugado y repetir por teléfono.
 */
export async function crearCaja(
  datos: z.input<typeof altaSchema>,
): Promise<EstadoCajas> {
  const usuario = await requireStaff();

  const leido = altaSchema.safeParse(datos);
  if (!leido.success) {
    return { error: leido.error.issues[0]?.message ?? "Revisá los datos." };
  }

  try {
    const caja = await crearCajaFisica(leido.data);

    await registrarEnBitacora({
      sesion: usuario,
      accion: "crear",
      entidad: "caja",
      descripcion: `Dio de alta la caja ${caja.codigo}`,
    });
  } catch (error) {
    if (String(error).includes("pos_devices_codigo_idx")) {
      return { error: "Ya existe una caja con ese código." };
    }
    throw error;
  }

  refrescar();
  return { ok: "Caja creada. Ahora vinculala desde esa máquina." };
}

/**
 * Da de baja una caja.
 *
 * No se borra: sus ventas viejas siguen apuntando a un número provisorio que
 * lleva ese código, y ese papel puede volver al mostrador dentro de un año.
 */
export async function darDeBajaCaja(id: string): Promise<EstadoCajas> {
  const usuario = await requireStaff();

  const [caja] = await db
    .update(posDevices)
    .set({ activo: false })
    .where(eq(posDevices.id, id))
    .returning({ codigo: posDevices.codigo });

  if (!caja) return { error: "Esa caja no existe." };

  await registrarEnBitacora({
    sesion: usuario,
    accion: "cambiar_estado",
    entidad: "caja",
    descripcion: `Dio de baja la caja ${caja.codigo}`,
  });

  refrescar();
  return { ok: `${caja.codigo} quedó fuera de servicio.` };
}

/**
 * Mete una venta suelta en un turno.
 *
 * Son las que se cobraron en efectivo sin conexión cuando no había ninguna caja
 * abierta: la plata está en el cajón y la venta está registrada, pero no cae en
 * ningún arqueo. Asignarla es una decisión humana —hay que saber en qué cajón
 * quedó ese efectivo— y por eso no se adivina sola.
 */
export async function asignarVentaAlTurno(
  orderId: string,
  sessionId: string,
): Promise<EstadoCajas> {
  const usuario = await requireStaff();

  const resultado = await db.transaction(async (tx) => {
    /*
     * Todo adentro: entre leer la venta y anotar el movimiento no puede
     * colarse un segundo clic, o el mismo efectivo entra dos veces al turno y
     * el arqueo pasa a mostrar un sobrante inventado.
     */
    const [venta] = await tx
      .select({
        id: orders.id,
        numero: orders.numero,
        total: orders.total,
        branchId: orders.branchId,
        cobradaAt: orders.cobradaAt,
      })
      .from(orders)
      .leftJoin(cashMovements, eq(cashMovements.orderId, orders.id))
      .where(and(eq(orders.id, orderId), isNull(cashMovements.id)))
      .limit(1);

    if (!venta) return { error: "Esa venta ya está asignada a un turno." };

    const [turno] = await tx
      .select({ branchId: cashSessions.branchId })
      .from(cashSessions)
      .where(eq(cashSessions.id, sessionId))
      .limit(1);

    if (!turno) return { error: "Ese turno no existe." };

    // Una venta de Casa Central no puede entrar al arqueo de la otra sucursal:
    // el cajón que se cuenta es el de acá.
    if (turno.branchId !== venta.branchId) {
      return { error: "Ese turno es de otra sucursal." };
    }

    await tx.insert(cashMovements).values({
      sessionId,
      tipo: "venta",
      monto: Number(venta.total).toFixed(2),
      motivo: venta.numero,
      orderId: venta.id,
      creadoPor: usuario.userId,
      createdAt: venta.cobradaAt ?? undefined,
    });

    return { numero: venta.numero };
  });

  if ("error" in resultado) return { error: resultado.error };

  await registrarEnBitacora({
    sesion: usuario,
    accion: "editar",
    entidad: "caja",
    descripcion: `Asignó la venta ${resultado.numero} a un turno de caja`,
  });

  refrescar();
  return { ok: `${resultado.numero} quedó en el turno.` };
}
