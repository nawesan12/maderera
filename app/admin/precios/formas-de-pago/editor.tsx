"use client";

import { useActionState, useId } from "react";
import { Loader2 } from "lucide-react";
import { guardarDescuentoDePago, type EstadoDescuento } from "./actions";
import { MEDIOS } from "./medios";

const inicial: EstadoDescuento = {};


export interface DescuentoEditable {
  id: string;
  medio: string;
  desdeMonto: string;
  porcentaje: string;
  etiqueta: string;
  activo: boolean;
}

export function EditorDeDescuento({
  descuento,
}: {
  descuento: DescuentoEditable | null;
}) {
  const [estado, guardar, guardando] = useActionState(
    guardarDescuentoDePago,
    inicial,
  );
  const id = useId();

  return (
    <form action={guardar} className="rounded-xl border bg-card p-5">
      {descuento && <input type="hidden" name="id" value={descuento.id} />}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label htmlFor={`${id}-medio`} className="block text-base font-medium">
            Forma de pago
          </label>
          <select
            id={`${id}-medio`}
            name="medio"
            defaultValue={descuento?.medio ?? "transferencia"}
            className="mt-1 h-10 w-full rounded-lg border bg-background px-2.5 text-base"
          >
            {MEDIOS.map((m) => (
              <option key={m.valor} value={m.valor}>
                {m.etiqueta}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor={`${id}-desde`} className="block text-base font-medium">
            Desde
          </label>
          <input
            id={`${id}-desde`}
            name="desdeMonto"
            defaultValue={descuento?.desdeMonto ?? "0"}
            placeholder="0"
            className="mt-1 h-10 w-full rounded-lg border bg-background px-3 text-base"
          />
          <p className="mt-1 text-sm text-muted-foreground">
            Cero aplica a toda compra.
          </p>
        </div>

        <div>
          <label
            htmlFor={`${id}-porcentaje`}
            className="block text-base font-medium"
          >
            Descuento (%)
          </label>
          <input
            id={`${id}-porcentaje`}
            name="porcentaje"
            required
            defaultValue={descuento?.porcentaje ?? ""}
            placeholder="10"
            className="mt-1 h-10 w-full rounded-lg border bg-background px-3 text-base"
          />
        </div>

        <div>
          <label
            htmlFor={`${id}-etiqueta`}
            className="block text-base font-medium"
          >
            Cómo se lee
          </label>
          <input
            id={`${id}-etiqueta`}
            name="etiqueta"
            defaultValue={descuento?.etiqueta ?? ""}
            placeholder="10% por transferencia"
            className="mt-1 h-10 w-full rounded-lg border bg-background px-3 text-base"
          />
          <p className="mt-1 text-sm text-muted-foreground">
            Es el texto que ve el cliente en el resumen.
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2.5 text-base">
          <input
            type="checkbox"
            name="activo"
            defaultChecked={descuento?.activo ?? true}
            className="h-4 w-4 accent-brand-orange"
          />
          Se aplica
        </label>

        <button
          type="submit"
          disabled={guardando}
          className="inline-flex h-10 items-center gap-2 rounded-lg bg-brand-orange px-4 text-base font-medium text-white transition-colors hover:bg-brand-orange-dark disabled:opacity-60"
        >
          {guardando && <Loader2 className="h-4 w-4 animate-spin" />}
          {descuento ? "Guardar" : "Agregar escalón"}
        </button>

        {estado.error && (
          <p className="text-base text-destructive">{estado.error}</p>
        )}
        {estado.ok && (
          <p className="text-base text-muted-foreground">{estado.ok}</p>
        )}
      </div>
    </form>
  );
}
