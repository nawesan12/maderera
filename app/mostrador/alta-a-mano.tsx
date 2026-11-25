"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatearMonto, importeDelCampo, importeIlegible } from "@/lib/formato";
import { CampoImporte } from "@/components/admin/campo-importe";
import type { LineaDeVenta } from "@/lib/mostrador/importes";

/**
 * Carga de una línea que no está en el catálogo.
 *
 * Existe porque media venta de maderera no es un producto de la lista: un corte
 * a medida, un flete, una diferencia por una placa marcada. Sin esto, eso se
 * arregla afuera del sistema —a mano, en un papel— y la venta que queda
 * registrada no es la que se hizo.
 *
 * La línea sale con `variantId` en nulo, que es lo que hace que no descuente
 * stock de ningún estante: un flete no sale de una pila.
 */
export function AltaAMano({
  descripcionInicial,
  focoAlCerrar,
  onCerrar,
  onAgregar,
}: {
  descripcionInicial: string;
  /** A dónde vuelve el cursor al cerrar: al buscador, a cargar lo que sigue. */
  focoAlCerrar?: () => HTMLElement | null;
  onCerrar: () => void;
  onAgregar: (l: LineaDeVenta) => void;
}) {
  const [descripcion, setDescripcion] = useState(descripcionInicial);
  const [unidad, setUnidad] = useState("unidad");
  const [cantidad, setCantidad] = useState("1");
  const [precio, setPrecio] = useState("");

  const valido =
    descripcion.trim().length > 0 && Number(cantidad) > 0 && precio !== "" && !importeIlegible(precio) && importeDelCampo(precio) >= 0;

  function agregar() {
    if (!valido) return;
    onAgregar({
      variantId: null,
      descripcion: descripcion.trim(),
      unidad: unidad.trim() || "unidad",
      cantidad: Number(cantidad),
      precioUnitario: importeDelCampo(precio),
    });
  }

  return (
    <Dialog open onOpenChange={(abierto) => !abierto && onCerrar()}>
      <DialogContent className="sm:max-w-md" finalFocus={focoAlCerrar}>
        <DialogHeader>
          <DialogTitle className="text-xl font-bold tracking-tight">
            Cargar a mano
          </DialogTitle>
        </DialogHeader>

        <form
          className="space-y-3.5"
          onSubmit={(e) => {
            e.preventDefault();
            agregar();
          }}
        >
          <label className="block">
            <span className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Qué es
            </span>
            <input
              autoFocus
              value={descripcion}
              onChange={(e) => setDescripcion(e.target.value)}
              placeholder="Corte a medida, flete, diferencia…"
              className="mt-1.5 h-12 w-full rounded-lg border border-linea bg-background px-3 text-base"
            />
          </label>

          <div className="flex gap-3">
            <label className="flex-1">
              <span className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Cantidad
              </span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={cantidad}
                onChange={(e) => setCantidad(e.target.value)}
                className="tabular mt-1.5 h-12 w-full rounded-lg border border-linea bg-background px-3 text-right text-base"
              />
            </label>
            <label className="flex-1">
              <span className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Unidad
              </span>
              <input
                value={unidad}
                onChange={(e) => setUnidad(e.target.value)}
                className="mt-1.5 h-12 w-full rounded-lg border border-linea bg-background px-3 text-base"
              />
            </label>
          </div>

          <label className="block">
            <span className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Precio por unidad
            </span>
            <CampoImporte
              valor={precio}
              alCambiar={setPrecio}
              placeholder="0"
              className="tabular mt-1.5 h-14 w-full rounded-lg border border-linea bg-background px-3 text-right text-2xl font-semibold"
            />
          </label>

          {Number(cantidad) > 0 && precio !== "" && (
            <p className="flex items-baseline justify-between text-lg">
              <span className="text-muted-foreground">Subtotal</span>
              <span className="tabular font-bold">
                {formatearMonto(Number(cantidad) * importeDelCampo(precio))}
              </span>
            </p>
          )}

          <button
            type="submit"
            disabled={!valido}
            className="inline-flex h-14 w-full items-center justify-center gap-2 rounded-xl bg-accion text-lg font-bold text-white transition-colors hover:bg-accion-hover disabled:opacity-40"
          >
            Agregar a la venta
            <kbd className="rounded border border-white/40 px-1.5 py-0.5 text-xs font-medium">
              Enter
            </kbd>
          </button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
