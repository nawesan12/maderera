"use client";

import { useActionState } from "react";
import { Loader2, Plus, Trash2, TriangleAlert } from "lucide-react";
import {
  borrarEscala,
  guardarEscala,
  type EstadoProfesionales,
} from "./actions";
import type {
  EscalaListada,
  ListaAsignable,
} from "@/lib/dal/admin/profesionales";

const inicial: EstadoProfesionales = {};

/**
 * Escalas de descuento por volumen.
 *
 * "Comprás más, pagás menos" es la forma en que se le vende a un profesional.
 * Las escalas se cargan por lista y se aplican solas en el carrito, así que el
 * vendedor no tiene que acordarse de nada en el mostrador.
 *
 * Cuando dos escalas aplican al mismo producto gana la más específica —una
 * cargada para un producto le gana a la de su categoría, y esa a la general—,
 * para que una excepción a la baja sea posible.
 */
export function Escalas({
  escalas,
  listas,
}: {
  escalas: EscalaListada[];
  listas: ListaAsignable[];
}) {
  const [estado, guardar, guardando] = useActionState(guardarEscala, inicial);
  const [estadoBorrar, borrar] = useActionState(borrarEscala, inicial);

  const asignables = listas.filter((l) => !l.esGeneral);

  return (
    <section className="tarjeta">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b px-5 py-4">
        <h2 className="text-base font-medium">Descuentos por volumen</h2>
        <p className="text-base text-muted-foreground">
          Se aplican solos en el carrito
        </p>
      </div>

      {asignables.length === 0 ? (
        <p className="px-5 py-8 text-base text-muted-foreground">
          Todavía no hay una lista de precios distinta de la general. Creala en
          Precios y después cargá acá sus escalas.
        </p>
      ) : (
        <>
          {escalas.length > 0 && (
            <ul className="divide-y">
              {escalas.map((escala) => (
                <li
                  key={escala.id}
                  className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3"
                >
                  <span className="min-w-[10rem] flex-1 text-base">
                    {escala.lista}
                    <span className="block text-muted-foreground">
                      {escala.variantId
                        ? "Un producto puntual"
                        : escala.categoryId
                          ? "Una categoría"
                          : "Todo el catálogo"}
                    </span>
                  </span>

                  <span className="tabular text-base">
                    desde {escala.desdeCantidad}
                  </span>

                  <span className="tabular rounded-full bg-brand-green/10 px-2.5 py-1 text-base font-medium text-brand-green">
                    −{escala.porcentaje}%
                  </span>

                  <form action={borrar}>
                    <input type="hidden" name="id" value={escala.id} />
                    <button
                      type="submit"
                      aria-label="Eliminar escala"
                      className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          )}

          <form
            action={guardar}
            className="flex flex-wrap items-end gap-3 border-t px-5 py-4"
          >
            <div className="min-w-[12rem] flex-1">
              <label htmlFor="lista-escala" className="block text-base font-medium">
                Lista
              </label>
              <select
                id="lista-escala"
                name="priceListId"
                className="mt-1 h-10 w-full rounded-lg border bg-background px-3 text-base"
              >
                {asignables.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.nombre}
                  </option>
                ))}
              </select>
            </div>

            <div className="w-32">
              <label htmlFor="desde" className="block text-base font-medium">
                Desde
              </label>
              <input
                id="desde"
                name="desdeCantidad"
                inputMode="decimal"
                defaultValue="10"
                className="tabular mt-1 h-10 w-full rounded-lg border bg-background px-3 text-base"
              />
            </div>

            <div className="w-32">
              <label htmlFor="porcentaje" className="block text-base font-medium">
                Descuento %
              </label>
              <input
                id="porcentaje"
                name="porcentaje"
                inputMode="decimal"
                defaultValue="5"
                className="tabular mt-1 h-10 w-full rounded-lg border bg-background px-3 text-base"
              />
            </div>

            <button
              type="submit"
              disabled={guardando}
              className="inline-flex h-10 items-center gap-2 rounded-lg bg-brand-orange px-4 text-base font-medium text-white transition-colors hover:bg-brand-orange-dark disabled:opacity-60"
            >
              {guardando ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
              Agregar
            </button>

            {(estado.error || estadoBorrar.error) && (
              <p className="flex w-full items-start gap-2 text-base text-destructive">
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                {estado.error ?? estadoBorrar.error}
              </p>
            )}

            {(estado.ok || estadoBorrar.ok) && (
              <p className="w-full text-base text-muted-foreground">
                {estado.ok ?? estadoBorrar.ok}
              </p>
            )}
          </form>
        </>
      )}
    </section>
  );
}
