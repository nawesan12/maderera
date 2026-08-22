"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { cuttingOrders } from "@/lib/db/schema";
import { requireStaff } from "@/lib/dal/session";

export interface EstadoCorte {
  error?: string;
  ok?: string;
}

const ORDEN = ["en-cola", "en-proceso", "terminado", "retirado"] as const;

/** Avanza el corte al siguiente paso de la cola. */
export async function avanzarCorte(id: string): Promise<EstadoCorte> {
  await requireStaff();

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
