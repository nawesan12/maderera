"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { z } from "zod";
import { cuttingItems, cuttingOrders } from "@/lib/db/schema";
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

  const siguiente = ORDEN[ORDEN.indexOf(corte.estado as never) + 1];
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
  cantoLargo: z.boolean().default(false),
  cantoAncho: z.boolean().default(false),
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
      contactoNombre: z.string().trim().min(2, "Poné para quién es.").max(160),
      branchId: z.string().uuid().optional(),
      variantId: z.string().uuid().optional(),
      materialDescripcion: z
        .string()
        .trim()
        .min(2, "Falta decir qué placa se corta.")
        .max(200),
      placas: z.coerce.number().int().positive().max(999).default(1),
      urgente: z.coerce.boolean().default(false),
      notas: z.string().trim().max(1000).optional(),
    })
    .safeParse({
      customerId: (formData.get("customerId") as string) || undefined,
      contactoNombre: formData.get("contactoNombre"),
      branchId: (formData.get("branchId") as string) || undefined,
      variantId: (formData.get("variantId") as string) || undefined,
      materialDescripcion: formData.get("materialDescripcion"),
      placas: formData.get("placas") || 1,
      urgente: formData.get("urgente") === "si",
      notas: (formData.get("notas") as string) || undefined,
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

    const [corte] = await tx
      .insert(cuttingOrders)
      .values({
        numero,
        customerId: cabecera.data.customerId ?? null,
        contactoNombre: cabecera.data.contactoNombre,
        branchId: cabecera.data.branchId ?? null,
        variantId: cabecera.data.variantId ?? null,
        materialDescripcion: cabecera.data.materialDescripcion,
        placas: cabecera.data.placas,
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
        cantoLargo: p.cantoLargo ? 1 : 0,
        cantoAncho: p.cantoAncho ? 1 : 0,
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
