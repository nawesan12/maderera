"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  accountMovements,
  orderItems,
  orderStatusHistory,
  orders,
  quoteItems,
  quotes,
} from "@/lib/db/schema";
import { requireStaff } from "@/lib/dal/session";
import {
  siguienteNumeroDePedido,
  siguienteNumeroDePresupuesto,
} from "@/lib/dal/numeracion-ventas";
import { avisarCambioDePedido } from "@/lib/whatsapp/avisos";
import { notificarCambioDeEstado } from "@/lib/notificaciones/avisos";
import { liberarReservas, reservarPedido } from "@/lib/inventario/reservas";
import { registrarEnBitacora } from "@/lib/dal/admin/auditoria";

export interface EstadoVenta {
  error?: string;
  ok?: string;
}

function refrescar() {
  revalidatePath("/admin");
  revalidatePath("/admin/pedidos");
  revalidatePath("/admin/presupuestos");
  revalidatePath("/admin/clientes");
}

/* -------------------------------------------------------------------------- */
/* Estados                                                                     */
/* -------------------------------------------------------------------------- */

const ORDEN_PEDIDO = [
  "pendiente",
  "preparando",
  "listo",
  "en-camino",
  "entregado",
] as const;

/**
 * Avanza el pedido al siguiente estado.
 *
 * El recorrido es fijo y de una sola dirección: un pedido no vuelve de
 * "entregado" a "preparando". Para deshacer algo hay que cancelar y rehacer, que
 * deja rastro; permitir retroceder en silencio esconde los errores.
 *
 * Un pedido con envío salta de "listo" a "en camino"; uno de retiro pasa
 * directo a "entregado" cuando el cliente lo busca.
 */
export async function avanzarPedido(id: string): Promise<EstadoVenta> {
  const usuario = await requireStaff();

  const [pedido] = await db
    .select({
      estado: orders.estado,
      tipoEntrega: orders.tipoEntrega,
      numero: orders.numero,
    })
    .from(orders)
    .where(eq(orders.id, id))
    .limit(1);

  if (!pedido) return { error: "No se encontró el pedido." };
  if (pedido.estado === "entregado") {
    return { error: "El pedido ya está entregado." };
  }
  if (pedido.estado === "cancelado") {
    return { error: "El pedido está cancelado." };
  }

  const posicion = ORDEN_PEDIDO.indexOf(pedido.estado as never);
  let siguiente = ORDEN_PEDIDO[posicion + 1];

  if (pedido.estado === "listo" && pedido.tipoEntrega === "retiro") {
    siguiente = "entregado";
  }

  if (!siguiente) return { error: "No hay un estado siguiente." };

  await db.transaction(async (tx) => {
    await tx
      .update(orders)
      .set({ estado: siguiente, updatedAt: new Date() })
      .where(eq(orders.id, id));

    await tx.insert(orderStatusHistory).values({
      orderId: id,
      estado: siguiente,
      createdByUserId: usuario.userId,
    });
  });

  await registrarEnBitacora({
    sesion: usuario,
    accion: "cambiar_estado",
    entidad: "pedido",
    entidadId: id,
    descripcion: `${pedido.numero}: ${pedido.estado} → ${siguiente}`,
  });

  refrescar();

  // Los avisos al cliente salen después de que el cambio quedó guardado, y por
  // fuera de la transacción: si WhatsApp o el correo no responden, el pedido
  // igual avanzó. `after()` además los saca del camino de la respuesta, para
  // que el tablero no espere a un tercero para actualizarse.
  //
  // Los dos canales van en paralelo y con `allSettled`: que falle uno no puede
  // impedir que salga el otro.
  after(async () => {
    await Promise.allSettled([
      avisarCambioDePedido(id, siguiente),
      notificarCambioDeEstado(id, siguiente),
    ]);
  });

  const TEXTO: Record<string, string> = {
    preparando: "en preparación",
    listo: "listo para retirar",
    "en-camino": "en camino",
    entregado: "entregado",
  };

  return { ok: `${pedido.numero} quedó ${TEXTO[siguiente] ?? siguiente}.` };
}

export async function cancelarPedido(
  id: string,
  motivo?: string,
): Promise<EstadoVenta> {
  const usuario = await requireStaff();

  await db.transaction(async (tx) => {
    await tx
      .update(orders)
      .set({ estado: "cancelado", updatedAt: new Date() })
      .where(eq(orders.id, id));

    await tx.insert(orderStatusHistory).values({
      orderId: id,
      estado: "cancelado",
      nota: motivo,
      createdByUserId: usuario.userId,
    });

    // La mercadería vuelve a estar disponible. El físico no se toca: nunca
    // salió del galpón.
    await liberarReservas(tx, id);
  });

  await registrarEnBitacora({
    sesion: usuario,
    accion: "anular",
    entidad: "pedido",
    entidadId: id,
    descripcion: `Canceló el pedido${motivo ? `: ${motivo}` : ""}`,
  });

  refrescar();
  revalidatePath("/admin/stock");
  return { ok: "Pedido cancelado. La mercadería reservada quedó disponible." };
}

const estadoPresupuestoSchema = z.enum([
  "pendiente",
  "revision",
  "enviado",
  "aceptado",
  "rechazado",
  "vencido",
]);

export async function cambiarEstadoPresupuesto(
  id: string,
  estado: string,
): Promise<EstadoVenta> {
  const usuario = await requireStaff();

  const parsed = estadoPresupuestoSchema.safeParse(estado);
  if (!parsed.success) return { error: "Ese estado no existe." };

  await db
    .update(quotes)
    .set({ estado: parsed.data, updatedAt: new Date() })
    .where(eq(quotes.id, id));

  await registrarEnBitacora({
    sesion: usuario,
    accion: "cambiar_estado",
    entidad: "presupuesto",
    entidadId: id,
    descripcion: `Pasó el presupuesto a ${parsed.data}`,
  });

  refrescar();
  return { ok: "Presupuesto actualizado." };
}

/* -------------------------------------------------------------------------- */
/* Presupuesto a pedido                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Convierte un presupuesto aceptado en pedido.
 *
 * Copia las líneas con el precio que tenían: el cliente aceptó ese número, y si
 * el precio de lista subió en el medio, el pedido tiene que respetar lo pactado.
 */
export async function convertirEnPedido(quoteId: string): Promise<EstadoVenta> {
  const usuario = await requireStaff();

  const [presupuesto] = await db
    .select()
    .from(quotes)
    .where(eq(quotes.id, quoteId))
    .limit(1);

  if (!presupuesto) return { error: "No se encontró el presupuesto." };

  const [yaExiste] = await db
    .select({ numero: orders.numero })
    .from(orders)
    .where(eq(orders.quoteId, quoteId))
    .limit(1);

  if (yaExiste) {
    return { error: `Ya se convirtió en el pedido ${yaExiste.numero}.` };
  }

  const items = await db
    .select()
    .from(quoteItems)
    .where(eq(quoteItems.quoteId, quoteId));

  if (items.length === 0) {
    return { error: "El presupuesto no tiene ítems." };
  }

  // Se asigna adentro de la transacción y se usa afuera, en el mensaje.
  let numero = "";

  await db.transaction(async (tx) => {
    // Adentro de la transacción, que es donde el lock de la serie protege algo.
    numero = await siguienteNumeroDePedido(tx);

    const [pedido] = await tx
      .insert(orders)
      .values({
        numero,
        customerId: presupuesto.customerId,
        quoteId: presupuesto.id,
        contactoNombre: presupuesto.contactoNombre,
        contactoEmail: presupuesto.contactoEmail,
        contactoTelefono: presupuesto.contactoTelefono,
        branchId: presupuesto.branchId,
        estado: "pendiente",
        origen: "presupuesto",
        subtotal: presupuesto.subtotal,
        total: presupuesto.total,
        notas: presupuesto.notas,
        createdByUserId: usuario.userId,
      })
      .returning();

    await tx.insert(orderItems).values(
      items.map((item) => ({
        orderId: pedido.id,
        variantId: item.variantId,
        descripcion: item.descripcion,
        unidad: item.unidad,
        cantidad: item.cantidad,
        precioUnitario: item.precioUnitario,
        subtotal: item.subtotal,
        orden: item.orden,
      })),
    );

    await tx.insert(orderStatusHistory).values({
      orderId: pedido.id,
      estado: "pendiente",
      nota: `Generado desde el presupuesto ${presupuesto.numero}`,
      createdByUserId: usuario.userId,
    });

    await tx
      .update(quotes)
      .set({ estado: "aceptado", updatedAt: new Date() })
      .where(eq(quotes.id, quoteId));

    // Desde acá la mercadería tiene dueño y deja de estar disponible para el
    // resto, aunque siga en el galpón hasta que la retiren.
    await reservarPedido(tx, pedido.id);
  });

  await registrarEnBitacora({
    sesion: usuario,
    accion: "crear",
    entidad: "pedido",
    entidadId: quoteId,
    descripcion: `Convirtió el presupuesto ${presupuesto.numero} en el pedido ${numero}`,
  });

  refrescar();
  revalidatePath("/admin/stock");
  return { ok: `Se creó el pedido ${numero}.` };
}

/* -------------------------------------------------------------------------- */
/* Cobro                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Marca un pedido como cobrado.
 *
 * Si el pedido era a cuenta corriente, además baja la deuda del cliente: cobrar
 * en un lado y no en el otro es cómo se desincroniza una cuenta.
 */
export async function marcarPagado(id: string): Promise<EstadoVenta> {
  const usuario = await requireStaff();

  const [pedido] = await db
    .select()
    .from(orders)
    .where(eq(orders.id, id))
    .limit(1);

  if (!pedido) return { error: "No se encontró el pedido." };
  if (pedido.estadoPago === "pagado") return { error: "Ya figura como pagado." };

  await db.transaction(async (tx) => {
    await tx
      .update(orders)
      .set({ estadoPago: "pagado", updatedAt: new Date() })
      .where(eq(orders.id, id));

    if (pedido.medioPago === "cuenta_corriente" && pedido.customerId) {
      await tx.insert(accountMovements).values({
        customerId: pedido.customerId,
        tipo: "pago",
        monto: (-Number(pedido.total)).toFixed(2),
        detalle: `Cobro del pedido ${pedido.numero}`,
        referencia: pedido.numero,
        createdByUserId: usuario.userId,
      });
    }
  });

  await registrarEnBitacora({
    sesion: usuario,
    accion: "cobrar",
    entidad: "pedido",
    entidadId: id,
    descripcion: `Marcó ${pedido.numero} como cobrado (${pedido.medioPago ?? "sin medio"})`,
    detalle: { total: pedido.total, medioPago: pedido.medioPago },
  });

  refrescar();
  return { ok: `${pedido.numero} quedó cobrado.` };
}

/* -------------------------------------------------------------------------- */
/* Alta de presupuesto desde el panel                                          */
/* -------------------------------------------------------------------------- */

/** Quince días, igual que los que nacen en el sitio. */
const DIAS_DE_VALIDEZ = 15;

const lineaPresupuesto = z.object({
  variantId: z.string().uuid().nullable(),
  descripcion: z.string().trim().min(1).max(300),
  unidad: z.string().trim().max(30).default("unidad"),
  cantidad: z.coerce.number().positive().max(1_000_000),
  precioUnitario: z.coerce.number().min(0).max(100_000_000),
});

/**
 * Carga un presupuesto a mano.
 *
 * Faltaba, y era el agujero más visible del circuito comercial: un presupuesto
 * solo podía nacer del sitio. Quien atiende el teléfono —que es como llega la
 * mitad del trabajo de una maderera— no tenía dónde cargarlo, y terminaba
 * anotándolo en un papel que después nadie encontraba.
 *
 * El origen queda en `telefono`, que ya existía en el enum esperando esto.
 */
export async function crearPresupuesto(
  _previo: EstadoVenta,
  formData: FormData,
): Promise<EstadoVenta> {
  const usuario = await requireStaff();

  const cabecera = z
    .object({
      customerId: z.string().uuid().optional(),
      contactoNombre: z.string().trim().min(2, "Poné a nombre de quién va.").max(160),
      contactoTelefono: z.string().trim().max(40).optional(),
      contactoEmail: z.string().trim().email("Revisá el correo.").optional().or(z.literal("")),
      branchId: z.string().uuid().optional(),
      notas: z.string().trim().max(1000).optional(),
      diasValidez: z.coerce.number().int().min(1).max(180).default(DIAS_DE_VALIDEZ),
    })
    .safeParse({
      customerId: (formData.get("customerId") as string) || undefined,
      contactoNombre: formData.get("contactoNombre"),
      contactoTelefono: (formData.get("contactoTelefono") as string) || undefined,
      contactoEmail: (formData.get("contactoEmail") as string) || undefined,
      branchId: (formData.get("branchId") as string) || undefined,
      notas: (formData.get("notas") as string) || undefined,
      diasValidez: formData.get("diasValidez") || DIAS_DE_VALIDEZ,
    });

  if (!cabecera.success) {
    return { error: cabecera.error.issues[0]?.message ?? "Revisá los datos." };
  }

  const crudas = formData.getAll("linea").map(String);
  const lineas: z.infer<typeof lineaPresupuesto>[] = [];

  for (const cruda of crudas) {
    const parseada = lineaPresupuesto.safeParse(JSON.parse(cruda));
    if (!parseada.success) {
      return { error: "Hay una línea con datos incompletos." };
    }
    lineas.push(parseada.data);
  }

  if (lineas.length === 0) {
    return { error: "Agregá al menos un producto." };
  }

  const subtotal = lineas.reduce(
    (suma, l) => suma + l.cantidad * l.precioUnitario,
    0,
  );

  const validoHasta = new Date();
  validoHasta.setDate(validoHasta.getDate() + cabecera.data.diasValidez);

  let numero = "";

  await db.transaction(async (tx) => {
    numero = await siguienteNumeroDePresupuesto(tx);

    const [presupuesto] = await tx
      .insert(quotes)
      .values({
        numero,
        customerId: cabecera.data.customerId ?? null,
        contactoNombre: cabecera.data.contactoNombre,
        contactoEmail: cabecera.data.contactoEmail || null,
        contactoTelefono: cabecera.data.contactoTelefono ?? null,
        branchId: cabecera.data.branchId ?? null,
        estado: "pendiente",
        origen: "telefono",
        subtotal: subtotal.toFixed(2),
        total: subtotal.toFixed(2),
        notas: cabecera.data.notas ?? null,
        asesor: usuario.name,
        validoHasta,
        createdByUserId: usuario.userId,
      })
      .returning({ id: quotes.id });

    await tx.insert(quoteItems).values(
      lineas.map((linea, orden) => ({
        quoteId: presupuesto.id,
        variantId: linea.variantId,
        descripcion: linea.descripcion,
        unidad: linea.unidad,
        cantidad: linea.cantidad.toFixed(2),
        precioUnitario: linea.precioUnitario.toFixed(2),
        subtotal: (linea.cantidad * linea.precioUnitario).toFixed(2),
        orden,
      })),
    );
  });

  await registrarEnBitacora({
    sesion: usuario,
    accion: "crear",
    entidad: "presupuesto",
    entidadId: numero,
    descripcion: `Cargó el presupuesto ${numero} para ${cabecera.data.contactoNombre}`,
  });

  refrescar();
  return { ok: `Se creó el presupuesto ${numero}.` };
}
