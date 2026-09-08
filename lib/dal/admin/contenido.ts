import "server-only";

import { asc, desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  orders,
  productReviews,
  products,
  siteSettings,
} from "@/lib/db/schema";
import { requireStaff } from "@/lib/dal/session";

/**
 * Lo que el panel edita del sitio.
 *
 * Tenía el blog y los testimonios. Los dos salieron el 7/9/2026 por pedido de
 * la clienta: las notas las había escrito el prototipo y los testimonios eran
 * personas inventadas. Lo que la gente opina ahora sale de las reseñas de
 * compra verificada, que es el mismo dato sin el problema de tener que
 * conseguir a alguien que lo firme.
 */

export async function listarAjustes() {
  await requireStaff();

  return db
    .select()
    .from(siteSettings)
    .orderBy(asc(siteSettings.clave));
}

/* -------------------------------------------------------------------------- */
/* Reseñas                                                                     */
/* -------------------------------------------------------------------------- */

export interface ResenaParaModerar {
  id: string;
  producto: string;
  productoSlug: string;
  nombre: string;
  estrellas: number;
  texto: string;
  estado: "pendiente" | "publicada" | "rechazada";
  motivoRechazo: string | null;
  numeroPedido: string;
  createdAt: Date;
}

/**
 * Las reseñas para revisar, las pendientes primero.
 *
 * Todas son de compra verificada —el modelo no admite otra cosa—, así que lo
 * que se revisa no es si la persona compró sino qué escribió: un insulto o el
 * teléfono de un competidor firmado en la ficha de un producto queda ahí hasta
 * que alguien lo vea.
 */
export async function listarResenas(): Promise<ResenaParaModerar[]> {
  await requireStaff();

  return db
    .select({
      id: productReviews.id,
      producto: products.name,
      productoSlug: products.slug,
      nombre: productReviews.nombre,
      estrellas: productReviews.estrellas,
      texto: productReviews.texto,
      estado: productReviews.estado,
      motivoRechazo: productReviews.motivoRechazo,
      numeroPedido: orders.numero,
      createdAt: productReviews.createdAt,
    })
    .from(productReviews)
    .innerJoin(products, eq(products.id, productReviews.productId))
    .innerJoin(orders, eq(orders.id, productReviews.orderId))
    // Las pendientes arriba: es lo único que requiere una decisión.
    .orderBy(
      sql`case when ${productReviews.estado} = 'pendiente' then 0 else 1 end`,
      desc(productReviews.createdAt),
    )
    .limit(200);
}
