import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Layers } from "lucide-react";
import { asc, eq, sql } from "drizzle-orm";
import { EncabezadoPanel } from "@/components/admin/encabezado";
import { db } from "@/lib/db";
import { priceListItems, priceLists } from "@/lib/db/schema";
import { requireStaffRole } from "@/lib/dal/session";
import { EditorDeLista } from "./editor";

export const metadata: Metadata = { title: "Listas de precios" };

/**
 * Las listas de precios y su porcentaje sobre la general.
 *
 * Es el pedido de la clienta: "agregar precio constructora, y manejo global de
 * precios especiales por porcentaje ajustable". Una lista derivada vale
 * "general ± N %" en todo el catálogo de una vez; el precio propio cargado a
 * mano para un producto la pisa, que es la excepción puntual.
 */
export default async function ListasDePreciosPage() {
  await requireStaffRole("admin");

  const filas = await db
    .select({
      id: priceLists.id,
      nombre: priceLists.name,
      isDefault: priceLists.isDefault,
      porcentaje: priceLists.porcentajeSobreGeneral,
      itemsPropios: sql<number>`count(${priceListItems.id})::int`,
    })
    .from(priceLists)
    .leftJoin(priceListItems, eq(priceListItems.priceListId, priceLists.id))
    .where(eq(priceLists.active, true))
    .groupBy(priceLists.id)
    .orderBy(asc(priceLists.createdAt));

  const general = filas.find((l) => l.isDefault);
  const derivables = filas.filter((l) => !l.isDefault);

  return (
    <div className="space-y-6">
      <Link
        href="/admin/precios"
        className="inline-flex items-center gap-2 text-base text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-5 w-5" />
        Volver a precios
      </Link>

      <EncabezadoPanel
        titulo="Listas de precios"
        detalle="El porcentaje global de cada lista sobre la general, ajustable."
      />

      <div className="rounded-xl border bg-card p-5">
        <p className="flex items-start gap-2.5 text-base text-muted-foreground">
          <Layers className="mt-0.5 h-5 w-5 shrink-0 text-brand-orange" />
          <span>
            Cada producto resuelve su precio en este orden: el{" "}
            <strong>precio propio</strong> de la lista si está cargado, si no la{" "}
            <strong>general ± el porcentaje</strong> de acá, y sin porcentaje, la
            general tal cual. Cambiar el porcentaje impacta en todo el catálogo
            de esa lista al instante.
          </span>
        </p>
      </div>

      {general && (
        <section className="tarjeta-hundida p-5">
          <p className="text-base font-semibold">{general.nombre}</p>
          <p className="text-sm text-muted-foreground">
            La lista base: los porcentajes de las demás se calculan sobre esta.
          </p>
        </section>
      )}

      {derivables.map((lista) => (
        <EditorDeLista
          key={lista.id}
          lista={{
            id: lista.id,
            nombre: lista.nombre,
            porcentaje: lista.porcentaje,
            itemsPropios: lista.itemsPropios,
          }}
        />
      ))}
    </div>
  );
}
