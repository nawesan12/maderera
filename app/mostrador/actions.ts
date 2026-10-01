"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { moneda } from "@/lib/formato";
import { medioDeMostradorSchema, pagoDeMostradorSchema } from "@/lib/mostrador/esquemas";
import { db } from "@/lib/db";
import { branches, cashMovements, cashSessions } from "@/lib/db/schema";
import { requireStaff } from "@/lib/dal/session";
import { registrarEnBitacora } from "@/lib/dal/admin/auditoria";
import { cajasConPendientes } from "@/lib/dal/admin/cajas-fisicas";
import {
  registrarVentaDeMostrador,
  type MedioDeMostrador,
} from "@/lib/mostrador/venta";
import { anularVentaDeMostrador } from "@/lib/mostrador/anular";
import {
  nombreDeLaDiferencia,
  TOLERANCIA_ARQUEO,
} from "@/lib/mostrador/arqueo";
import { emitirParaLaVenta, letraQueSaldria } from "@/lib/mostrador/comprobante";
import { ErrorDeEntrega, remitoDeConstancia } from "@/lib/entregas";
import { siguienteNumeroDePresupuesto } from "@/lib/dal/numeracion-ventas";
import { leerDocumento } from "@/lib/clientes/documento";
import { clientePorDocumento, crearClienteRapido } from "@/lib/clientes/alta";
import { ErrorDeCobro, emitirRecibo } from "@/lib/cobros/recibo";
import { leerPartes } from "@/lib/cobros/leer";
import { saldoDelCliente } from "@/lib/dal/historial-cliente";
import { notificarRecibo } from "@/lib/notificaciones/cobros";
import { customers, quoteItems, quotes } from "@/lib/db/schema";
import {
  buscarClienteEnMostrador,
  clientesRecientesDeLaSucursal,
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
  // Solo la intención: cuánto stock descuenta lo decide el servidor.
  presentacion: z.enum(["media_largo", "media_ancho"]).nullable().optional(),
});

const pagoSchema = pagoDeMostradorSchema;

const ventaSchema = z.object({
  clave: z.string().uuid(),
  branchId: z.string().uuid(),
  lineas: z.array(lineaSchema).min(1),
  customerId: z.string().uuid().nullable(),
  contactoNombre: z.string().min(1),
  contactoTelefono: z.string().nullable().optional(),
  medioPago: medioDeMostradorSchema,
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
  /*
   * El corte que se vendió, si se vendió uno.
   *
   * Se valida acá y no solo en la pantalla porque una acción de servidor es una
   * dirección pública. El trabajo nace dentro de la misma transacción que la
   * venta: ver `CorteDeMostrador` en `lib/mostrador/venta.ts`.
   */
  corte: z
    .object({
      variantId: z.string().uuid().nullable(),
      materialDescripcion: z.string().trim().min(2).max(200),
      cantoDescripcion: z.string().trim().max(120).nullable(),
      /** La medida de la placa, para que el taller rehaga el mismo plano. */
      placaLargoMm: z.coerce.number().int().positive().max(6000).nullable(),
      placaAnchoMm: z.coerce.number().int().positive().max(6000).nullable(),
      /** De qué salió: placa entera (null) o media, y en qué sentido. */
      mitad: z.enum(["largo", "ancho"]).nullable(),
      placas: z.coerce.number().int().min(1).max(999),
      pasadas: z.coerce.number().int().min(0).max(9999),
      acomodoManual: z.string().max(20_000).nullable(),
      anchoSierraMm: z.number().min(0.5).max(10).nullable().optional(),
      piezas: z
        .array(
          z.object({
            largoMm: z.coerce.number().int().positive().max(10_000),
            anchoMm: z.coerce.number().int().positive().max(10_000),
            cantidad: z.coerce.number().int().positive().max(999),
            respetaVeta: z.coerce.number().int().min(0).max(1),
            cantoLargo: z.coerce.number().int().min(0).max(2),
            cantoAncho: z.coerce.number().int().min(0).max(2),
            etiqueta: z.string().trim().max(120).nullable(),
            aclaracion: z.string().trim().max(200).nullable(),
          }),
        )
        .min(1)
        .max(500),
    })
    .optional(),
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

  /*
   * El fondo de cambio de la sucursal.
   *
   * Abrir con menos que la base no se prohíbe —puede pasar, y el mostrador
   * tiene que poder empezar a cobrar igual— pero se avisa: es plata que hay que
   * reponer antes de que llegue el primero que pague con un billete grande.
   */
  const [sucursal] = await db
    .select({ fondoBase: branches.fondoBase })
    .from(branches)
    .where(eq(branches.id, branchId))
    .limit(1);

  const base = Number(sucursal?.fondoBase ?? 0);
  const faltaCambio = base > 0 && fondoInicial < base;

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

  return {
    ok: faltaCambio
      ? `Caja abierta, pero el fondo quedó por debajo de la base de $${base.toFixed(2)}. Reponé el cambio.`
      : "Caja abierta.",
  };
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

  /*
   * Un retiro no puede dejar el cajón por debajo del fondo de cambio.
   *
   * Es el pedido de la clienta: «siempre se les deja cambio a los mostradores,
   * no puede quedar menos que la base». Acá sí se rechaza en vez de avisar,
   * porque el retiro es voluntario y se puede hacer por menos: dejar el
   * mostrador sin cambio a media tarde le cuesta ventas al negocio.
   */
  if (tipo === "retiro") {
    const [turno] = await db
      .select({
        esperado: sql<string>`coalesce(sum(${cashMovements.monto}), 0)`,
        fondoBase: branches.fondoBase,
      })
      .from(cashSessions)
      .innerJoin(branches, eq(branches.id, cashSessions.branchId))
      .leftJoin(cashMovements, eq(cashMovements.sessionId, cashSessions.id))
      .where(eq(cashSessions.id, sessionId))
      .groupBy(cashSessions.id, branches.fondoBase)
      .limit(1);

    const base = Number(turno?.fondoBase ?? 0);
    const enCaja = Number(turno?.esperado ?? 0);

    if (base > 0 && enCaja - monto < base) {
      const disponible = Math.max(0, enCaja - base);
      return {
        error:
          disponible > 0
            ? `Ese retiro deja el cajón sin el cambio de la base ($${base.toFixed(2)}). Podés retirar hasta $${disponible.toFixed(2)}.`
            : `No se puede retirar: en el cajón hay $${enCaja.toFixed(2)} y la base de cambio es $${base.toFixed(2)}.`,
      };
    }
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
  const comoSeLlama = nombreDeLaDiferencia(diferencia);

  /*
   * Una diferencia sin explicar no se guarda.
   *
   * Es el otro lado del pedido de la clienta —«hay que tener ojo que al hacer
   * el arqueo no falte plata o sobre»—: el sistema no puede impedir que falte,
   * pero sí puede impedir que se cierre sin que nadie diga qué pasó. Mañana,
   * cuando alguien revise el mes, la nota es lo único que va a estar.
   */
  if (Math.abs(diferencia) > TOLERANCIA_ARQUEO && !notas.trim()) {
    return {
      error: `Hay un ${comoSeLlama} de $${Math.abs(diferencia).toFixed(2)}. Escribí qué pasó antes de cerrar: mañana nadie se va a acordar.`,
    };
  }

  // Y el cambio para mañana. No bloquea el cierre —la plata está o no está—
  // pero se dice, que es cuando todavía se puede reponer.
  const [sucursalDelTurno] = await db
    .select({ fondoBase: branches.fondoBase })
    .from(branches)
    .innerJoin(cashSessions, eq(cashSessions.branchId, branches.id))
    .where(eq(cashSessions.id, sessionId))
    .limit(1);

  const base = Number(sucursalDelTurno?.fondoBase ?? 0);
  const sinCambio = base > 0 && contado < base;

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
      (comoSeLlama === "sin diferencia"
        ? ", sin diferencia"
        : `, ${comoSeLlama} de $${Math.abs(diferencia).toFixed(2)}`) +
      (notas.trim() ? `: ${notas.trim()}` : ""),
  });

  refrescar();

  const cierre =
    comoSeLlama === "sin diferencia"
      ? "Caja cerrada sin diferencia."
      : `Caja cerrada con un ${comoSeLlama} de $${Math.abs(diferencia).toFixed(2)}.`;

  return {
    ok: sinCambio
      ? `${cierre} Ojo: quedan $${contado.toFixed(2)} en el cajón y la base de cambio es $${base.toFixed(2)}.`
      : cierre,
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

/** Los últimos clientes atendidos en la sucursal, para la caja vacía. */
export async function clientesRecientes(branchId: string) {
  await requireStaff();
  if (!z.string().uuid().safeParse(branchId).success) return [];
  return clientesRecientesDeLaSucursal(branchId);
}

export type ResultadoAltaRapida =
  | { ok: true; cliente: Awaited<ReturnType<typeof crearClienteRapido>> }
  | { ok: false; error: string; existente?: { id: string; nombre: string } };

/**
 * Alta de un cliente sin salir de la venta.
 *
 * De la clienta (30/9/2026): «hacer eficiencia al momento de cargar clientes
 * en caja». Hasta acá un cliente nuevo obligaba a ir al panel, cargar la ficha
 * y volver a buscarlo, con la persona esperando. Ahora se crea con lo justo
 * —nombre, documento, IVA, teléfono, rubro— y queda elegido.
 *
 * Si el documento ya está en otra ficha, **no** se crea: se ofrece la que
 * existe. Una segunda ficha de la misma persona parte su cuenta corriente en
 * dos, y eso se descubre recién cuando se le reclama una deuda.
 */
export async function crearClienteEnMostrador(datos: {
  nombre: string;
  documento: string;
  condicionIva: string;
  telefono?: string;
  rubro?: string;
}): Promise<ResultadoAltaRapida> {
  const usuario = await requireStaff();

  const parsed = z
    .object({
      nombre: z.string().trim().min(2, "Poné el nombre o la razón social.").max(160),
      documento: z.string().trim().max(20),
      condicionIva: z.enum([
        "responsable_inscripto",
        "monotributista",
        "exento",
        "consumidor_final",
        "no_categorizado",
      ]),
      telefono: z.string().trim().max(40).optional(),
      rubro: z.string().trim().max(40).optional(),
    })
    .safeParse(datos);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Revisá los datos." };
  }

  const documento = leerDocumento(parsed.data.documento);
  if ("error" in documento) return { ok: false, error: documento.error };

  // A una factura A le hace falta el CUIT: sin él, la venta va a fallar al
  // cobrar, con el cliente ya elegido.
  if (parsed.data.condicionIva === "responsable_inscripto" && documento.tipo !== "cuit") {
    return { ok: false, error: "Un responsable inscripto necesita el CUIT para la factura A." };
  }

  const existente = await clientePorDocumento(db, documento);
  if (existente) {
    return {
      ok: false,
      error: `Ese documento ya es de ${existente.nombre}.`,
      existente,
    };
  }

  const cliente = await crearClienteRapido(db, {
    nombre: parsed.data.nombre,
    documento,
    condicionIva: parsed.data.condicionIva,
    telefono: parsed.data.telefono,
    rubro: parsed.data.rubro,
    notas: "Ficha creada en el mostrador.",
  });

  await registrarEnBitacora({
    sesion: usuario,
    accion: "crear",
    entidad: "cliente",
    entidadId: cliente.id,
    descripcion: `Dio de alta a ${cliente.nombre} desde el mostrador`,
  });

  revalidatePath("/admin/clientes");
  return { ok: true, cliente };
}

/** Un cliente por id, con lo que necesita la venta. Lo usa «usar el existente». */
export async function clientePorId(id: string) {
  await requireStaff();
  if (!z.string().uuid().safeParse(id).success) return null;
  const [fila] = await db
    .select({
      id: customers.id,
      nombre: customers.nombre,
      razonSocial: customers.razonSocial,
      cuit: customers.cuit,
      condicionIva: customers.condicionIva,
      estado: customers.estado,
      priceListId: customers.priceListId,
      direccion: customers.direccion,
    })
    .from(customers)
    .where(eq(customers.id, id))
    .limit(1);
  return fila ?? null;
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
        presentacion: linea.presentacion ?? null,
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

/** Lo que debe un cliente, para ofrecer cobrarle la cuenta en el mostrador. */
export async function saldoDeCuenta(customerId: string): Promise<number> {
  await requireStaff();
  if (!z.string().uuid().safeParse(customerId).success) return 0;
  return saldoDelCliente(customerId);
}

export interface EstadoCobroDeCuenta {
  ok?: string;
  error?: string;
  receiptId?: string;
  numero?: string;
}

/**
 * Cobra la cuenta corriente de un cliente en el mostrador y emite el recibo.
 *
 * Hasta acá no había cómo: el cliente que venía a pagar lo que debía tenía que
 * esperar que alguien abriera la ficha en el panel. Ahora se cobra desde la
 * misma pantalla de venta, con los mismos medios —efectivo, transferencia,
 * cheques—, el efectivo entra al turno abierto y el recibo sale impreso.
 *
 * Usa `emitirRecibo`, que es la única forma de registrar un pago.
 */
export async function cobrarCuentaEnMostrador(
  _previo: EstadoCobroDeCuenta,
  formData: FormData,
): Promise<EstadoCobroDeCuenta> {
  const usuario = await requireStaff();

  const ids = z
    .object({ customerId: z.string().uuid(), branchId: z.string().uuid() })
    .safeParse({ customerId: formData.get("customerId"), branchId: formData.get("branchId") });
  if (!ids.success) return { error: "Falta el cliente." };

  const leidas = leerPartes(formData.get("partes"));
  if ("error" in leidas) return { error: leidas.error };

  try {
    const recibo = await db.transaction(async (tx) => {
      const hayEfectivo = leidas.partes.some((p) => p.medio === "efectivo");
      const [turno] = await tx
        .select({ id: cashSessions.id })
        .from(cashSessions)
        .where(and(eq(cashSessions.branchId, ids.data.branchId), eq(cashSessions.estado, "abierta")))
        .limit(1);

      // El efectivo de un cobro es plata en el cajón: sin turno abierto no
      // tiene dónde entrar y el arqueo del día no cerraría.
      if (hayEfectivo && !turno) {
        throw new ErrorDeCobro("No hay caja abierta: abrila para cobrar en efectivo.");
      }

      return emitirRecibo(tx, {
        customerId: ids.data.customerId,
        branchId: ids.data.branchId,
        origen: "mostrador",
        concepto: "Pago de cuenta corriente",
        partes: leidas.partes,
        caja: turno ? { turnoId: turno.id } : null,
        usuarioId: usuario.userId,
      });
    });

    await registrarEnBitacora({
      sesion: usuario,
      accion: "cobrar",
      entidad: "cliente",
      entidadId: ids.data.customerId,
      descripcion: `Cobró la cuenta en el mostrador con el recibo ${recibo.numero} por ${recibo.total.toFixed(2)}`,
      detalle: { receiptId: recibo.receiptId },
    });

    after(() => notificarRecibo(recibo.receiptId));
    revalidatePath("/admin/clientes");
    revalidatePath("/admin/caja");

    return {
      ok: `Recibo ${recibo.numero} por ${moneda.format(recibo.total)}.`,
      receiptId: recibo.receiptId,
      numero: recibo.numero,
    };
  } catch (error) {
    if (error instanceof ErrorDeCobro) return { error: error.message };
    throw error;
  }
}
