"use server";

import { revalidatePath } from "next/cache";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { cashMovements, cashSessions } from "@/lib/db/schema";
import { requireStaff } from "@/lib/dal/session";
import { registrarEnBitacora } from "@/lib/dal/admin/auditoria";
import { cajasConPendientes } from "@/lib/dal/admin/cajas-fisicas";
import {
  registrarVentaDeMostrador,
  type MedioDeMostrador,
} from "@/lib/mostrador/venta";
import { anularVentaDeMostrador } from "@/lib/mostrador/anular";
import { emitirParaLaVenta, letraQueSaldria } from "@/lib/mostrador/comprobante";
import { ErrorDeEntrega, remitoDeConstancia } from "@/lib/entregas";
import { siguienteNumeroDePresupuesto } from "@/lib/dal/numeracion-ventas";
import { customers, quoteItems, quotes } from "@/lib/db/schema";
import {
  buscarClienteEnMostrador,
  buscarParaMostrador,
  preciosPara,
} from "@/lib/mostrador/buscar";

export interface EstadoMostrador {
  error?: string;
  ok?: string;
  /** Número del pedido recién hecho, para poder ofrecer el comprobante. */
  numero?: string;
  orderId?: string;
  invoiceId?: string;
  /**
   * Qué salió mal con el comprobante, sobre una venta que igual quedó hecha.
   * Es distinto de `error`: la venta está, lo que falta es el papel.
   */
  avisoFiscal?: string;
  /**
   * La venta se frenó por cuenta corriente, pero se puede confirmar igual.
   *
   * La pantalla ofrece "Cobrar igual" en vez de dejar al vendedor sin salida
   * con un cliente enfrente. Reenvía la misma venta con `autorizado`.
   */
  requiereAutorizacion?: boolean;
}

const lineaSchema = z.object({
  variantId: z.string().uuid().nullable(),
  descripcion: z.string().min(1),
  unidad: z.string().min(1),
  cantidad: z.number().positive(),
  precioUnitario: z.number().min(0),
});

const pagoSchema = z.object({
  medio: z.enum([
    "efectivo",
    "debito",
    "credito",
    "transferencia",
    "cuenta_corriente",
  ]),
  importe: z.number().positive(),
  /** Lote y cupón de la terminal: el "código de que se pagó con qué". */
  nroLote: z.string().max(20).nullable().optional(),
  nroCupon: z.string().max(20).nullable().optional(),
  tarjeta: z.string().max(40).nullable().optional(),
});

const ventaSchema = z.object({
  clave: z.string().uuid(),
  branchId: z.string().uuid(),
  lineas: z.array(lineaSchema).min(1),
  customerId: z.string().uuid().nullable(),
  contactoNombre: z.string().min(1),
  contactoTelefono: z.string().nullable().optional(),
  medioPago: z.enum([
    "efectivo",
    "debito",
    "credito",
    "transferencia",
    "cuenta_corriente",
  ]),
  /** Cómo se pagó, si se partió en más de un medio. Vacío = todo por medioPago. */
  pagos: z.array(pagoSchema).max(4).optional(),
  /** La venta queda en acopio: se cobra, el stock se reserva y no se entrega. */
  acopio: z.boolean().optional(),
  /** Qué papel se lleva el cliente. La letra no se elige: se deriva. */
  comprobante: z.enum(["interno", "fiscal"]).default("interno"),
  /** CUIT tipeado en el momento, para facturar a alguien sin ficha. */
  cuit: z.string().nullable().optional(),
  descuento: z.number().min(0).optional(),
  descuentoMotivo: z.string().nullable().optional(),
  notas: z.string().nullable().optional(),
  /** El vendedor ya vio el aviso de cuenta corriente y decidió seguir. */
  autorizado: z.boolean().optional(),
});

function refrescar() {
  revalidatePath("/mostrador");
  revalidatePath("/admin");
  revalidatePath("/admin/pedidos");
  revalidatePath("/admin/pagos");
  revalidatePath("/admin/stock");
}

/* -------------------------------------------------------------------------- */
/* Caja                                                                        */
/* -------------------------------------------------------------------------- */

export async function abrirCaja(
  branchId: string,
  fondoInicial: number,
): Promise<EstadoMostrador> {
  const usuario = await requireStaff();

  if (!Number.isFinite(fondoInicial) || fondoInicial < 0) {
    return { error: "El fondo inicial no puede ser negativo." };
  }

  try {
    await db.transaction(async (tx) => {
      const [sesion] = await tx
        .insert(cashSessions)
        .values({ branchId, abiertaPor: usuario.userId })
        .returning({ id: cashSessions.id });

      // El fondo va como movimiento y no como columna: así el efectivo esperado
      // es siempre la misma suma, sin excepciones que alguien tenga que
      // recordar.
      await tx.insert(cashMovements).values({
        sessionId: sesion.id,
        tipo: "apertura",
        monto: fondoInicial.toFixed(2),
        motivo: "Fondo inicial",
        creadoPor: usuario.userId,
      });
    });
  } catch (error) {
    // El índice único parcial es el que garantiza un turno por sucursal. Si dos
    // personas abren a la vez, una gana y a la otra se le explica por qué.
    if (String(error).includes("cash_sessions_una_abierta_por_sucursal")) {
      return { error: "Ya hay una caja abierta en esta sucursal." };
    }
    throw error;
  }

  await registrarEnBitacora({
    sesion: usuario,
    accion: "crear",
    entidad: "caja",
    descripcion: `Abrió la caja con un fondo de $${fondoInicial.toFixed(2)}`,
  });

  refrescar();
  return { ok: "Caja abierta." };
}

export async function registrarMovimientoDeCaja(
  sessionId: string,
  tipo: "ingreso" | "retiro",
  monto: number,
  motivo: string,
): Promise<EstadoMostrador> {
  const usuario = await requireStaff();

  if (!Number.isFinite(monto) || monto <= 0) {
    return { error: "El monto tiene que ser mayor a cero." };
  }
  if (!motivo.trim()) {
    return { error: "Poné el motivo: un movimiento sin explicación no se puede revisar después." };
  }

  await db.insert(cashMovements).values({
    sessionId,
    tipo,
    // El signo lo pone el tipo. Guardarlo en el monto es lo que hace que el
    // efectivo esperado sea una suma sola.
    monto: (tipo === "retiro" ? -monto : monto).toFixed(2),
    motivo: motivo.trim(),
    creadoPor: usuario.userId,
  });

  await registrarEnBitacora({
    sesion: usuario,
    accion: "crear",
    entidad: "caja",
    descripcion: `${tipo === "retiro" ? "Retiró" : "Ingresó"} $${monto.toFixed(2)}: ${motivo.trim()}`,
  });

  refrescar();
  return { ok: tipo === "retiro" ? "Retiro registrado." : "Ingreso registrado." };
}

export async function cerrarCaja(
  sessionId: string,
  contado: number,
  notas: string,
): Promise<EstadoMostrador> {
  const usuario = await requireStaff();

  if (!Number.isFinite(contado) || contado < 0) {
    return { error: "Lo contado no puede ser negativo." };
  }

  /*
   * No se cierra con ventas colgando.
   *
   * Si una caja del mostrador tiene ventas sin subir, la plata de esas ventas
   * ya está en el cajón pero todavía no está en el turno. Cerrar ahora daría un
   * sobrante que después, cuando vuelva la conexión, se convierte en un turno
   * cerrado con el esperado corrido. Es un minuto de espera contra una noche de
   * buscar una diferencia que nadie generó.
   */
  const [{ branchId }] = await db
    .select({ branchId: cashSessions.branchId })
    .from(cashSessions)
    .where(eq(cashSessions.id, sessionId))
    .limit(1);

  const colgadas = await cajasConPendientes(branchId);

  if (colgadas.length > 0) {
    const detalle = colgadas
      .map((c) => `${c.codigo} (${c.pendientes})`)
      .join(", ");
    return {
      error: `Hay ventas sin subir en ${detalle}. Esperá a que la caja recupere conexión: esa plata está en el cajón pero todavía no en el turno.`,
    };
  }

  const [{ esperado }] = await db
    .select({
      esperado: sql<string>`coalesce(sum(${cashMovements.monto}), 0)`,
    })
    .from(cashMovements)
    .where(eq(cashMovements.sessionId, sessionId));

  const diferencia = contado - Number(esperado);

  const actualizadas = await db
    .update(cashSessions)
    .set({
      estado: "cerrada",
      cerradaPor: usuario.userId,
      cerradaAt: new Date(),
      // Se guarda lo contado tal cual, sin corregirlo: la diferencia es el dato
      // que interesa y pisarla sería tapar lo único que esto sirve para ver.
      contado: contado.toFixed(2),
      notas: notas.trim() || null,
    })
    .where(
      and(eq(cashSessions.id, sessionId), eq(cashSessions.estado, "abierta")),
    )
    .returning({ id: cashSessions.id });

  if (actualizadas.length === 0) {
    return { error: "Esa caja ya estaba cerrada." };
  }

  await registrarEnBitacora({
    sesion: usuario,
    accion: "cambiar_estado",
    entidad: "caja",
    descripcion:
      `Cerró la caja. Esperado $${Number(esperado).toFixed(2)}, contado $${contado.toFixed(2)}` +
      (Math.abs(diferencia) >= 0.01
        ? `, diferencia $${diferencia.toFixed(2)}`
        : ", sin diferencia"),
  });

  refrescar();
  return {
    ok:
      Math.abs(diferencia) < 0.01
        ? "Caja cerrada sin diferencia."
        : `Caja cerrada con una diferencia de $${diferencia.toFixed(2)}.`,
  };
}

/* -------------------------------------------------------------------------- */
/* Venta                                                                       */
/* -------------------------------------------------------------------------- */

export async function cobrarVenta(
  datos: z.input<typeof ventaSchema>,
): Promise<EstadoMostrador> {
  const usuario = await requireStaff();

  const parsed = ventaSchema.safeParse(datos);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos de la venta incompletos." };
  }

  const resultado = await registrarVentaDeMostrador({
    ...parsed.data,
    medioPago: parsed.data.medioPago as MedioDeMostrador,
    usuarioId: usuario.userId,
  });

  if (!resultado.ok) {
    return {
      error: resultado.error,
      requiereAutorizacion: resultado.requiereAutorizacion,
    };
  }

  // Solo se registra la venta nueva. Si la clave ya existía es el segundo toque
  // del mismo botón, y anotarlo dos veces en la bitácora contaría dos ventas.
  if (resultado.nueva) {
    await registrarEnBitacora({
      sesion: usuario,
      accion: "crear",
      entidad: "pedido",
      descripcion: `Venta de mostrador ${resultado.numero} por $${resultado.total.toFixed(2)}`,
    });
  }

  /*
   * El comprobante va acá, fuera de la transacción de la venta y solo si la
   * venta es nueva. La plata ya está en la caja: si ARCA no contesta, queda una
   * venta sin comprobante —que se resuelve después desde Facturación— y no una
   * venta deshecha, que no se resuelve nunca.
   */
  let avisoFiscal: string | undefined;
  let invoiceId: string | undefined;

  if (parsed.data.comprobante === "fiscal" && resultado.nueva) {
    const fiscal = await emitirParaLaVenta({
      orderId: resultado.orderId,
      customerId: parsed.data.customerId,
      receptorNombre: parsed.data.contactoNombre,
      cuit: parsed.data.cuit ?? null,
      // Las de la venta, con el descuento ya repartido.
      lineas: resultado.lineas,
      usuarioId: usuario.userId,
    });
    avisoFiscal = fiscal.autorizado ? undefined : fiscal.aviso;
    invoiceId = fiscal.invoiceId;
  }

  refrescar();
  return {
    ok: resultado.nueva
      ? `Venta ${resultado.numero} registrada.`
      : `Esa venta ya estaba registrada como ${resultado.numero}.`,
    numero: resultado.numero,
    orderId: resultado.orderId,
    invoiceId,
    avisoFiscal,
  };
}

/* -------------------------------------------------------------------------- */
/* Búsqueda                                                                    */
/* -------------------------------------------------------------------------- */

export async function buscarEnMostrador(texto: string, branchId: string, customerId: string | null) {
  await requireStaff();
  return buscarParaMostrador(texto, branchId, customerId);
}

export async function buscarClientes(texto: string) {
  await requireStaff();
  return buscarClienteEnMostrador(texto);
}

/**
 * Los precios que le corresponden a un cliente para las variantes ya cargadas.
 *
 * La pantalla la usa cuando se identifica al cliente con la venta empezada.
 */
export async function preciosDelCliente(
  variantIds: string[],
  customerId: string | null,
) {
  await requireStaff();
  return preciosPara(variantIds, customerId);
}

/** Qué letra saldría con el cliente y el CUIT que hay en pantalla. */
export async function letraDelComprobante(
  customerId: string | null,
  cuit: string | null,
) {
  await requireStaff();
  return letraQueSaldria(customerId, cuit);
}

/**
 * Anula una venta del mostrador.
 *
 * Si la venta tenía factura, esto **no** emite la nota de crédito: avisa que
 * hace falta y deja el enlace. Emitir un comprobante es una decisión de alguien,
 * no un efecto secundario de tocar un botón acá.
 */
/* -------------------------------------------------------------------------- */
/* Remito y presupuesto                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Emite el remito de una venta que acaba de salir por el mostrador.
 *
 * Es el papel del retiro: qué se llevó la persona y si pagó. El stock no se
 * toca —ya se descontó al cobrar—; para un acopio, el retiro se registra desde
 * la ficha del pedido, que es lo que descuenta.
 */
export async function emitirRemitoDeVenta(
  orderId: string,
  receptorNombre?: string | null,
): Promise<EstadoMostrador & { remitoId?: string; remitoNumero?: string }> {
  const usuario = await requireStaff();

  try {
    const remito = await remitoDeConstancia({
      orderId,
      receptorNombre,
      usuarioId: usuario.userId,
    });

    await registrarEnBitacora({
      sesion: usuario,
      accion: "crear",
      entidad: "remito",
      entidadId: remito.id,
      descripcion: `Remito ${remito.numero} emitido desde el mostrador`,
    });

    refrescar();
    return {
      ok: `Remito ${remito.numero} emitido.`,
      remitoId: remito.id,
      remitoNumero: remito.numero,
    };
  } catch (error) {
    if (error instanceof ErrorDeEntrega) return { error: error.message };
    throw error;
  }
}

const presupuestoMostradorSchema = z.object({
  branchId: z.string().uuid(),
  lineas: z.array(lineaSchema).min(1),
  customerId: z.string().uuid().nullable(),
  contactoNombre: z.string().min(1),
  contactoTelefono: z.string().nullable().optional(),
  notas: z.string().max(1000).nullable().optional(),
});

/** Cuántos días vale un presupuesto de mostrador. Igual que los del panel. */
const DIAS_DE_VALIDEZ_MOSTRADOR = 15;

/**
 * Arma un presupuesto con lo que hay cargado en el mostrador, sin cobrar.
 *
 * Es el pedido 82 de la clienta: quien pregunta un precio en el salón se lleva
 * el papel, con los mismos renglones que ya estaban tipeados para la venta. No
 * mueve stock ni caja; queda en la cola de presupuestos con origen "mostrador".
 */
export async function emitirPresupuestoDeMostrador(
  datos: z.input<typeof presupuestoMostradorSchema>,
): Promise<EstadoMostrador & { quoteId?: string }> {
  const usuario = await requireStaff();

  const parsed = presupuestoMostradorSchema.safeParse(datos);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos incompletos." };
  }

  const d = parsed.data;
  const subtotal = d.lineas.reduce(
    (suma, l) => suma + Math.round(l.cantidad * l.precioUnitario * 100) / 100,
    0,
  );

  // El vendedor asignado al cliente, si lo hay: el papel lo nombra.
  let sellerId: string | null = null;
  if (d.customerId) {
    const [ficha] = await db
      .select({ sellerId: customers.sellerId })
      .from(customers)
      .where(eq(customers.id, d.customerId))
      .limit(1);
    sellerId = ficha?.sellerId ?? null;
  }

  const validoHasta = new Date();
  validoHasta.setDate(validoHasta.getDate() + DIAS_DE_VALIDEZ_MOSTRADOR);

  let numero = "";
  let quoteId = "";

  await db.transaction(async (tx) => {
    numero = await siguienteNumeroDePresupuesto(tx);

    const [presupuesto] = await tx
      .insert(quotes)
      .values({
        numero,
        customerId: d.customerId,
        contactoNombre: d.contactoNombre,
        contactoTelefono: d.contactoTelefono ?? null,
        branchId: d.branchId,
        estado: "enviado",
        origen: "mostrador",
        subtotal: subtotal.toFixed(2),
        total: subtotal.toFixed(2),
        notas: d.notas ?? null,
        asesor: usuario.name,
        sellerId,
        validoHasta,
        createdByUserId: usuario.userId,
      })
      .returning({ id: quotes.id });

    quoteId = presupuesto.id;

    await tx.insert(quoteItems).values(
      d.lineas.map((linea, orden) => ({
        quoteId: presupuesto.id,
        variantId: linea.variantId,
        descripcion: linea.descripcion,
        unidad: linea.unidad,
        cantidad: linea.cantidad.toFixed(2),
        precioUnitario: linea.precioUnitario.toFixed(2),
        subtotal: (Math.round(linea.cantidad * linea.precioUnitario * 100) / 100).toFixed(2),
        orden,
      })),
    );
  });

  await registrarEnBitacora({
    sesion: usuario,
    accion: "crear",
    entidad: "presupuesto",
    entidadId: numero,
    descripcion: `Presupuesto ${numero} emitido desde el mostrador para ${d.contactoNombre}`,
  });

  revalidatePath("/admin/presupuestos");
  return { ok: `Presupuesto ${numero} emitido.`, quoteId };
}

export async function anularVenta(
  orderId: string,
  motivo: string,
): Promise<EstadoMostrador> {
  const usuario = await requireStaff();

  const r = await anularVentaDeMostrador(orderId, motivo, usuario.userId);
  if (!r.ok) return { error: r.error };

  await registrarEnBitacora({
    sesion: usuario,
    accion: "anular",
    entidad: "pedido",
    entidadId: orderId,
    descripcion: `Anuló una venta de mostrador: ${motivo.trim()}`,
  });

  refrescar();
  return {
    ok: "Venta anulada.",
    avisoFiscal: r.facturaPendiente
      ? "La venta tenía factura. Emitile la nota de crédito desde Facturación."
      : undefined,
  };
}
