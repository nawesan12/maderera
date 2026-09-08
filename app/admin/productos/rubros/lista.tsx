"use client";

import { useActionState } from "react";
import { AlertCircle, Check, Link2, Loader2, Plus } from "lucide-react";
import {
  alternarRubro,
  engancharPorTexto,
  guardarRubro,
  type EstadoRubros,
} from "./actions";

const inicial: EstadoRubros = {};

export interface RubroListado {
  id: string;
  name: string;
  slug: string;
  active: boolean;
  /** Productos activos que ya lo tienen asignado. */
  productos: number;
  /** Productos de la categoría que lo nombran como texto y están sueltos. */
  sueltos: number;
}

export interface CategoriaConRubros {
  id: string;
  name: string;
  rubros: RubroListado[];
}

/**
 * Los rubros de cada categoría.
 *
 * Existen porque la subcategoría era texto libre escrito en cada producto: dos
 * productos del mismo rubro escritos distinto eran dos rubros para el sistema
 * y ninguno para quien busca. Ferretería sola son ~1000 SKUs, y sin este nivel
 * es una grilla donde no se encuentra un tarugo.
 *
 * Un rubro sin productos no aparece en el catálogo. Los 43 de ferretería están
 * cargados esperando que se carguen los productos.
 */
export function ListaDeRubros({
  categorias,
}: {
  categorias: CategoriaConRubros[];
}) {
  const [estado, crear, creando] = useActionState(guardarRubro, inicial);
  const [estadoAlternar, alternar] = useActionState(alternarRubro, inicial);
  const [estadoEnganche, enganchar] = useActionState(engancharPorTexto, inicial);

  const aviso = estado.error ?? estadoAlternar.error ?? estadoEnganche.error;
  const listo = estado.ok ?? estadoAlternar.ok ?? estadoEnganche.ok;

  return (
    <div className="space-y-5">
      {aviso && (
        <p className="flex items-start gap-2 rounded-lg bg-destructive/10 p-3 text-base text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          {aviso}
        </p>
      )}
      {listo && !aviso && (
        <p className="flex items-start gap-2 rounded-lg bg-brand-green/10 p-3 text-base text-brand-green">
          <Check className="mt-0.5 h-4 w-4 shrink-0" />
          {listo}
        </p>
      )}

      <form
        action={crear}
        className="tarjeta flex flex-wrap items-end gap-3 px-5 py-4"
      >
        <div className="min-w-[12rem] flex-1">
          <label htmlFor="categoryId" className="block text-base font-medium">
            Categoría
          </label>
          <select
            id="categoryId"
            name="categoryId"
            className="mt-1 h-10 w-full rounded-lg border bg-background px-3 text-base"
          >
            {categorias.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        <div className="min-w-[12rem] flex-[2]">
          <label htmlFor="name" className="block text-base font-medium">
            Rubro nuevo
          </label>
          <input
            id="name"
            name="name"
            required
            placeholder="Tarugos, Melaminas…"
            className="mt-1 h-10 w-full rounded-lg border bg-background px-3 text-base"
          />
        </div>

        <button
          type="submit"
          disabled={creando}
          className="inline-flex h-10 items-center gap-2 rounded-lg bg-brand-orange px-4 text-base font-medium text-white transition-colors hover:bg-brand-orange-dark disabled:opacity-60"
        >
          {creando ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Plus className="h-4 w-4" />
          )}
          Agregar
        </button>
      </form>

      {categorias.map((categoria) => (
        <section key={categoria.id} className="tarjeta">
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b px-5 py-4">
            <h2 className="text-base font-medium">{categoria.name}</h2>
            <p className="text-base text-muted-foreground">
              {categoria.rubros.length === 0
                ? "Sin rubros"
                : `${categoria.rubros.length} rubros`}
            </p>
          </div>

          {categoria.rubros.length === 0 ? (
            <p className="px-5 py-6 text-base text-muted-foreground">
              Esta categoría todavía no tiene rubros. Cargalos arriba.
            </p>
          ) : (
            <ul className="divide-y">
              {categoria.rubros.map((rubro) => (
                <li
                  key={rubro.id}
                  className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3"
                >
                  <span className="min-w-[12rem] flex-1 text-base">
                    {rubro.name}
                    {!rubro.active && (
                      <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-sm text-muted-foreground">
                        dado de baja
                      </span>
                    )}
                  </span>

                  <span className="tabular text-base text-muted-foreground">
                    {rubro.productos === 0
                      ? "sin productos"
                      : `${rubro.productos} producto${rubro.productos === 1 ? "" : "s"}`}
                  </span>

                  {/* El enganche por texto solo se ofrece cuando hay algo que
                      enganchar: un botón que no va a hacer nada es ruido. */}
                  {rubro.sueltos > 0 && (
                    <form action={enganchar}>
                      <input type="hidden" name="id" value={rubro.id} />
                      <button
                        type="submit"
                        className="inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-base transition-colors hover:bg-muted"
                        title={`${rubro.sueltos} productos dicen "${rubro.name}" y no están asignados`}
                      >
                        <Link2 className="h-4 w-4" />
                        Enganchar {rubro.sueltos}
                      </button>
                    </form>
                  )}

                  <form action={alternar}>
                    <input type="hidden" name="id" value={rubro.id} />
                    <input
                      type="hidden"
                      name="activo"
                      value={rubro.active ? "no" : "si"}
                    />
                    <button
                      type="submit"
                      className="h-9 rounded-lg border px-3 text-base transition-colors hover:bg-muted"
                    >
                      {rubro.active ? "Dar de baja" : "Reactivar"}
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}
