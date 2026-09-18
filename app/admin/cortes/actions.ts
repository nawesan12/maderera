"use server";

import { revalidatePath } from "next/cache";
import type { PiezaFijada } from "@/lib/cortes/plano";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { z } from "zod";
import { branches, cuttingItems, cuttingOrders } from "@/lib/db/schema";
import { siguienteNumeroDeCorte } from "@/lib/dal/numeracion-ventas";
import { requireStaff } from "@/lib/dal/session";
import { registrarEnBitacora } from "@/lib/dal/admin/auditoria";

export interface EstadoCorte {
  error?: string;
  ok?: string;
}

const ORDEN = ["en-cola", "en-proceso", "terminado", "retirado"] as const;

/** Avanza el corte al siguiente paso de la cola. */
export async function avanzarCorte(id: string): Promise<EstadoCorte> {
  const usuario = await requireStaff();

  const [corte] = await db
    .select({ estado: cuttingOrders.estado, numero: cuttingOrders.numero })
    .from(cuttingOrders)
    .where(eq(cuttingOrders.id, id))
    .limit(1);

  if (!corte) return { error: "No se encontró el corte." };

  /*
   * Un corte cancelado no avanza a ningún lado.
   *
   * `indexOf` devuelve -1 para lo que no está en la cola, y -1 + 1 es 0: sin
   * este corte, apretar el botón sobre un trabajo cancelado lo devolvía al
   * principio, a "en cola", listo para que alguien lo corte.
   */
  const posicion = ORDEN.indexOf(corte.estado as never);
  if (posicion === -1) {
    return { error: "Ese corte está cancelado: la venta que lo pidió se anuló." };
  }

  const siguiente = ORDEN[posicion + 1];
  if (!siguiente) return { error: "El corte ya está retirado." };

  await db
    .update(cuttingOrders)
    .set({ estado: siguiente, updatedAt: new Date() })
    .where(eq(cuttingOrders.id, id));

  await registrarEnBitacora({
    sesion: usuario,
    accion: "cambiar_estado",
    entidad: "corte",
    entidadId: id,
    descripcion: `${corte.numero}: ${corte.estado} → ${siguiente}`,
  });

  revalidatePath("/admin/cortes");
  revalidatePath("/admin");

  const TEXTO: Record<string, string> = {
    "en-proceso": "en la máquina",
    terminado: "terminado",
    retirado: "retirado",
  };

  return { ok: `${corte.numero} quedó ${TEXTO[siguiente] ?? siguiente}.` };
}

/** Marca o desmarca el corte como urgente, que es lo que ordena la cola. */
export async function alternarUrgente(id: string): Promise<EstadoCorte> {
  await requireStaff();

  const [corte] = await db
    .select({ urgente: cuttingOrders.urgente, numero: cuttingOrders.numero })
    .from(cuttingOrders)
    .where(eq(cuttingOrders.id, id))
    .limit(1);

  if (!corte) return { error: "No se encontró el corte." };

  const nuevo = corte.urgente === 1 ? 0 : 1;

  await db
    .update(cuttingOrders)
    .set({ urgente: nuevo, updatedAt: new Date() })
    .where(eq(cuttingOrders.id, id));

  revalidatePath("/admin/cortes");

  return {
    ok:
      nuevo === 1
        ? `${corte.numero} pasó al principio de la cola.`
        : `${corte.numero} volvió al orden normal.`,
  };
}

/* -------------------------------------------------------------------------- */
/* Alta                                                                        */
/* -------------------------------------------------------------------------- */

const pieza = z.object({
  largoMm: z.coerce.number().int().positive().max(10_000),
  anchoMm: z.coerce.number().int().positive().max(10_000),
  cantidad: z.coerce.number().int().positive().max(999),
  respetaVeta: z.boolean().default(false),
  // Cuántos lados de cada medida llevan canto: 0, 1 o 2, como la planilla del
  // taller. `coerce` traga los `true`/`false` que mande una pantalla vieja.
  cantoLargo: z.coerce.number().int().min(0).max(2).default(0),
  cantoAncho: z.coerce.number().int().min(0).max(2).default(0),
  aclaracion: z.string().trim().max(120).optional(),
  etiqueta: z.string().trim().max(80).optional(),
});

/**
 * Da de alta una orden de corte.
 *
 * Faltaba: el tablero sabía mover órdenes y exportarlas al optimizador, pero
 * **ninguna parte del sistema podía crear una**. Las únicas que existían las
 * había puesto el sembrado de datos de prueba, así que el módulo entero moría
 * apenas alguien quería usarlo de verdad.
 *
 * Las medidas van en milímetros y en columnas separadas, no como texto: son los
 * números que después necesita el optimizador de la máquina, y guardarlas como
 * "60x40 (x4)" obligaría a volver a tipearlas.
 */
export async function crearCorte(
  _previo: EstadoCorte,
  formData: FormData,
): Promise<EstadoCorte> {
  const usuario = await requireStaff();

  const cabecera = z
    .object({
      customerId: z.string().uuid().optional(),
      /*
       * De qué pedido salió este corte, si salió de uno.
       *
       * La columna existía en la tabla desde el principio y **no la escribía
       * ni la leía nadie**. Sin ella, "el pedido de Gómez está listo menos el
       * corte" no se puede contestar desde ninguna de las dos puntas: en el
       * pedido no figura que hay un corte pendiente, y en el corte no figura a
       * qué pedido pertenece. En una maderera con seccionadora esa es la
       * pregunta de todos los días.
       */
      orderId: z.string().uuid().optional(),
      contactoNombre: z.string().trim().min(2, "Poné para quién es.").max(160),
      branchId: z.string().uuid().optional(),
      variantId: z.string().uuid().optional(),
      materialDescripcion: z
        .string()
        .trim()
        .min(2, "Falta decir qué placa se corta.")
        .max(200),
      /*
       * La medida de la placa de este trabajo.
       *
       * Puede no venir —la mayoría de los cortes son sobre una placa del
       * catálogo y la medida sale de la variante—, pero cuando viene manda:
       * es material del cliente, un retazo, o una placa que no mide lo de
       * plaza. El tope de 6000 mm es holgado incluso para tableros largos.
       */
      placaLargoMm: z.coerce.number().int().positive().max(6000).optional(),
      placaAnchoMm: z.coerce.number().int().positive().max(6000).optional(),
      /** De qué sale: placa entera (vacío) o media, y en qué sentido. */
      mitad: z.enum(["largo", "ancho"]).optional(),
      placas: z.coerce.number().int().positive().max(999).default(1),
      cantoDescripcion: z.string().trim().max(120).optional(),
      urgente: z.coerce.boolean().default(false),
      notas: z.string().trim().max(1000).optional(),
      /*
       * El acomodo que alguien corrigió a mano, como JSON.
       *
       * Se guarda tal cual llega y se valida al leerlo: la forma la fija
       * `leerAcomodoManual`, que descarta lo que no entiende en vez de romper
       * la pantalla. Un acomodo manual que no se entiende solo significa que el
       * plano se recalcula, que es el comportamiento de siempre.
       */
      acomodoManual: z.string().max(20_000).optional(),
    })
    .safeParse({
      customerId: (formData.get("customerId") as string) || undefined,
      orderId: (formData.get("orderId") as string) || undefined,
      contactoNombre: formData.get("contactoNombre"),
      branchId: (formData.get("branchId") as string) || undefined,
      variantId: (formData.get("variantId") as string) || undefined,
      materialDescripcion: formData.get("materialDescripcion"),
      placaLargoMm: (formData.get("placaLargoMm") as string) || undefined,
      placaAnchoMm: (formData.get("placaAnchoMm") as string) || undefined,
      mitad: (formData.get("mitad") as string) || undefined,
      placas: formData.get("placas") || 1,
      cantoDescripcion: (formData.get("cantoDescripcion") as string) || undefined,
      urgente: formData.get("urgente") === "si",
      notas: (formData.get("notas") as string) || undefined,
      acomodoManual: (formData.get("acomodoManual") as string) || undefined,
    });

  if (!cabecera.success) {
    return { error: cabecera.error.issues[0]?.message ?? "Revisá los datos." };
  }

  const piezas: z.infer<typeof pieza>[] = [];

  for (const cruda of formData.getAll("pieza").map(String)) {
    const parseada = pieza.safeParse(JSON.parse(cruda));
    if (!parseada.success) {
      return { error: "Hay una pieza con medidas incompletas." };
    }
    piezas.push(parseada.data);
  }

  if (piezas.length === 0) {
    return { error: "Agregá al menos una pieza al despiece." };
  }

  let numero = "";

  await db.transaction(async (tx) => {
    numero = await siguienteNumeroDeCorte(tx);

    /*
     * En qué sucursal se corta.
     *
     * Dejó de preguntarse en pantalla —lo pidió la clienta: el corte se hace
     * donde está la máquina— pero se sigue guardando, porque de eso dependen
     * la cola de ese taller y de dónde se descuenta el stock. Sale del pedido
     * si el corte nació de uno; si no, de la primera sucursal activa, la misma
     * convención que usan las reservas de stock.
     */
    const branchId =
      cabecera.data.branchId ??
      (
        await tx
          .select({ id: branches.id })
          .from(branches)
          .where(eq(branches.active, true))
          .orderBy(branches.sortOrder)
          .limit(1)
      )[0]?.id ??
      null;

    const [corte] = await tx
      .insert(cuttingOrders)
      .values({
        numero,
        customerId: cabecera.data.customerId ?? null,
        orderId: cabecera.data.orderId ?? null,
        contactoNombre: cabecera.data.contactoNombre,
        branchId,
        variantId: cabecera.data.variantId ?? null,
        materialDescripcion: cabecera.data.materialDescripcion,
        placaLargoMm: cabecera.data.placaLargoMm ?? null,
        placaAnchoMm: cabecera.data.placaAnchoMm ?? null,
        mitad: cabecera.data.mitad ?? null,
        placas: cabecera.data.placas,
        cantoDescripcion: cabecera.data.cantoDescripcion ?? null,
        acomodoManual: cabecera.data.acomodoManual ?? null,
        estado: "en-cola",
        urgente: cabecera.data.urgente ? 1 : 0,
        notas: cabecera.data.notas ?? null,
        createdByUserId: usuario.userId,
      })
      .returning({ id: cuttingOrders.id });

    await tx.insert(cuttingItems).values(
      piezas.map((p, orden) => ({
        cuttingOrderId: corte.id,
        largoMm: p.largoMm,
        anchoMm: p.anchoMm,
        cantidad: p.cantidad,
        respetaVeta: p.respetaVeta ? 1 : 0,
        cantoLargo: p.cantoLargo,
        cantoAncho: p.cantoAncho,
        aclaracion: p.aclaracion ?? null,
        etiqueta: p.etiqueta ?? null,
        orden,
      })),
    );
  });

  await registrarEnBitacora({
    sesion: usuario,
    accion: "crear",
    entidad: "corte",
    entidadId: numero,
    descripcion: `Cargó el corte ${numero} para ${cabecera.data.contactoNombre}`,
  });

  revalidatePath("/admin/cortes");
  revalidatePath("/taller");

  return { ok: `Se cargó el corte ${numero}.` };
}


/**
 * Carga las pasadas de sierra de un trabajo, que es lo que lo hace cobrable.
 *
 * Cuántas pasadas lleva un despiece lo decide el patrón que arma el optimizador
 * de la seccionadora, no la plataforma: acá se anota lo que dio la máquina. Sin
 * este número el corte no se puede cobrar, y hasta ahora no había dónde
 * anotarlo —el importe se tipeaba de memoria en el mostrador—.
 */
export async function cargarPasadas(
  id: string,
  pasadas: number,
): Promise<EstadoCorte> {
  const usuario = await requireStaff();

  const cantidad = Math.max(0, Math.floor(Number(pasadas) || 0));

  const [corte] = await db
    .select({ numero: cuttingOrders.numero, previas: cuttingOrders.pasadas })
    .from(cuttingOrders)
    .where(eq(cuttingOrders.id, id))
    .limit(1);

  if (!corte) return { error: "No encontramos la orden de corte." };

  await db
    .update(cuttingOrders)
    .set({ pasadas: cantidad, updatedAt: new Date() })
    .where(eq(cuttingOrders.id, id));

  await registrarEnBitacora({
    sesion: usuario,
    accion: "editar",
    entidad: "corte",
    entidadId: id,
    descripcion: `${corte.numero}: ${corte.previas} → ${cantidad} pasadas`,
  });

  revalidatePath(`/admin/cortes/${id}`);
  revalidatePath("/admin/cortes");
  return { ok: "Pasadas cargadas." };
}

/**
 * Guarda el acomodo que alguien corrigió a mano sobre el plano.
 *
 * Se puede corregir en el alta y también después: un trabajo entra a la cola y
 * al mirarlo con calma se decide que esa puerta salga de la placa nueva. Sin
 * esta acción la corrección solo existía mientras la pantalla estaba abierta.
 *
 * Guarda el JSON tal cual y la validación vive del lado de la lectura
 * (`leerAcomodoManual`): así una lista de otra época no rompe la ficha, solo
 * hace que el plano se recalcule.
 */
export async function guardarAcomodoManual(
  id: string,
  fijadas: PiezaFijada[],
): Promise<EstadoCorte> {
  const usuario = await requireStaff();

  const [corte] = await db
    .select({ numero: cuttingOrders.numero })
    .from(cuttingOrders)
    .where(eq(cuttingOrders.id, id))
    .limit(1);

  if (!corte) return { error: "No encontramos la orden de corte." };

  // Una lista vacía vuelve la columna a nulo: "sin correcciones" y "corregido a
  // cero piezas" son lo mismo, y el nulo lo dice sin ambigüedad.
  const guardado = fijadas.length > 0 ? JSON.stringify(fijadas) : null;

  await db
    .update(cuttingOrders)
    .set({ acomodoManual: guardado, updatedAt: new Date() })
    .where(eq(cuttingOrders.id, id));

  await registrarEnBitacora({
    sesion: usuario,
    accion: "editar",
    entidad: "corte",
    entidadId: id,
    descripcion: guardado
      ? `${corte.numero}: acomodo corregido a mano (${fijadas.length} ${
          fijadas.length === 1 ? "pieza" : "piezas"
        })`
      : `${corte.numero}: el acomodo vuelve al automático`,
  });

  revalidatePath(`/admin/cortes/${id}`);
  revalidatePath(`/plano/${id}`);
  return {
    ok: guardado ? "Acomodo guardado." : "El plano vuelve al automático.",
  };
}
