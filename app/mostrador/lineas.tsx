"use client";

import { Trash2, X } from "lucide-react";
import { formatearMonto, formatearUnidad } from "@/lib/formato";
import type { LineaDeVenta } from "@/lib/mostrador/importes";
import { enfocar } from "./atajos";

/** Agrega una línea, o suma la cantidad si esa medida ya está en la venta. */
export function sumar(lineas: LineaDeVenta[], nueva: LineaDeVenta): LineaDeVenta[] {
  const i = lineas.findIndex(
    (l) => l.variantId && l.variantId === nueva.variantId,
  );
  if (i === -1) return [...lineas, nueva];

  const copia = [...lineas];
  copia[i] = { ...copia[i], cantidad: copia[i].cantidad + nueva.cantidad };
  return copia;
}


export function Lineas({
  lineas,
  onCambiar,
  onLimpiar,
}: {
  lineas: LineaDeVenta[];
  onCambiar: (l: LineaDeVenta[]) => void;
  onLimpiar: () => void;
}) {
  if (lineas.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-linea text-center">
        {/* Por nombre, por medida o pasando el código. Lo que no esté —un corte,
            un flete— se carga a mano desde el mismo buscador. */}
        <p className="text-lg font-medium text-muted-foreground">
          Buscá un producto para empezar la venta
        </p>
      </div>
    );
  }

  function cambiar(i: number, campo: "cantidad" | "precioUnitario", valor: number) {
    const copia = [...lineas];
    copia[i] = { ...copia[i], [campo]: valor };
    onCambiar(copia);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col rounded-xl border border-linea bg-card">
      <div className="flex items-center justify-between border-b border-linea px-4 py-2.5">
        <span className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {lineas.length} {lineas.length === 1 ? "producto" : "productos"}
        </span>
        <button
          onClick={onLimpiar}
          className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-sm text-muted-foreground transition-colors hover:bg-hundida hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
          Vaciar
        </button>
      </div>

      {/* Los rótulos de las dos cajas, a la vista: eran iguales y sin
          nombre, y un Tab de más dejaba la placa a $3. */}
      <div className="flex items-center gap-3 px-4 pt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <span className="flex-1" />
        <span className="w-24 text-right">Cant.</span>
        <span className="w-3" />
        <span className="w-32 text-right">Precio</span>
        <span className="w-32" />
        <span className="w-8" />
      </div>

      <ul className="min-h-0 flex-1 divide-y divide-linea overflow-y-auto">
        {lineas.map((l, i) => {
          // Cambiado a mano respecto de la lista: en naranja, con la lista
          // tachada al lado. Quien mira la pantalla ve qué se tocó.
          const tocado = l.precioLista != null && Math.abs(l.precioLista - l.precioUnitario) > 0.005;
          return (
            <li key={`${l.variantId ?? "suelta"}-${i}`} className="flex items-center gap-3 px-4 py-3">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-base font-medium">{l.descripcion}</span>
                <span className="block text-sm text-muted-foreground">
                  {l.presentacion ? "cada media placa" : `por ${formatearUnidad(l.unidad)}`}
                </span>
              </span>

              <label className="shrink-0">
                <span className="sr-only">Cantidad de {l.descripcion}</span>
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  value={l.cantidad}
                  onChange={(e) => cambiar(i, "cantidad", Number(e.target.value))}
                  // La ruedita del mouse cambiaba el número sin que nadie lo
                  // notara: se suelta el foco y la página sigue scrolleando.
                  onWheel={(e) => e.currentTarget.blur()}
                  /* F2 cae en la cantidad de la última línea cargada, que es la
                     que se acaba de equivocar. Las de más arriba se corrigen con
                     el mouse o con Tab. */
                  data-foco={i === lineas.length - 1 ? "cantidad" : undefined}
                  onKeyDown={(e) => {
                    // Corregida la cantidad, el foco vuelve solo al buscador:
                    // lo que sigue es cargar el próximo producto.
                    if (e.key === "Enter" || e.key === "Escape") {
                      e.preventDefault();
                      enfocar("buscador");
                    }
                  }}
                  className="tabular h-11 w-24 rounded-lg border border-linea bg-background px-2.5 text-right text-base"
                />
              </label>

              <span className="w-3 text-center text-muted-foreground">×</span>

              <label className="relative shrink-0">
                <span className="sr-only">Precio de {l.descripcion}</span>
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  value={l.precioUnitario}
                  onChange={(e) => cambiar(i, "precioUnitario", Number(e.target.value))}
                  onWheel={(e) => e.currentTarget.blur()}
                  aria-describedby={tocado ? `lista-${i}` : undefined}
                  className={`tabular h-11 w-32 rounded-lg border bg-background px-2.5 text-right text-base ${
                    tocado ? "border-brand-orange font-semibold text-brand-orange" : "border-linea"
                  }`}
                />
                {tocado && (
                  <span
                    id={`lista-${i}`}
                    className="tabular absolute -bottom-4 right-1 text-xs text-muted-foreground line-through"
                  >
                    {formatearMonto(l.precioLista!)}
                  </span>
                )}
              </label>

              <span className="tabular w-32 shrink-0 text-right text-lg font-semibold">
                {formatearMonto(l.cantidad * l.precioUnitario)}
              </span>

              <button
                onClick={() => onCambiar(lineas.filter((_, j) => j !== i))}
                aria-label={`Quitar ${l.descripcion}`}
                className="w-8 shrink-0 rounded-lg p-2 text-muted-foreground transition-colors hover:bg-hundida hover:text-foreground"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
