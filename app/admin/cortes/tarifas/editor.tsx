"use client";

import { useActionState, useId } from "react";
import { Loader2 } from "lucide-react";
import { guardarTarifaDeCorte, type EstadoTarifa } from "./actions";

const inicial: EstadoTarifa = {};

export interface TarifaEditable {
  id: string;
  material: string;
  priceListId: string | null;
  precioPorPasada: string;
  precioPorMetroCanto: string;
  activo: boolean;
}

/**
 * Una tarifa de corte.
 *
 * El material es texto libre y no un desplegable de productos a propósito: la
 * tarifa no depende de la placa concreta sino de **contra qué corta la
 * sierra**. Una melamina y un MDF cobran igual; un tablero de madera, no.
 */
export function EditorDeTarifa({
  tarifa,
  listas,
}: {
  tarifa: TarifaEditable | null;
  listas: { id: string; nombre: string; esGeneral: boolean }[];
}) {
  const [estado, guardar, guardando] = useActionState(guardarTarifaDeCorte, inicial);
  const id = useId();

  return (
    <form action={guardar} className="rounded-xl border bg-card p-5">
      {tarifa && <input type="hidden" name="id" value={tarifa.id} />}

      <div className="grid gap-4 sm:grid-cols-4">
        <div>
          <label htmlFor={`${id}-material`} className="block text-base font-medium">
            Material
          </label>
          <input
            id={`${id}-material`}
            name="material"
            required
            defaultValue={tarifa?.material ?? ""}
            placeholder="Placas"
            className="mt-1 h-10 w-full rounded-lg border bg-background px-3 text-base"
          />
        </div>

        <div>
          <label htmlFor={`${id}-lista`} className="block text-base font-medium">
            Lista de precios
          </label>
          <select
            id={`${id}-lista`}
            name="priceListId"
            defaultValue={tarifa?.priceListId ?? ""}
            className="mt-1 h-10 w-full rounded-lg border bg-background px-2.5 text-base"
          >
            <option value="">Precio de público</option>
            {listas
              .filter((l) => !l.esGeneral)
              .map((l) => (
                <option key={l.id} value={l.id}>
                  {l.nombre}
                </option>
              ))}
          </select>
        </div>

        <div>
          <label htmlFor={`${id}-precio`} className="block text-base font-medium">
            Precio por pasada
          </label>
          <input
            id={`${id}-precio`}
            name="precioPorPasada"
            required
            defaultValue={tarifa?.precioPorPasada ?? ""}
            placeholder="1.200"
            className="mt-1 h-10 w-full rounded-lg border bg-background px-3 text-base"
          />
        </div>

        <div>
          <label htmlFor={`${id}-canto`} className="block text-base font-medium">
            Metro de tapacanto
          </label>
          <input
            id={`${id}-canto`}
            name="precioPorMetroCanto"
            defaultValue={tarifa?.precioPorMetroCanto ?? ""}
            placeholder="0 si no se cobra"
            className="mt-1 h-10 w-full rounded-lg border bg-background px-3 text-base"
          />
          <p className="mt-1 text-sm text-muted-foreground">
            El pegado, por metro lineal. Los metros salen del despiece.
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2.5 text-base">
          <input
            type="checkbox"
            name="activo"
            defaultChecked={tarifa?.activo ?? true}
            className="h-4 w-4 accent-brand-orange"
          />
          Se cobra
        </label>

        <button
          type="submit"
          disabled={guardando}
          className="inline-flex h-10 items-center gap-2 rounded-lg bg-brand-orange px-4 text-base font-medium text-white transition-colors hover:bg-brand-orange-dark disabled:opacity-60"
        >
          {guardando && <Loader2 className="h-4 w-4 animate-spin" />}
          {tarifa ? "Guardar" : "Agregar tarifa"}
        </button>

        {estado.error && <p className="text-base text-destructive">{estado.error}</p>}
        {estado.ok && <p className="text-base text-muted-foreground">{estado.ok}</p>}
      </div>
    </form>
  );
}
