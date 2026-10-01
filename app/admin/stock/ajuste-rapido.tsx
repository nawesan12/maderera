"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Minus, Plus, Ruler } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  admiteDecimales,
  formatearCantidad,
  formatearLargo,
  formatearUnidadPlural,
  leerCantidad,
  metrosDePiezas,
} from "@/lib/unidades";
import { formatearUnidad } from "@/lib/formato";
import { ajustarStock } from "./ajuste-actions";

/**
 * Suma o resta stock sin salir del listado.
 *
 * Llegó mercadería o se rompió una placa: son correcciones de todos los días.
 * Obligar a abrir la ficha del producto para cambiar un número es lo que hace
 * que el inventario del sistema se despegue del real.
 *
 * Lo que se mide —metros, m², kilos— además se carga con un número: con un
 * botón de a uno no se cargan 28,8 metros de zócalo. Y el metro lineal se
 * carga **por piezas**, que es como se cuenta al descargar el camión: «doce
 * de 2,40» y el sistema guarda los metros (pedido del 30/9/2026).
 */
export function AjusteRapido({
  variantId,
  branchSlug,
  sucursal,
  unidad,
  largoMm,
}: {
  variantId: string;
  branchSlug: string;
  sucursal: string;
  unidad: string;
  largoMm: number | null;
}) {
  const router = useRouter();
  const [pendiente, startTransition] = useTransition();

  function ajustar(cantidad: number, alTerminar?: () => void) {
    startTransition(async () => {
      const resultado = await ajustarStock(variantId, branchSlug, cantidad);
      if (resultado.error) toast.error(resultado.error);
      else {
        if (resultado.ok) toast.success(resultado.ok);
        alTerminar?.();
        router.refresh();
      }
    });
  }

  // La placa se ajusta de a media: es lo que queda cuando se vende una.
  const paso = unidad === "placa" ? 0.5 : 1;
  const nombrePaso = paso === 1 ? "uno" : "media";

  return (
    <div className="flex items-center gap-1">
      <button
        onClick={() => ajustar(-paso)}
        disabled={pendiente}
        className="flex h-9 min-w-9 items-center justify-center rounded-md border px-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
        aria-label={`Restar ${nombrePaso} en ${sucursal}`}
      >
        <Minus className="h-4 w-4" />
        {paso !== 1 && <span className="tabular text-sm">½</span>}
      </button>
      <button
        onClick={() => ajustar(paso)}
        disabled={pendiente}
        className="flex h-9 min-w-9 items-center justify-center rounded-md border px-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
        aria-label={`Sumar ${nombrePaso} en ${sucursal}`}
      >
        {pendiente ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Plus className="h-4 w-4" />
        )}
        {paso !== 1 && <span className="tabular text-sm">½</span>}
      </button>

      {admiteDecimales(unidad) && (
        <CargaPorMedida
          unidad={unidad}
          largoMm={unidad === "metro_lineal" ? largoMm : null}
          sucursal={sucursal}
          pendiente={pendiente}
          onCargar={ajustar}
        />
      )}
    </div>
  );
}

/**
 * Carga de una cantidad medida, sumando o restando.
 *
 * Con largo de pieza ofrece primero las piezas: el número que se tipea es el
 * que se contó, y la cuenta a metros la hace el sistema a la vista. Se puede
 * pasar a metros sueltos para un recorte que no es una pieza entera.
 */
function CargaPorMedida({
  unidad,
  largoMm,
  sucursal,
  pendiente,
  onCargar,
}: {
  unidad: string;
  largoMm: number | null;
  sucursal: string;
  pendiente: boolean;
  onCargar: (cantidad: number, alTerminar?: () => void) => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const [porPiezas, setPorPiezas] = useState(Boolean(largoMm));
  const [texto, setTexto] = useState("");

  const valor = leerCantidad(texto);
  const cantidad =
    !Number.isFinite(valor) || valor <= 0
      ? 0
      : porPiezas && largoMm
        ? metrosDePiezas(valor, largoMm)
        : valor;

  const abreviatura = formatearUnidad(unidad);
  const largoTexto = largoMm ? formatearLargo(largoMm) : null;

  function cargar(signo: 1 | -1) {
    if (cantidad <= 0) return;
    onCargar(signo * cantidad, () => {
      setTexto("");
      setAbierto(false);
    });
  }

  return (
    <Popover open={abierto} onOpenChange={setAbierto}>
      <PopoverTrigger
        className="flex h-9 items-center gap-1.5 rounded-md border px-2.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        aria-label={`Cargar una cantidad en ${sucursal}`}
      >
        <Ruler className="h-4 w-4" />
        Cargar
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 gap-3 p-4">
        <p className="text-base font-medium">Cargar en {sucursal}</p>

        {largoMm ? (
          <div className="flex rounded-md border p-0.5 text-sm" role="group">
            <button
              type="button"
              onClick={() => setPorPiezas(true)}
              aria-pressed={porPiezas}
              className={`flex-1 rounded px-2 py-1.5 ${porPiezas ? "bg-muted font-medium" : "text-muted-foreground"}`}
            >
              Piezas de {largoTexto}
            </button>
            <button
              type="button"
              onClick={() => setPorPiezas(false)}
              aria-pressed={!porPiezas}
              className={`flex-1 rounded px-2 py-1.5 ${!porPiezas ? "bg-muted font-medium" : "text-muted-foreground"}`}
            >
              Metros sueltos
            </button>
          </div>
        ) : null}

        <label className="block text-sm text-muted-foreground">
          {porPiezas && largoMm
            ? "Cuántas piezas"
            : `Cuántos ${formatearUnidadPlural(unidad)}`}
          <input
            autoFocus
            inputMode="decimal"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                cargar(e.shiftKey ? -1 : 1);
              }
            }}
            className="tabular mt-1 block h-11 w-full rounded-md border bg-background px-3 text-lg text-foreground"
            placeholder={porPiezas && largoMm ? "12" : "3,5"}
          />
        </label>

        <p className="tabular min-h-6 text-base" aria-live="polite">
          {cantidad > 0 ? (
            <>
              = <strong>{formatearCantidad(cantidad)} {abreviatura}</strong>
              {porPiezas && largoMm ? (
                <span className="text-muted-foreground">
                  {" "}
                  ({formatearCantidad(valor)} × {largoTexto})
                </span>
              ) : null}
            </>
          ) : (
            <span className="text-muted-foreground">
              {Number.isFinite(valor) || texto === "" ? " " : "Eso no es un número."}
            </span>
          )}
        </p>

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => cargar(-1)}
            disabled={pendiente || cantidad <= 0}
            className="h-10 rounded-md border text-base transition-colors hover:bg-muted disabled:opacity-50"
          >
            Restar
          </button>
          <button
            type="button"
            onClick={() => cargar(1)}
            disabled={pendiente || cantidad <= 0}
            className="h-10 rounded-md bg-brand-orange text-base font-medium text-white transition-colors hover:bg-brand-orange-dark disabled:opacity-50"
          >
            {pendiente ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : "Sumar"}
          </button>
        </div>
        <p className="text-xs text-muted-foreground">
          Enter suma · Mayús + Enter resta
        </p>
      </PopoverContent>
    </Popover>
  );
}
